// server.js
const express = require("express");
const dotenv = require("dotenv");
const { PrismaClient } = require("@prisma/client");
const cors = require("cors");
const { pusherServer } = require("./libs/pusher");

dotenv.config();

const prisma = new PrismaClient();
const app = express();
app.use(express.json());
app.use(cors());

// Debug MongoDB string
if (!process.env.DATABASE_URL) {
  console.warn("⚠️  No DATABASE_URL found, falling back to local MongoDB.");
} else {
  console.log("✅ DATABASE_URL loaded from env.");
}

function getISTDate() {
  const now = new Date();
  // IST is UTC + 5:30
  now.setHours(now.getHours() + 5);
  now.setMinutes(now.getMinutes() + 30);
  return now;
}

// --- API to schedule a message ---
// Store messages in DB with a "scheduledAt" and "status" field
// --- API to schedule a message ---
app.post("/schedule", async (req, res) => {
  try {
    const { receiverIdArray, message, currentUserId, allUsers, datetime } =
      req.body;

    if (!datetime) {
      return res.status(400).json({ error: "datetime is required" });
    }

    const runAt = new Date(datetime);
    runAt.setMinutes(runAt.getMinutes() - 1); // Schedule 1 min earlier for testing

    // Save a new scheduler entry instead of creating messages now
    const sched = await prisma.scheduler.create({
      data: {
        senderId: currentUserId,
        receiverId: receiverIdArray,
        receiverName: allUsers
          .filter((u) => receiverIdArray.includes(u.id))
          .map((u) => u.name || "Unknown"),
        message: message,
        status: "pending", // <-- add this field in schema
        scheduledAt: runAt, // <-- add this field in schema
      },
    });

    console.log(`📅 Scheduler created for ${runAt.toISOString()}`);
    res.json({ status: "scheduled", datetime: runAt, schedulerId: sched.id });
  } catch (err) {
    console.error("❌ Error scheduling message:", err);
    res.status(500).json({ error: "Failed to schedule message" });
  }
});

// --- Endpoint to send pending messages ---
// This will be called by Render Cron every minute

app.post("/send-pending-messages", async (req, res) => {
  try {
    const now = getISTDate();

    // 1. Find pending schedulers that are due
    const schedulers = await prisma.scheduler.findMany({
      where: { status: "pending", scheduledAt: { lte: now } },
    });

    let sentCount = 0;

    for (const sched of schedulers) {
      // 2. Create actual messages in the conversation(s)
      for (const rId of sched.receiverId) {
        const conversation = await prisma.conversation.findFirst({
          where: {
            userIds: { hasEvery: [sched.senderId, rId] },
          },
        });

        if (conversation) {
          const newMessage = await prisma.message.create({
            data: {
              body: sched.message,
              conversation: { connect: { id: conversation.id } },
              sender: { connect: { id: sched.senderId } },
            },
            include: {
              sender: true,
              seen: true,
            },
          });

          // 🔥 Trigger Pusher so frontend updates immediately
          await pusherServer.trigger(
            conversation.id,
            "messages:new",
            newMessage
          );

          await prisma.conversation.update({
            where: { id: conversation.id },
            data: {
              lastMessageAt: getISTDate(),
              messages: { connect: { id: newMessage.id } },
            },
          });

          console.log(
            `✅ Sent + pushed message to ${rId} in conversation ${conversation.id}`
          );
          sentCount++;
        }
      }

      // 3. Update scheduler as sent
      await prisma.scheduler.update({
        where: { id: sched.id },
        data: { status: "sent", sentAt: getISTDate() },
      });
    }

    res.json({ sentCount });
  } catch (err) {
    console.error("❌ Error sending pending messages:", err);
    res.status(500).json({ error: "Failed to send pending messages" });
  }
});


// --- Start Express server ---
const PORT = process.env.PORT || 4000;
app.listen(PORT, () =>
  console.log(`🚀 Scheduler backend running on port ${PORT}`)
);
