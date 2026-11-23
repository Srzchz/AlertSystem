import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import authRoutes from './routes/auth.js';
import incidentRoutes from './routes/incidents.js';
import smsRoutes from './routes/sms.js';
import { attachSocketAuth } from './socket.js';

// Builds the Express app, HTTP server, and Socket.IO server without connecting
// to MongoDB or listening. Env (CLIENT_ORIGIN, JWT_SECRET) is read at call time.
export function createApp() {
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

  // Socket auth: JWT sockets join user:<id> (+ responders for responder/admin),
  // Device_ID sockets join device:<deviceId> only
  attachSocketAuth(io);

  return { app, server, io };
}
