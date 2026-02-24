const socket = io();

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

const roomInput = document.getElementById('roomInput');
const tokenInput = document.getElementById('tokenInput');
const joinBtn = document.getElementById('joinBtn');
const clearBtn = document.getElementById('clearBtn');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const shareBtn = document.getElementById('shareBtn');
const saveBtn = document.getElementById('saveBtn');
const colorInput = document.getElementById('colorInput');
const sizeInput = document.getElementById('sizeInput');
const opacityInput = document.getElementById('opacityInput');
const brushInput = document.getElementById('brushInput');
const usersCount = document.getElementById('usersCount');
const statusText = document.getElementById('statusText');
const shareLink = document.getElementById('shareLink');
const swatchButtons = Array.from(document.querySelectorAll('.swatch'));

const importImageBtn = document.getElementById('importImageBtn');
const imageInput = document.getElementById('imageInput');
const moveImageBtn = document.getElementById('moveImageBtn');
const imageScaleInput = document.getElementById('imageScaleInput');
const removeImageBtn = document.getElementById('removeImageBtn');

let drawing = false;
let last = null;
let currentStrokeId = null;
let currentRoomId = '';
let moveImageMode = false;
let draggingImage = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
const strokesById = new Map();

const boardImage = {
  dataUrl: '',
  img: null,
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  scale: 1
};

function setStatus(text) {
  statusText.textContent = text;
}

function randomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function updateMoveImageBtn() {
  moveImageBtn.classList.toggle('active', moveImageMode);
  moveImageBtn.textContent = moveImageMode ? 'Move Image: ON' : 'Move Image';
}

function ensureJoined() {
  if (!currentRoomId) {
    setStatus('Join a room first.');
    return false;
  }
  return true;
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  redrawAll();
}

function drawBoardImage() {
  if (!boardImage.img) {
    return;
  }
  ctx.drawImage(boardImage.img, boardImage.x, boardImage.y, boardImage.width, boardImage.height);
}

function loadBoardImage(payload, statusMessage) {
  if (!payload?.dataUrl) {
    boardImage.dataUrl = '';
    boardImage.img = null;
    redrawAll();
    return;
  }

  const img = new Image();
  img.onload = () => {
    boardImage.dataUrl = payload.dataUrl;
    boardImage.img = img;
    boardImage.x = Number(payload.x || 0);
    boardImage.y = Number(payload.y || 0);
    boardImage.width = Number(payload.width || img.width);
    boardImage.height = Number(payload.height || img.height);
    redrawAll();
    if (statusMessage) {
      setStatus(statusMessage);
    }
  };
  img.src = payload.dataUrl;
}

