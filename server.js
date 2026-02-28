const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Pool } = require('pg');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || '';

const roomState = new Map();
const saveTimers = new Map();
let dbReady = false;
let dbPool = null;

async function connectDb() {
  try {
    if (!DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }

    dbPool = new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
    });

    await dbPool.query('SELECT 1');
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        room_id TEXT PRIMARY KEY,
        token TEXT,
        image JSONB,
        text_items JSONB NOT NULL DEFAULT '[]'::jsonb,
        strokes JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    dbReady = true;
    console.log('PostgreSQL connected');
  } catch (error) {
    dbReady = false;
    console.warn('PostgreSQL unavailable. Running without persistence.');
  }
}

function sanitizeRoomId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 40);
}

function makeToken() {
  return crypto.randomBytes(12).toString('hex');
}

function sanitizeBrush(value) {
  const allowed = new Set([
    'scribble',
    'pen',
    'marker',
    'spray',
    'glitter',
    'watercolor',
    'mixedcolor',
    'neon',
    'calligraphy',
    'eraser'
  ]);
  return allowed.has(value) ? value : 'scribble';
}

async function loadRoomFromDb(roomId) {
  if (!dbReady) {
    return null;
  }

  const result = await dbPool.query(
    `
      SELECT
        room_id AS "roomId",
        token,
        image,
        text_items AS "textItems",
        strokes
      FROM rooms
      WHERE room_id = $1
      LIMIT 1
    `,
    [roomId]
  );

  return result.rows[0] || null;
}

async function saveRoomToDb(roomId) {
  if (!dbReady || !roomState.has(roomId)) {
    return;
  }

  const room = roomState.get(roomId);
  await dbPool.query(
    `
      INSERT INTO rooms (room_id, token, image, text_items, strokes, updated_at)
      VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, NOW())
      ON CONFLICT (room_id)
      DO UPDATE SET
        token = EXCLUDED.token,
        image = EXCLUDED.image,
        text_items = EXCLUDED.text_items,
        strokes = EXCLUDED.strokes,
        updated_at = NOW()
    `,
    [
      roomId,
      room.token || null,
      JSON.stringify(room.image || null),
      JSON.stringify(Array.isArray(room.textItems) ? room.textItems : []),
      JSON.stringify(Array.isArray(room.strokes) ? room.strokes : [])
    ]
  );
}

function scheduleRoomSave(roomId) {
  if (!dbReady) {
    return;
  }

  if (saveTimers.has(roomId)) {
    clearTimeout(saveTimers.get(roomId));
  }

  const timer = setTimeout(async () => {
    saveTimers.delete(roomId);
    try {
      await saveRoomToDb(roomId);
    } catch (error) {
      console.error(`Failed to save room ${roomId}:`, error.message);
    }
  }, 600);

  saveTimers.set(roomId, timer);
}

async function getRoom(roomId) {
  if (roomState.has(roomId)) {
    return roomState.get(roomId);
  }

  const dbRoom = await loadRoomFromDb(roomId);
  const room = {
    token: dbRoom?.token || null,
    image: dbRoom?.image || null,
    textItems: Array.isArray(dbRoom?.textItems) ? dbRoom.textItems : [],
    strokes: Array.isArray(dbRoom?.strokes) ? dbRoom.strokes : []
  };

  roomState.set(roomId, room);
  return room;
}

function roomUsersCount(roomId) {
  return io.sockets.adapter.rooms.get(roomId)?.size || 0;
}

app.use(express.json());

app.post('/api/rooms/share', async (req, res) => {
  const roomId = sanitizeRoomId(req.body?.roomId);
  if (!roomId) {
    return res.status(400).json({ error: 'Invalid roomId' });
  }

  const room = await getRoom(roomId);
  room.token = makeToken();
  scheduleRoomSave(roomId);

  const origin = `${req.protocol}://${req.get('host')}`;
  const shareUrl = `${origin}/?room=${encodeURIComponent(roomId)}&token=${encodeURIComponent(room.token)}`;

  res.json({
    roomId,
    token: room.token,
    shareUrl
  });
});

