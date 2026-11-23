import jwt from 'jsonwebtoken';
import { normalizeDeviceId } from './lib/deviceId.js';
import { RESPONDERS_ROOM, userRoom, deviceRoom } from './lib/rooms.js';

// Default verifier: same secret and payload as the original socket middleware.
// JWT_SECRET is read at call time so dotenv (loaded in index.js) has already run.
export const verifyJwt = (token) => jwt.verify(token, process.env.JWT_SECRET);

// Decides which rooms a socket joins from its handshake auth.
// 1. A valid JWT wins: user:<id>, plus responders for responder/admin (unchanged behavior).
// 2. Otherwise a valid Device_ID: device:<deviceId> only.
// 3. Otherwise null (connection is rejected).
export function resolveSocketRooms(auth, verifyToken = verifyJwt) {
  const token = auth?.token;
  if (token != null) {
    let user = null;
    try {
      user = verifyToken(token);
    } catch {
      user = null;
    }
    if (user && user.id != null) {
      const rooms = [userRoom(user.id)];
      if (user.role === 'responder' || user.role === 'admin') rooms.push(RESPONDERS_ROOM);
      return { kind: 'user', user, rooms };
    }
  }

  const deviceId = normalizeDeviceId(auth?.deviceId);
  if (deviceId) return { kind: 'device', deviceId, rooms: [deviceRoom(deviceId)] };

  return null;
}

// Installs the handshake middleware and room joins. Device sockets only listen;
// no client-to-server event handlers are registered.
export function attachSocketAuth(io, verifyToken = verifyJwt) {
  io.use((socket, next) => {
    const result = resolveSocketRooms(socket.handshake?.auth, verifyToken);
    if (!result) return next(new Error('unauthorized'));
    socket.data.kind = result.kind;
    socket.data.rooms = result.rooms;
    if (result.kind === 'user') socket.data.user = result.user;
    else socket.data.deviceId = result.deviceId;
    next();
  });
  io.on('connection', (socket) => {
    for (const room of socket.data.rooms || []) socket.join(room);
  });
}