function drawSegment(seg, style) {
  ctx.save();

  const brush = style.brush || 'scribble';
  const opacity = Number.isFinite(style.opacity) ? style.opacity : 1;
  const lineWidth = Number.isFinite(style.size) ? style.size : 4;
  const color = style.color || '#1f1f1f';

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = lineWidth;
  ctx.globalAlpha = opacity;

  if (brush === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.moveTo(seg.x1, seg.y1);
    ctx.lineTo(seg.x2, seg.y2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (brush === 'pen') {
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(seg.x1, seg.y1);
    ctx.lineTo(seg.x2, seg.y2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (brush === 'marker') {
    ctx.strokeStyle = color;
    ctx.globalAlpha = Math.min(opacity, 0.35);
    ctx.lineCap = 'square';
    ctx.lineWidth = lineWidth * 1.6;
    ctx.beginPath();
    ctx.moveTo(seg.x1, seg.y1);
    ctx.lineTo(seg.x2, seg.y2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (brush === 'spray') {
    ctx.fillStyle = color;
    const distance = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
    const dots = Math.max(8, Math.round(distance * 1.2));
    const radius = Math.max(2, lineWidth * 1.1);
    for (let i = 0; i < dots; i += 1) {
      const t = i / dots;
      const x = seg.x1 + (seg.x2 - seg.x1) * t;
      const y = seg.y1 + (seg.y2 - seg.y1) * t;
      const angle = Math.random() * Math.PI * 2;
      const spread = Math.random() * radius;
      ctx.fillRect(x + Math.cos(angle) * spread, y + Math.sin(angle) * spread, 1.2, 1.2);
    }
    ctx.restore();
    return;
  }

  ctx.strokeStyle = color;
  const jitter = Math.max(0.4, lineWidth * 0.1);
  ctx.beginPath();
  ctx.moveTo(seg.x1 + (Math.random() - 0.5) * jitter, seg.y1 + (Math.random() - 0.5) * jitter);
  ctx.lineTo(seg.x2 + (Math.random() - 0.5) * jitter, seg.y2 + (Math.random() - 0.5) * jitter);
  ctx.stroke();

  ctx.globalAlpha = Math.max(0.2, opacity * 0.65);
  ctx.beginPath();
  ctx.moveTo(seg.x1 + (Math.random() - 0.5) * jitter, seg.y1 + (Math.random() - 0.5) * jitter);
  ctx.lineTo(seg.x2 + (Math.random() - 0.5) * jitter, seg.y2 + (Math.random() - 0.5) * jitter);
  ctx.stroke();
  ctx.restore();
}

function redrawAll() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBoardImage();
  for (const stroke of strokesById.values()) {
    if (stroke.undone) continue;
    for (const seg of stroke.segments) {
      drawSegment(seg, stroke);
    }
  }
}

function pointFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  if (e.touches && e.touches.length > 0) {
    return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
  }
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function imageHitTest(point) {
  if (!boardImage.img) {
    return false;
  }
  return (
    point.x >= boardImage.x &&
    point.x <= boardImage.x + boardImage.width &&
    point.y >= boardImage.y &&
    point.y <= boardImage.y + boardImage.height
  );
}

function startDraw(e) {
  if (!ensureJoined()) {
    return;
  }
  const point = pointFromEvent(e);

  if (moveImageMode && imageHitTest(point)) {
    draggingImage = true;
    dragOffsetX = point.x - boardImage.x;
    dragOffsetY = point.y - boardImage.y;
    return;
  }

  drawing = true;
  last = point;
  currentStrokeId = randomId();
  const stroke = {
    id: currentStrokeId,
    color: colorInput.value,
    size: Number(sizeInput.value),
    opacity: Number(opacityInput.value) / 100,
    brush: brushInput.value,
    undone: false,
    segments: []
  };
  strokesById.set(stroke.id, stroke);
  socket.emit('start-stroke', {
    strokeId: stroke.id,
    color: stroke.color,
    size: stroke.size,
    opacity: stroke.opacity,
    brush: stroke.brush
  });
}

function moveDraw(e) {
  const point = pointFromEvent(e);

  if (draggingImage && boardImage.img) {
    boardImage.x = point.x - dragOffsetX;
    boardImage.y = point.y - dragOffsetY;
    redrawAll();
    if (currentRoomId) {
      socket.emit('move-image', { x: boardImage.x, y: boardImage.y });
    }
    return;
  }

  if (!drawing || !currentStrokeId) return;
  const seg = { x1: last.x, y1: last.y, x2: point.x, y2: point.y };
  const stroke = strokesById.get(currentStrokeId);
  if (!stroke) return;
  stroke.segments.push(seg);
  drawSegment(seg, stroke);
  socket.emit('draw-segment', { strokeId: currentStrokeId, ...seg });
  last = point;
}

function stopDraw() {
  if (draggingImage && boardImage.img && currentRoomId) {
    socket.emit('move-image', { x: boardImage.x, y: boardImage.y });
  }
  drawing = false;
  last = null;
  currentStrokeId = null;
  draggingImage = false;
}

function loadFromQuery() {
  const params = new URLSearchParams(window.location.search);
  roomInput.value = (params.get('room') || '').trim();
  tokenInput.value = (params.get('token') || '').trim();
}

function joinRoom() {
  const roomId = (roomInput.value || '').trim();
  if (!roomId) {
    setStatus('Enter room name to join.');
    return;
  }

  strokesById.clear();
  redrawAll();
  shareLink.textContent = '';
  shareLink.removeAttribute('href');
  socket.emit('join-room', { roomId, token: tokenInput.value.trim() });
}

async function createShareLink() {
  const room = (roomInput.value || '').trim();
  if (!room) {
    setStatus('Enter a room name first.');
    return;
  }
  try {
    const response = await fetch('/api/rooms/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: room })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to create link');
    tokenInput.value = data.token;
    shareLink.textContent = data.shareUrl;
    shareLink.href = data.shareUrl;
    setStatus('Share link ready. Anyone with this URL can join.');
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(data.shareUrl);
      setStatus('Share link copied to clipboard.');
    }
  } catch (error) {
    setStatus(error.message);
  }
}

async function saveRoom() {
  const room = (roomInput.value || '').trim();
  if (!room) {
    setStatus('Enter a room name first.');
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';
  try {
    const response = await fetch('/api/rooms/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: room })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Save failed');
    setStatus(`Room "${data.roomId}" saved (${data.count} strokes).`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Room';
  }
}

function fitImage(img) {
  const maxWidth = canvas.clientWidth * 0.8;
  const maxHeight = canvas.clientHeight * 0.8;
  const ratio = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
  boardImage.scale = ratio;
  boardImage.width = img.width * ratio;
  boardImage.height = img.height * ratio;
  boardImage.x = (canvas.clientWidth - boardImage.width) / 2;
  boardImage.y = (canvas.clientHeight - boardImage.height) / 2;
}

function importImageFile(file) {
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      boardImage.img = img;
      boardImage.dataUrl = String(reader.result);
      fitImage(img);
      imageScaleInput.value = '100';
      redrawAll();
      socket.emit('set-image', {
        dataUrl: boardImage.dataUrl,
        x: boardImage.x,
        y: boardImage.y,
        width: boardImage.width,
        height: boardImage.height
      });
      setStatus('Image imported. Use Move Image to reposition.');
    };
    img.src = String(reader.result);
  };
  reader.readAsDataURL(file);
}

swatchButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const next = btn.getAttribute('data-color');
    if (next) colorInput.value = next;
  });
});