app.post('/api/rooms/save', async (req, res) => {
  const roomId = sanitizeRoomId(req.body?.roomId);
  if (!roomId) {
    return res.status(400).json({ error: 'Invalid roomId' });
  }

  if (!dbReady) {
    return res.status(503).json({ error: 'PostgreSQL is not connected. Save unavailable.' });
  }

  const room = await getRoom(roomId);
  try {
    await saveRoomToDb(roomId);
    res.json({
      roomId,
      count: Array.isArray(room.strokes) ? room.strokes.length : 0,
      saved: true
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save room.' });
  }
});

io.on('connection', (socket) => {
  socket.data.userId = socket.id;

  socket.on('join-room', async (payload = {}) => {
    const roomId = sanitizeRoomId(payload.roomId);
    const token = typeof payload.token === 'string' ? payload.token.trim() : '';

    if (!roomId) {
      socket.emit('join-error', { message: 'Invalid room name.' });
      return;
    }

    const room = await getRoom(roomId);

    if (room.token && token !== room.token) {
      socket.emit('join-error', { message: 'This room is protected. Enter a valid token.' });
      return;
    }

    if (socket.data.roomId && socket.data.roomId !== roomId) {
      socket.leave(socket.data.roomId);
      io.to(socket.data.roomId).emit('users-count', roomUsersCount(socket.data.roomId));
    }

    socket.join(roomId);
    socket.data.roomId = roomId;

    socket.emit('join-success', { roomId, protected: Boolean(room.token) });
    socket.emit('init-room', {
      image: room.image || null,
      textItems: room.textItems || [],
      strokes: room.strokes,
      protected: Boolean(room.token)
    });

    io.to(roomId).emit('users-count', roomUsersCount(roomId));
  });

  socket.on('start-stroke', async (payload = {}) => {
    const roomId = socket.data.roomId;
    if (!roomId) {
      return;
    }

    const room = await getRoom(roomId);
    const stroke = {
      id: String(payload.strokeId || ''),
      userId: socket.data.userId,
      color: String(payload.color || '#1f1f1f'),
      size: Number(payload.size || 4),
      opacity: Math.max(0.1, Math.min(1, Number(payload.opacity || 1))),
      brush: sanitizeBrush(String(payload.brush || 'scribble')),
      undone: false,
      segments: []
    };

    if (!stroke.id) {
      return;
    }

    room.strokes.push(stroke);
    if (room.strokes.length > 2000) {
      room.strokes.splice(0, room.strokes.length - 2000);
    }

    scheduleRoomSave(roomId);
  });

  socket.on('draw-segment', async (payload = {}) => {
    const roomId = socket.data.roomId;
    if (!roomId) {
      return;
    }

    const room = await getRoom(roomId);
    const stroke = room.strokes.find((item) => item.id === payload.strokeId && !item.undone);
    if (!stroke) {
      return;
    }

    const segment = {
      x1: Number(payload.x1),
      y1: Number(payload.y1),
      x2: Number(payload.x2),
      y2: Number(payload.y2)
    };

    stroke.segments.push(segment);
    socket.to(roomId).emit('draw-segment', {
      strokeId: stroke.id,
      color: stroke.color,
      size: stroke.size,
      opacity: stroke.opacity,
      brush: stroke.brush,
      ...segment
    });

    scheduleRoomSave(roomId);
  });

  socket.on('undo', async () => {
    const roomId = socket.data.roomId;
    if (!roomId) {
      return;
    }

    const room = await getRoom(roomId);
    const stroke = [...room.strokes].reverse().find((item) => item.userId === socket.data.userId && !item.undone);
    if (!stroke) {
      return;
    }

    stroke.undone = true;
    io.to(roomId).emit('undo-stroke', { strokeId: stroke.id });
    scheduleRoomSave(roomId);
  });

  socket.on('redo', async () => {
    const roomId = socket.data.roomId;
    if (!roomId) {
      return;
    }

    const room = await getRoom(roomId);
    const stroke = [...room.strokes].reverse().find((item) => item.userId === socket.data.userId && item.undone);
    if (!stroke) {
      return;
    }

    stroke.undone = false;
    io.to(roomId).emit('redo-stroke', { stroke });
    scheduleRoomSave(roomId);
  });

  socket.on('clear-canvas', async () => {
    const roomId = socket.data.roomId;
    if (!roomId) {
      return;
    }

    const room = await getRoom(roomId);
    room.strokes = [];
    io.to(roomId).emit('clear-canvas');
    scheduleRoomSave(roomId);
  });

  socket.on('set-image', async (payload = {}) => {
    const roomId = socket.data.roomId;
    if (!roomId) {
      return;
    }

    const room = await getRoom(roomId);
    const dataUrl = String(payload.dataUrl || '');
    if (!dataUrl.startsWith('data:image/')) {
      return;
    }

    room.image = {
      dataUrl,
      x: Number(payload.x || 0),
      y: Number(payload.y || 0),
      width: Number(payload.width || 0),
      height: Number(payload.height || 0),
      frame: {
        style: String(payload.frame?.style || 'none'),
        color: String(payload.frame?.color || '#111111'),
        width: Number(payload.frame?.width || 2)
      }
    };

    io.to(roomId).emit('image-updated', room.image);
    scheduleRoomSave(roomId);
  });

  socket.on('move-image', async (payload = {}) => {
    const roomId = socket.data.roomId;
    if (!roomId) {
      return;
    }

    const room = await getRoom(roomId);
    if (!room.image?.dataUrl) {
      return;
    }

    room.image.x = Number(payload.x || 0);
    room.image.y = Number(payload.y || 0);
    io.to(roomId).emit('image-moved', { x: room.image.x, y: room.image.y });
    scheduleRoomSave(roomId);
  });

  socket.on('scale-image', async (payload = {}) => {
    const roomId = socket.data.roomId;
    if (!roomId) {
      return;
    }

    const room = await getRoom(roomId);
    if (!room.image?.dataUrl) {
      return;
    }

    room.image.width = Number(payload.width || room.image.width || 0);
    room.image.height = Number(payload.height || room.image.height || 0);
    io.to(roomId).emit('image-scaled', { width: room.image.width, height: room.image.height });
    scheduleRoomSave(roomId);
  });

  socket.on('remove-image', async () => {
    const roomId = socket.data.roomId;
    if (!roomId) {
      return;
    }

    const room = await getRoom(roomId);
    room.image = null;
    io.to(roomId).emit('image-removed');
    scheduleRoomSave(roomId);
  });

  socket.on('add-text', async (payload = {}) => {
    const roomId = socket.data.roomId;
    if (!roomId) {
      return;
    }
    const room = await getRoom(roomId);
    const textItem = {
      id: String(payload.id || ''),
      text: String(payload.text || ''),
      x: Number(payload.x || 0),
      y: Number(payload.y || 0),
      size: Number(payload.size || 24),
      color: String(payload.color || '#111111')
    };
    if (!textItem.id || !textItem.text.trim()) {
      return;
    }
    room.textItems.push(textItem);
    if (room.textItems.length > 500) {
      room.textItems.splice(0, room.textItems.length - 500);
    }
    io.to(roomId).emit('text-added', textItem);
    scheduleRoomSave(roomId);
  });

  socket.on('remove-text', async (payload = {}) => {
    const roomId = socket.data.roomId;
    if (!roomId) {
      return;
    }
    const room = await getRoom(roomId);
    const id = String(payload.id || '');
    if (!id) {
      return;
    }
    room.textItems = room.textItems.filter((item) => item.id !== id);
    io.to(roomId).emit('text-removed', { id });
    scheduleRoomSave(roomId);
  });

  socket.on('update-text', async (payload = {}) => {
    const roomId = socket.data.roomId;
    if (!roomId) {
      return;
    }
    const room = await getRoom(roomId);
    const id = String(payload.id || '');
    if (!id) {
      return;
    }
    const item = room.textItems.find((textItem) => textItem.id === id);
    if (!item) {
      return;
    }
    if (typeof payload.text === 'string') {
      item.text = payload.text;
    }
    if (typeof payload.x !== 'undefined') {
      item.x = Number(payload.x || 0);
    }
    if (typeof payload.y !== 'undefined') {
      item.y = Number(payload.y || 0);
    }
    if (typeof payload.size !== 'undefined') {
      item.size = Number(payload.size || item.size || 24);
    }
    if (typeof payload.color === 'string') {
      item.color = payload.color;
    }
    io.to(roomId).emit('text-updated', item);
    scheduleRoomSave(roomId);
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId) {
      return;
    }

    io.to(roomId).emit('users-count', roomUsersCount(roomId));
  });
});

app.use(express.static('public'));

connectDb().finally(() => {
  server.listen(PORT, () => {
    console.log(`Scribble whiteboard running at http://localhost:${PORT}`);
  });
});
