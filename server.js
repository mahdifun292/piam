const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 1e5,
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// rooms: Map<roomId, Map<socketId, user>>
const rooms = new Map();

function sanitize(s, max = 30) {
  return String(s || '')
    .replace(/[<>"'&]/g, '')
    .trim()
    .slice(0, max);
}

io.on('connection', (socket) => {
  console.log('🔌 connected:', socket.id);

  socket.on('join', (payload = {}) => {
    if (socket.data.roomId) leaveRoom(socket);

    const roomId = sanitize(payload.roomId, 30).toLowerCase() || 'lounge';
    const username = sanitize(payload.username, 20) || 'Guest';

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.username = username;

    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    const room = rooms.get(roomId);

    // Send existing users to the new joiner
    socket.emit('room-users', Array.from(room.values()));

    // Register this user
    const user = { id: socket.id, username, muted: false };
    room.set(socket.id, user);

    // Notify others
    socket.to(roomId).emit('user-joined', user);

    console.log(`👤 ${username} (${socket.id}) → #${roomId} [${room.size}]`);
  });

  socket.on('mute-state', ({ muted }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    const user = room?.get(socket.id);
    if (user) {
      user.muted = !!muted;
      socket.to(roomId).emit('user-muted', { id: socket.id, muted: user.muted });
    }
  });

  socket.on('signal', ({ to, data }) => {
    if (!to || !data) return;
    io.to(to).emit('signal', { from: socket.id, data });
  });

  socket.on('disconnect', () => {
    console.log('❌ disconnected:', socket.id);
    leaveRoom(socket);
  });

  function leaveRoom(sock) {
    const roomId = sock.data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (room) {
      room.delete(sock.id);
      if (room.size === 0) rooms.delete(roomId);
    }
    sock.to(roomId).emit('user-left', { id: sock.id });
    sock.leave(roomId);
    sock.data.roomId = null;
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🎙️  VoxChat listening on port ${PORT}`);
});