joinBtn.addEventListener('click', joinRoom);
clearBtn.addEventListener('click', () => {
  if (!ensureJoined()) return;
  socket.emit('clear-canvas');
});
undoBtn.addEventListener('click', () => {
  if (!ensureJoined()) return;
  socket.emit('undo');
});
redoBtn.addEventListener('click', () => {
  if (!ensureJoined()) return;
  socket.emit('redo');
});
shareBtn.addEventListener('click', createShareLink);
saveBtn.addEventListener('click', saveRoom);

importImageBtn.addEventListener('click', () => imageInput.click());
imageInput.addEventListener('change', (e) => {
  importImageFile(e.target.files?.[0] || null);
  imageInput.value = '';
});
moveImageBtn.addEventListener('click', () => {
  moveImageMode = !moveImageMode;
  updateMoveImageBtn();
});
imageScaleInput.addEventListener('input', () => {
  if (!boardImage.img) return;
  const baseWidth = boardImage.img.width * boardImage.scale;
  const baseHeight = boardImage.img.height * boardImage.scale;
  const scale = Number(imageScaleInput.value) / 100;
  boardImage.width = baseWidth * scale;
  boardImage.height = baseHeight * scale;
  redrawAll();
  if (currentRoomId) {
    socket.emit('scale-image', { width: boardImage.width, height: boardImage.height });
  }
});
removeImageBtn.addEventListener('click', () => {
  if (!boardImage.img) return;
  boardImage.dataUrl = '';
  boardImage.img = null;
  redrawAll();
  if (ensureJoined()) {
    socket.emit('remove-image');
  }
  setStatus('Image removed.');
});

