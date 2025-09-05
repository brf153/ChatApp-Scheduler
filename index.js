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

const agenda = new Agenda({
  db: { address: mongoConnectionString, collection: 'agendaJobs' },
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

  console.log('Running scheduled job...', job.attrs.data);

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

    console.log(`Message sent to conversation ${id}: ${message}`);
  }
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

    await agenda.schedule(new Date(datetime), 'send scheduled message', {
      receiverIdArray,
      message,
      currentUserId,
      currentUserConversationIds,
      allUsers,
    });

    res.json({ status: 'scheduled', datetime, message });
  } catch (err) {
    console.error('Error scheduling message:', err);
    res.status(500).json({ error: 'Failed to schedule message' });
  }
});

// Start server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () =>
  console.log(`🚀 Scheduler backend running on port ${PORT}`)
);
