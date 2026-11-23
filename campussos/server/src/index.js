import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import authRoutes from './routes/auth.js';
import incidentRoutes from './routes/incidents.js';
import smsRoutes from './routes/sms.js';

const app = express();
const server = http.createServer(app);
const origin = process.env.CLIENT_ORIGIN?.split(',') || '*';
const io = new Server(server, { cors: { origin } });

app.use(cors({ origin }));
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/incidents', incidentRoutes(io));
app.use('/api/sms', smsRoutes(io));

// Express 4 does not catch async errors by itself, so keep a last-resort handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});
process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e));

// Socket auth: responders join the "responders" room, users join their own room
io.use((socket, next) => {
  try {
    const payload = jwt.verify(socket.handshake.auth?.token, process.env.JWT_SECRET);
    socket.data.user = payload;
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});
io.on('connection', (socket) => {
  const { id, role } = socket.data.user;
  if (role === 'responder' || role === 'admin') socket.join('responders');
  socket.join(`user:${id}`);
});

const port = process.env.PORT || 4000;
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => server.listen(port, () => console.log(`CampusSOS server on :${port}`)))
  .catch((e) => {
    console.error('MongoDB connection failed:', e.message);
    process.exit(1);
  });