canvas.addEventListener('mousedown', startDraw);
canvas.addEventListener('mousemove', moveDraw);
window.addEventListener('mouseup', stopDraw);
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  startDraw(e);
});
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  moveDraw(e);
});
window.addEventListener('touchend', stopDraw);

socket.on('join-error', (payload) => {
  setStatus(payload.message || 'Join failed');
  currentRoomId = '';
});
socket.on('join-success', (payload) => {
  currentRoomId = payload.roomId;
  setStatus(`Joined room: ${payload.roomId}${payload.protected ? ' (protected)' : ''}`);
});
socket.on('init-room', ({ image, strokes, protected: isProtected }) => {
  strokesById.clear();
  for (const stroke of strokes) {
    strokesById.set(stroke.id, {
      id: stroke.id,
      color: stroke.color || '#1f1f1f',
      size: Number(stroke.size || 4),
      opacity: Number.isFinite(stroke.opacity) ? stroke.opacity : 1,
      brush: stroke.brush || 'scribble',
      undone: Boolean(stroke.undone),
      segments: Array.isArray(stroke.segments) ? stroke.segments : []
    });
  }
  loadBoardImage(image || null);
  redrawAll();
  if (isProtected) setStatus('Protected room joined.');
});
socket.on('draw-segment', (payload) => {
  if (!payload?.strokeId) return;
  let stroke = strokesById.get(payload.strokeId);
  if (!stroke) {
    stroke = {
      id: payload.strokeId,
      color: payload.color || '#1f1f1f',
      size: Number(payload.size || 4),
      opacity: Number.isFinite(payload.opacity) ? payload.opacity : 1,
      brush: payload.brush || 'scribble',
      undone: false,
      segments: []
    };
    strokesById.set(stroke.id, stroke);
  }
  const seg = {
    x1: Number(payload.x1),
    y1: Number(payload.y1),
    x2: Number(payload.x2),
    y2: Number(payload.y2)
  };
  stroke.segments.push(seg);
  if (!stroke.undone) drawSegment(seg, stroke);
});
socket.on('undo-stroke', ({ strokeId }) => {
  const stroke = strokesById.get(strokeId);
  if (!stroke) return;
  stroke.undone = true;
  redrawAll();
});
socket.on('redo-stroke', ({ stroke }) => {
  if (!stroke?.id) return;
  strokesById.set(stroke.id, {
    id: stroke.id,
    color: stroke.color || '#1f1f1f',
    size: Number(stroke.size || 4),
    opacity: Number.isFinite(stroke.opacity) ? stroke.opacity : 1,
    brush: stroke.brush || 'scribble',
    undone: false,
    segments: Array.isArray(stroke.segments) ? stroke.segments : []
  });
  redrawAll();
});
socket.on('clear-canvas', () => {
  strokesById.clear();
  redrawAll();
});
socket.on('users-count', (count) => {
  usersCount.textContent = `Users: ${count}`;
});

socket.on('image-updated', (payload) => {
  loadBoardImage(payload, 'Image synced for room.');
});

socket.on('image-moved', (payload) => {
  if (!boardImage.img) return;
  boardImage.x = Number(payload.x || 0);
  boardImage.y = Number(payload.y || 0);
  redrawAll();
});

socket.on('image-scaled', (payload) => {
  if (!boardImage.img) return;
  boardImage.width = Number(payload.width || boardImage.width);
  boardImage.height = Number(payload.height || boardImage.height);
  redrawAll();
});

socket.on('image-removed', () => {
  boardImage.dataUrl = '';
  boardImage.img = null;
  redrawAll();
});

window.addEventListener('resize', resize);
loadFromQuery();
resize();
updateMoveImageBtn();
if (roomInput.value.trim()) {
  joinRoom();
} else {
  setStatus('Enter room name and click Join.');
}
