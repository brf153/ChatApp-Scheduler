// server.js
const express = require('express');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');
const Agenda = require('agenda');
const cors = require('cors');

dotenv.config();

const prisma = new PrismaClient();
const app = express();
app.use(express.json());
app.use(cors());

// MongoDB connection for Agenda
const mongoConnectionString =
  process.env.DATABASE_URL || 'mongodb://localhost/agenda';

// Debug log (safe)
if (!process.env.DATABASE_URL) {
  console.warn("⚠️  No DATABASE_URL found, falling back to local MongoDB.");
} else {
  console.log("✅ DATABASE_URL loaded from env.");
  // optional: log only prefix to confirm
  console.log("🔗 MongoDB string starts with:", process.env.DATABASE_URL.split('@')[0]);
}

// --- Setup Agenda ---
const agenda = new Agenda({
  db: { address: mongoConnectionString, collection: 'agendaJobs' },
  processEvery: '30 seconds', // how often Agenda checks DB
});

// --- Define Job ---
agenda.define('send scheduled message', async (job) => {
  const {
    receiverIdArray,
    message,
    currentUserId,
    currentUserConversationIds,
    allUsers,
  } = job.attrs.data;

  console.log('⚡ Running scheduled job...', job.attrs.data);

  let conversationId = [];
  for (const id of receiverIdArray) {
    for (const user of allUsers) {
      if (user.id === id) {
        for (const receivedUserConversationId of user.conversationIds) {
          for (const currentUserConversationId of currentUserConversationIds) {
            if (receivedUserConversationId === currentUserConversationId) {
              conversationId.push(currentUserConversationId);
            }
          }
        }
      }
    }
  }

  for (const id of conversationId) {
    const newMessage = await prisma.message.create({
      include: {
        seen: true,
        sender: true,
      },
      data: {
        body: message,
        conversation: {
          connect: { id: id },
        },
        sender: {
          connect: { id: currentUserId },
        },
      },
    });

    await prisma.conversation.update({
      where: { id: id },
      data: {
        lastMessageAt: new Date(),
        messages: {
          connect: { id: newMessage.id },
        },
      },
    });

    console.log(`✅ Message sent to conversation ${id}: ${message}`);
  }
});

// --- Agenda Lifecycle Logs ---
agenda.on('start', (job) => {
  console.log(`➡️  Job started: ${job.attrs.name}`);
});
agenda.on('success', (job) => {
  console.log(`✅ Job success: ${job.attrs.name}`);
});
agenda.on('fail', (err, job) => {
  console.error(`❌ Job failed: ${job.attrs.name}`, err);
});

// --- Start Agenda ---
(async function () {
  await agenda.start();
  console.log('✅ Agenda started and ready to process jobs.');
})();

// --- API to schedule a job ---
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

    // schedule the job
    await agenda.schedule(runAt, 'send scheduled message', {
      receiverIdArray,
      message,
      currentUserId,
      currentUserConversationIds,
      allUsers,
    });

    console.log(`📅 Job scheduled for ${runAt.toISOString()}`);

    res.json({ status: 'scheduled', datetime: runAt, message });
  } catch (err) {
    console.error('❌ Error scheduling message:', err);
    res.status(500).json({ error: 'Failed to schedule message' });
  }
});

// --- Start Express server ---
const PORT = process.env.PORT || 4000;
app.listen(PORT, () =>
  console.log(`🚀 Scheduler backend running on port ${PORT}`)
);
