// server.js
const express = require('express');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');
const cors = require('cors');

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

// --- API to schedule a message ---
// Store messages in DB with a "scheduledAt" and "status" field
app.post('/schedule', async (req, res) => {
  try {
    const {
      receiverIdArray,
      message,
      currentUserId,
      currentUserConversationIds,
      allUsers,
      datetime,
    } = req.body;

    if (!datetime) {
      return res.status(400).json({ error: 'datetime is required' });
    }

    const runAt = new Date(datetime);

    // Save message entries for each receiver
    for (const id of receiverIdArray) {
      await prisma.message.create({
        data: {
          body: message,
          sender: { connect: { id: currentUserId } },
          status: 'pending', // new field to track if sent
          scheduledAt: runAt,
          conversation: {
            connect: {
              id: currentUserConversationIds.find(cid => 
                allUsers.find(u => u.id === id)?.conversationIds.includes(cid)
              ),
            },
          },
        },
      });
    }

    console.log(`📅 Messages scheduled for ${runAt.toISOString()}`);
    res.json({ status: 'scheduled', datetime: runAt, message });
  } catch (err) {
    console.error('❌ Error scheduling message:', err);
    res.status(500).json({ error: 'Failed to schedule message' });
  }
});

// --- Endpoint to send pending messages ---
// This will be called by Render Cron every minute
app.post('/send-pending-messages', async (req, res) => {
  try {
    const now = new Date();

    // Find pending messages whose scheduledAt <= now
    const messages = await prisma.message.findMany({
      where: { status: 'pending', scheduledAt: { lte: now } },
      include: { sender: true, conversation: true },
    });

    for (const msg of messages) {
      // Mark as sent
      await prisma.message.update({
        where: { id: msg.id },
        data: { status: 'sent', sentAt: now },
      });

      console.log(`✅ Message sent: ${msg.body} to conversation ${msg.conversationId}`);
    }

    res.json({ sentCount: messages.length });
  } catch (err) {
    console.error('❌ Error sending pending messages:', err);
    res.status(500).json({ error: 'Failed to send pending messages' });
  }
});

// --- Start Express server ---
const PORT = process.env.PORT || 4000;
app.listen(PORT, () =>
  console.log(`🚀 Scheduler backend running on port ${PORT}`)
);
