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
const imageUndoBtn = document.getElementById('imageUndoBtn');
const imageRedoBtn = document.getElementById('imageRedoBtn');
const moveImageBtn = document.getElementById('moveImageBtn');
const fitContainBtn = document.getElementById('fitContainBtn');
const fillBgBtn = document.getElementById('fillBgBtn');
const originalSizeBtn = document.getElementById('originalSizeBtn');
const imageWidthInput = document.getElementById('imageWidthInput');
const imageHeightInput = document.getElementById('imageHeightInput');
const removeImageBtn = document.getElementById('removeImageBtn');

const frameStyleInput = document.getElementById('frameStyleInput');
const frameColorInput = document.getElementById('frameColorInput');
const frameWidthInput = document.getElementById('frameWidthInput');

const textInput = document.getElementById('textInput');
const textSizeInput = document.getElementById('textSizeInput');
const textPlaceInput = document.getElementById('textPlaceInput');
const textModeBtn = document.getElementById('textModeBtn');
const textMoveModeBtn = document.getElementById('textMoveModeBtn');
const textEditModeBtn = document.getElementById('textEditModeBtn');
const removeLastTextBtn = document.getElementById('removeLastTextBtn');

const fillModeBtn = document.getElementById('fillModeBtn');
const fillToleranceInput = document.getElementById('fillToleranceInput');

const cropModeBtn = document.getElementById('cropModeBtn');
const cutModeBtn = document.getElementById('cutModeBtn');
const applyEditBtn = document.getElementById('applyEditBtn');
const cancelEditBtn = document.getElementById('cancelEditBtn');

let drawing = false;
let last = null;
let currentStrokeId = null;
let currentRoomId = '';
let moveImageMode = false;
let fillMode = false;
let textMode = false;
let textMoveMode = false;
let textEditMode = false;
let editMode = null;
let draggingImage = false;
let draggingText = false;
let draggingTextId = '';
let textDragOffsetX = 0;
let textDragOffsetY = 0;
let resizeAdjustActive = false;
let frameAdjustActive = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let selectionRect = null;
let selectionDraft = null;
const strokesById = new Map();
const textItems = [];
const imageHistory = [];
let imageHistoryIndex = -1;

const boardImage = {
  dataUrl: '',
  img: null,
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  baseWidth: 0,
  baseHeight: 0,
  frame: {
    style: 'none',
    color: '#111111',
    width: 3
  }
};

function setStatus(text) {
  statusText.textContent = text;
}

function randomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getImageSnapshot() {
  if (!boardImage.dataUrl || !boardImage.img) {
    return null;
  }
  return {
    dataUrl: boardImage.dataUrl,
    x: boardImage.x,
    y: boardImage.y,
    width: boardImage.width,
    height: boardImage.height,
    frame: {
      style: boardImage.frame.style,
      color: boardImage.frame.color,
      width: boardImage.frame.width
    }
  };
}

function isSameSnapshot(a, b) {
  if (!a || !b) return false;
  return (
    a.dataUrl === b.dataUrl &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.frame.style === b.frame.style &&
    a.frame.color === b.frame.color &&
    a.frame.width === b.frame.width
  );
}

function pushImageHistory() {
  const snap = getImageSnapshot();
  if (!snap) {
    return;
  }
  const last = imageHistory[imageHistoryIndex];
  if (isSameSnapshot(last, snap)) {
    return;
  }
  imageHistory.splice(imageHistoryIndex + 1);
  imageHistory.push(snap);
  if (imageHistory.length > 50) {
    imageHistory.shift();
  }
  imageHistoryIndex = imageHistory.length - 1;
}

function resetImageHistory() {
  imageHistory.length = 0;
  imageHistoryIndex = -1;
  pushImageHistory();
}

function applyImageSnapshot(snapshot, statusTextMessage) {
  if (!snapshot) return;
  loadBoardImage(snapshot, statusTextMessage);
  emitImageState();
}

function imageUndo() {
  if (imageHistoryIndex <= 0) {
    setStatus('No more image undo steps.');
    return;
  }
  imageHistoryIndex -= 1;
  applyImageSnapshot(imageHistory[imageHistoryIndex], 'Image undo applied.');
}

function imageRedo() {
  if (imageHistoryIndex >= imageHistory.length - 1) {
    setStatus('No more image redo steps.');
    return;
  }
  imageHistoryIndex += 1;
  applyImageSnapshot(imageHistory[imageHistoryIndex], 'Image redo applied.');
}

function getTextAt(point) {
  for (let i = textItems.length - 1; i >= 0; i -= 1) {
    const item = textItems[i];
    ctx.save();
    ctx.font = `${Number(item.size || 24)}px "Segoe UI"`;
    const width = ctx.measureText(item.text || '').width;
    ctx.restore();
    const height = Number(item.size || 24) * 1.15;
    if (
      point.x >= item.x &&
      point.x <= item.x + width &&
      point.y >= item.y &&
      point.y <= item.y + height
    ) {
      return item;
    }
  }
  return null;
}

function updateModeButtons() {
  moveImageBtn.classList.toggle('active', moveImageMode);
  moveImageBtn.textContent = moveImageMode ? 'Move Image: ON' : 'Move Image';
  fillModeBtn.classList.toggle('active', fillMode);
  textModeBtn.classList.toggle('active', textMode);
  textMoveModeBtn.classList.toggle('active', textMoveMode);
  textEditModeBtn.classList.toggle('active', textEditMode);
  cropModeBtn.classList.toggle('active', editMode === 'crop');
  cutModeBtn.classList.toggle('active', editMode === 'cut');
}

function disableOtherModes(except) {
  moveImageMode = except === 'move';
  fillMode = except === 'fill';
  textMode = except === 'text';
  textMoveMode = except === 'text-move';
  textEditMode = except === 'text-edit';
  editMode = except === 'crop' ? 'crop' : except === 'cut' ? 'cut' : null;
  draggingText = false;
  draggingTextId = '';
  selectionRect = null;
  selectionDraft = null;
  updateModeButtons();
  redrawAll();
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

function drawImageFrame() {
  if (!boardImage.img || boardImage.frame.style === 'none') {
    return;
  }
  ctx.save();
  const border = Number(boardImage.frame.width || 3);
  ctx.lineWidth = border;
  ctx.strokeStyle = boardImage.frame.color || '#111111';

  if (boardImage.frame.style === 'dashed') {
    ctx.setLineDash([12, 8]);
    ctx.strokeRect(boardImage.x, boardImage.y, boardImage.width, boardImage.height);
  } else if (boardImage.frame.style === 'double') {
    ctx.strokeRect(boardImage.x, boardImage.y, boardImage.width, boardImage.height);
    const inset = border * 2;
    ctx.strokeRect(boardImage.x + inset, boardImage.y + inset, boardImage.width - inset * 2, boardImage.height - inset * 2);
  } else if (boardImage.frame.style === 'glow') {
    ctx.shadowColor = boardImage.frame.color || '#111111';
    ctx.shadowBlur = 14;
    ctx.strokeRect(boardImage.x, boardImage.y, boardImage.width, boardImage.height);
  } else {
    ctx.strokeRect(boardImage.x, boardImage.y, boardImage.width, boardImage.height);
  }
  ctx.restore();
}

function drawBoardImage() {
  if (!boardImage.img) {
    return;
  }
  ctx.drawImage(boardImage.img, boardImage.x, boardImage.y, boardImage.width, boardImage.height);
  drawImageFrame();
}

function drawTexts() {
  for (const item of textItems) {
    ctx.save();
    ctx.fillStyle = item.color || '#111111';
    ctx.font = `${Number(item.size || 24)}px "Segoe UI"`;
    ctx.textBaseline = 'top';
    ctx.fillText(item.text || '', Number(item.x || 0), Number(item.y || 0));
    ctx.restore();
  }
}

function drawSelection() {
  const rect = selectionDraft
    ? {
        x: Math.min(selectionDraft.x1, selectionDraft.x2),
        y: Math.min(selectionDraft.y1, selectionDraft.y2),
        width: Math.abs(selectionDraft.x2 - selectionDraft.x1),
        height: Math.abs(selectionDraft.y2 - selectionDraft.y1)
      }
    : selectionRect;
  if (!rect) {
    return;
  }
  ctx.save();
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.08)';
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
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
    ctx.lineWidth = lineWidth * 1.4;
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
    const dots = Math.max(8, Math.round(distance * 1.4));
    const radius = Math.max(2, lineWidth * 1.2);
    for (let i = 0; i < dots; i += 1) {
      const t = i / dots;
      const x = seg.x1 + (seg.x2 - seg.x1) * t;
      const y = seg.y1 + (seg.y2 - seg.y1) * t;
      const angle = Math.random() * Math.PI * 2;
      const spread = Math.random() * radius;
      ctx.fillRect(x + Math.cos(angle) * spread, y + Math.sin(angle) * spread, 1.4, 1.4);
    }
    ctx.restore();
    return;
  }

  if (brush === 'neon') {
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10 + lineWidth;
    ctx.beginPath();
    ctx.moveTo(seg.x1, seg.y1);
    ctx.lineTo(seg.x2, seg.y2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (brush === 'calligraphy') {
    ctx.strokeStyle = color;
    ctx.lineCap = 'butt';
    ctx.lineWidth = lineWidth * 1.3;
    ctx.beginPath();
    ctx.moveTo(seg.x1 - lineWidth * 0.2, seg.y1);
    ctx.lineTo(seg.x2 + lineWidth * 0.2, seg.y2);
    ctx.stroke();
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
  drawTexts();
  for (const stroke of strokesById.values()) {
    if (stroke.undone) continue;
    for (const seg of stroke.segments) {
      drawSegment(seg, stroke);
    }
  }
  drawSelection();
}

function fitImageContain() {
  if (!boardImage.img) {
    return;
  }
  const maxWidth = canvas.clientWidth * 0.9;
  const maxHeight = canvas.clientHeight * 0.9;
  const ratio = Math.min(maxWidth / boardImage.img.width, maxHeight / boardImage.img.height, 1);
  boardImage.width = boardImage.img.width * ratio;
  boardImage.height = boardImage.img.height * ratio;
  boardImage.x = (canvas.clientWidth - boardImage.width) / 2;
  boardImage.y = (canvas.clientHeight - boardImage.height) / 2;
  boardImage.baseWidth = boardImage.width;
  boardImage.baseHeight = boardImage.height;
  imageWidthInput.value = '100';
  imageHeightInput.value = '100';
}

function fitImageFillBackground() {
  if (!boardImage.img) {
    return;
  }
  const ratio = Math.max(canvas.clientWidth / boardImage.img.width, canvas.clientHeight / boardImage.img.height);
  boardImage.width = boardImage.img.width * ratio;
  boardImage.height = boardImage.img.height * ratio;
  boardImage.x = (canvas.clientWidth - boardImage.width) / 2;
  boardImage.y = (canvas.clientHeight - boardImage.height) / 2;
  boardImage.baseWidth = boardImage.width;
  boardImage.baseHeight = boardImage.height;
  imageWidthInput.value = '100';
  imageHeightInput.value = '100';
}

function setOriginalImageSize() {
  if (!boardImage.img) {
    return;
  }
  boardImage.width = boardImage.img.width;
  boardImage.height = boardImage.img.height;
  boardImage.x = (canvas.clientWidth - boardImage.width) / 2;
  boardImage.y = (canvas.clientHeight - boardImage.height) / 2;
  boardImage.baseWidth = boardImage.width;
  boardImage.baseHeight = boardImage.height;
  imageWidthInput.value = '100';
  imageHeightInput.value = '100';
}

function emitImageState() {
  if (!currentRoomId || !boardImage.dataUrl) {
    return;
  }
  socket.emit('set-image', {
    dataUrl: boardImage.dataUrl,
    x: boardImage.x,
    y: boardImage.y,
    width: boardImage.width,
    height: boardImage.height,
    frame: boardImage.frame
  });
}

function loadBoardImage(payload, statusMessage, resetHistoryState = false) {
  if (!payload?.dataUrl) {
    boardImage.dataUrl = '';
    boardImage.img = null;
    imageHistory.length = 0;
    imageHistoryIndex = -1;
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
    boardImage.baseWidth = boardImage.width;
    boardImage.baseHeight = boardImage.height;
    boardImage.frame = {
      style: String(payload.frame?.style || 'none'),
      color: String(payload.frame?.color || '#111111'),
      width: Number(payload.frame?.width || 3)
    };
    frameStyleInput.value = boardImage.frame.style;
    frameColorInput.value = boardImage.frame.color;
    frameWidthInput.value = String(boardImage.frame.width);
    imageWidthInput.value = '100';
    imageHeightInput.value = '100';
    redrawAll();
    if (resetHistoryState) {
      resetImageHistory();
    }
    if (statusMessage) {
      setStatus(statusMessage);
    }
  };
  img.src = payload.dataUrl;
}

function importImageFile(file) {
  if (!file || !ensureJoined()) {
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      boardImage.img = img;
      boardImage.dataUrl = String(reader.result);
      boardImage.frame = {
        style: frameStyleInput.value,
        color: frameColorInput.value,
        width: Number(frameWidthInput.value)
      };
      fitImageContain();
      redrawAll();
      emitImageState();
      resetImageHistory();
      setStatus('Image imported and synced.');
    };
    img.src = String(reader.result);
  };
  reader.readAsDataURL(file);
}

function getSelectionRectFromDraft() {
  if (!selectionDraft) {
    return null;
  }
  const x = Math.min(selectionDraft.x1, selectionDraft.x2);
  const y = Math.min(selectionDraft.y1, selectionDraft.y2);
  const width = Math.abs(selectionDraft.x2 - selectionDraft.x1);
  const height = Math.abs(selectionDraft.y2 - selectionDraft.y1);
  if (width < 2 || height < 2) {
    return null;
  }
  return { x, y, width, height };
}

function applyImageEdit() {
  if (!boardImage.img || !selectionRect || !ensureJoined()) {
    setStatus('Select an area on the image first.');
    return;
  }
  const intersection = {
    x: Math.max(selectionRect.x, boardImage.x),
    y: Math.max(selectionRect.y, boardImage.y),
    width: Math.min(selectionRect.x + selectionRect.width, boardImage.x + boardImage.width) - Math.max(selectionRect.x, boardImage.x),
    height: Math.min(selectionRect.y + selectionRect.height, boardImage.y + boardImage.height) - Math.max(selectionRect.y, boardImage.y)
  };
  if (intersection.width <= 2 || intersection.height <= 2) {
    setStatus('Selection must overlap the image.');
    return;
  }

  const imgW = boardImage.img.width;
  const imgH = boardImage.img.height;
  const sx = Math.floor(((intersection.x - boardImage.x) / boardImage.width) * imgW);
  const sy = Math.floor(((intersection.y - boardImage.y) / boardImage.height) * imgH);
  const sw = Math.floor((intersection.width / boardImage.width) * imgW);
  const sh = Math.floor((intersection.height / boardImage.height) * imgH);

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = imgW;
  srcCanvas.height = imgH;
  const srcCtx = srcCanvas.getContext('2d');
  srcCtx.drawImage(boardImage.img, 0, 0);

  if (editMode === 'crop') {
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = sw;
    cropCanvas.height = sh;
    const cropCtx = cropCanvas.getContext('2d');
    cropCtx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
    loadBoardImage(
      {
        dataUrl: cropCanvas.toDataURL('image/png'),
        x: intersection.x,
        y: intersection.y,
        width: intersection.width,
        height: intersection.height,
        frame: boardImage.frame
      },
      'Crop applied.'
    );
  } else if (editMode === 'cut') {
    srcCtx.clearRect(sx, sy, sw, sh);
    loadBoardImage(
      {
        dataUrl: srcCanvas.toDataURL('image/png'),
        x: boardImage.x,
        y: boardImage.y,
        width: boardImage.width,
        height: boardImage.height,
        frame: boardImage.frame
      },
      'Cut applied.'
    );
  }

  emitImageState();
  pushImageHistory();
  selectionRect = null;
  selectionDraft = null;
  editMode = null;
  updateModeButtons();
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const value = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

function floodFillImageAt(point) {
  if (!boardImage.img || !imageHitTest(point) || !ensureJoined()) {
    setStatus('Click inside the image to fill.');
    return;
  }
  const px = Math.floor(((point.x - boardImage.x) / boardImage.width) * boardImage.img.width);
  const py = Math.floor(((point.y - boardImage.y) / boardImage.height) * boardImage.img.height);
  const targetColor = hexToRgb(colorInput.value);
  const tolerance = Number(fillToleranceInput.value);

  const fillCanvas = document.createElement('canvas');
  fillCanvas.width = boardImage.img.width;
  fillCanvas.height = boardImage.img.height;
  const fillCtx = fillCanvas.getContext('2d');
  fillCtx.drawImage(boardImage.img, 0, 0);

  const imageData = fillCtx.getImageData(0, 0, fillCanvas.width, fillCanvas.height);
  const { data } = imageData;
  const width = fillCanvas.width;
  const startIdx = (py * width + px) * 4;
  const start = {
    r: data[startIdx],
    g: data[startIdx + 1],
    b: data[startIdx + 2],
    a: data[startIdx + 3]
  };

  const sameStart =
    Math.abs(start.r - targetColor.r) <= 1 &&
    Math.abs(start.g - targetColor.g) <= 1 &&
    Math.abs(start.b - targetColor.b) <= 1 &&
    start.a > 245;
  if (sameStart) {
    return;
  }

  const stack = [[px, py]];
  const visited = new Uint8Array(width * fillCanvas.height);

  function matches(ix, iy) {
    const i = (iy * width + ix) * 4;
    return (
      Math.abs(data[i] - start.r) <= tolerance &&
      Math.abs(data[i + 1] - start.g) <= tolerance &&
      Math.abs(data[i + 2] - start.b) <= tolerance &&
      Math.abs(data[i + 3] - start.a) <= tolerance
    );
  }

  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= width || y >= fillCanvas.height) {
      continue;
    }
    const flat = y * width + x;
    if (visited[flat]) {
      continue;
    }
    visited[flat] = 1;
    if (!matches(x, y)) {
      continue;
    }
    const i = flat * 4;
    data[i] = targetColor.r;
    data[i + 1] = targetColor.g;
    data[i + 2] = targetColor.b;
    data[i + 3] = 255;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  fillCtx.putImageData(imageData, 0, 0);
  loadBoardImage(
    {
      dataUrl: fillCanvas.toDataURL('image/png'),
      x: boardImage.x,
      y: boardImage.y,
      width: boardImage.width,
      height: boardImage.height,
      frame: boardImage.frame
    },
    'Fill applied.'
  );
  emitImageState();
  pushImageHistory();
}

function addTextAt(point) {
  if (!ensureJoined()) {
    return;
  }
  const value = (textInput.value || '').trim();
  if (!value) {
    setStatus('Type text first.');
    return;
  }
  const place = textPlaceInput.value;
  const inside = imageHitTest(point);
  if (place === 'inside' && !inside) {
    setStatus('Click inside image for this text mode.');
    return;
  }
  if (place === 'outside' && inside) {
    setStatus('Click outside image for this text mode.');
    return;
  }

  const item = {
    id: randomId(),
    text: value,
    x: point.x,
    y: point.y,
    size: Number(textSizeInput.value),
    color: colorInput.value
  };
  textItems.push(item);
  redrawAll();
  socket.emit('add-text', item);
}

function removeLastText() {
  if (!ensureJoined() || textItems.length === 0) {
    return;
  }
  const item = textItems[textItems.length - 1];
  textItems.pop();
  redrawAll();
  socket.emit('remove-text', { id: item.id });
}

function startDraw(e) {
  if (!ensureJoined()) {
    return;
  }
  const point = pointFromEvent(e);

  if (editMode === 'crop' || editMode === 'cut') {
    selectionDraft = { x1: point.x, y1: point.y, x2: point.x, y2: point.y };
    return;
  }

  if (textMode) {
    addTextAt(point);
    return;
  }

  if (textEditMode) {
    const hitText = getTextAt(point);
    if (!hitText) {
      setStatus('Click on existing text to edit.');
      return;
    }
    const nextText = window.prompt('Edit text', hitText.text || '');
    if (nextText === null) {
      return;
    }
    const trimmed = nextText.trim();
    if (!trimmed) {
      return;
    }
    hitText.text = trimmed;
    hitText.size = Number(textSizeInput.value);
    hitText.color = colorInput.value;
    redrawAll();
    socket.emit('update-text', {
      id: hitText.id,
      text: hitText.text,
      size: hitText.size,
      color: hitText.color
    });
    return;
  }

  if (textMoveMode) {
    const hitText = getTextAt(point);
    if (!hitText) {
      setStatus('Click on text to move.');
      return;
    }
    draggingText = true;
    draggingTextId = hitText.id;
    textDragOffsetX = point.x - hitText.x;
    textDragOffsetY = point.y - hitText.y;
    return;
  }

  if (fillMode) {
    floodFillImageAt(point);
    return;
  }

  if (moveImageMode && imageHitTest(point)) {
    draggingImage = true;
    pushImageHistory();
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

  if (selectionDraft) {
    selectionDraft.x2 = point.x;
    selectionDraft.y2 = point.y;
    redrawAll();
    return;
  }

  if (draggingImage && boardImage.img) {
    boardImage.x = point.x - dragOffsetX;
    boardImage.y = point.y - dragOffsetY;
    redrawAll();
    if (currentRoomId) {
      socket.emit('move-image', { x: boardImage.x, y: boardImage.y });
    }
    return;
  }

  if (draggingText) {
    const item = textItems.find((t) => t.id === draggingTextId);
    if (!item) {
      return;
    }
    item.x = point.x - textDragOffsetX;
    item.y = point.y - textDragOffsetY;
    redrawAll();
    socket.emit('update-text', { id: item.id, x: item.x, y: item.y });
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
  if (selectionDraft) {
    selectionRect = getSelectionRectFromDraft();
    selectionDraft = null;
    redrawAll();
  }
  if (draggingImage && boardImage.img && currentRoomId) {
    socket.emit('move-image', { x: boardImage.x, y: boardImage.y });
    pushImageHistory();
  }
  if (draggingText && currentRoomId) {
    const item = textItems.find((t) => t.id === draggingTextId);
    if (item) {
      socket.emit('update-text', { id: item.id, x: item.x, y: item.y });
    }
  }
  drawing = false;
  last = null;
  currentStrokeId = null;
  draggingImage = false;
  draggingText = false;
  draggingTextId = '';
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
  currentRoomId = '';
  strokesById.clear();
  textItems.length = 0;
  loadBoardImage(null);
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
    setStatus(`Room "${data.roomId}" saved.`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Room';
  }
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

fillModeBtn.addEventListener('click', () => {
  disableOtherModes(fillMode ? null : 'fill');
});
textModeBtn.addEventListener('click', () => {
  disableOtherModes(textMode ? null : 'text');
});
textMoveModeBtn.addEventListener('click', () => {
  disableOtherModes(textMoveMode ? null : 'text-move');
});
textEditModeBtn.addEventListener('click', () => {
  disableOtherModes(textEditMode ? null : 'text-edit');
});
moveImageBtn.addEventListener('click', () => {
  disableOtherModes(moveImageMode ? null : 'move');
});
cropModeBtn.addEventListener('click', () => {
  disableOtherModes(editMode === 'crop' ? null : 'crop');
});
cutModeBtn.addEventListener('click', () => {
  disableOtherModes(editMode === 'cut' ? null : 'cut');
});
applyEditBtn.addEventListener('click', applyImageEdit);
cancelEditBtn.addEventListener('click', () => {
  selectionRect = null;
  selectionDraft = null;
  editMode = null;
  updateModeButtons();
  redrawAll();
});

importImageBtn.addEventListener('click', () => imageInput.click());
imageUndoBtn.addEventListener('click', imageUndo);
imageRedoBtn.addEventListener('click', imageRedo);
imageInput.addEventListener('change', (e) => {
  importImageFile(e.target.files?.[0] || null);
  imageInput.value = '';
});
fitContainBtn.addEventListener('click', () => {
  if (!boardImage.img || !ensureJoined()) return;
  pushImageHistory();
  fitImageContain();
  redrawAll();
  socket.emit('scale-image', { width: boardImage.width, height: boardImage.height });
  socket.emit('move-image', { x: boardImage.x, y: boardImage.y });
  pushImageHistory();
});
fillBgBtn.addEventListener('click', () => {
  if (!boardImage.img || !ensureJoined()) return;
  pushImageHistory();
  fitImageFillBackground();
  redrawAll();
  socket.emit('scale-image', { width: boardImage.width, height: boardImage.height });
  socket.emit('move-image', { x: boardImage.x, y: boardImage.y });
  pushImageHistory();
});
originalSizeBtn.addEventListener('click', () => {
  if (!boardImage.img || !ensureJoined()) return;
  pushImageHistory();
  setOriginalImageSize();
  redrawAll();
  socket.emit('scale-image', { width: boardImage.width, height: boardImage.height });
  socket.emit('move-image', { x: boardImage.x, y: boardImage.y });
  pushImageHistory();
});
imageWidthInput.addEventListener('pointerdown', () => {
  if (!boardImage.img) return;
  if (!resizeAdjustActive) {
    pushImageHistory();
    resizeAdjustActive = true;
  }
});
imageWidthInput.addEventListener('input', () => {
  if (!boardImage.img || !currentRoomId) return;
  boardImage.width = boardImage.baseWidth * (Number(imageWidthInput.value) / 100);
  redrawAll();
  socket.emit('scale-image', { width: boardImage.width, height: boardImage.height });
});
imageWidthInput.addEventListener('change', () => {
  if (!boardImage.img) return;
  pushImageHistory();
  resizeAdjustActive = false;
});
imageHeightInput.addEventListener('pointerdown', () => {
  if (!boardImage.img) return;
  if (!resizeAdjustActive) {
    pushImageHistory();
    resizeAdjustActive = true;
  }
});
imageHeightInput.addEventListener('input', () => {
  if (!boardImage.img || !currentRoomId) return;
  boardImage.height = boardImage.baseHeight * (Number(imageHeightInput.value) / 100);
  redrawAll();
  socket.emit('scale-image', { width: boardImage.width, height: boardImage.height });
});
imageHeightInput.addEventListener('change', () => {
  if (!boardImage.img) return;
  pushImageHistory();
  resizeAdjustActive = false;
});
removeImageBtn.addEventListener('click', () => {
  if (!boardImage.img || !ensureJoined()) return;
  pushImageHistory();
  boardImage.dataUrl = '';
  boardImage.img = null;
  imageHistory.length = 0;
  imageHistoryIndex = -1;
  redrawAll();
  socket.emit('remove-image');
});

frameStyleInput.addEventListener('change', () => {
  if (boardImage.img) pushImageHistory();
  boardImage.frame.style = frameStyleInput.value;
  redrawAll();
  emitImageState();
  if (boardImage.img) pushImageHistory();
});
frameColorInput.addEventListener('input', () => {
  boardImage.frame.color = frameColorInput.value;
  redrawAll();
});
frameColorInput.addEventListener('change', () => {
  if (!boardImage.img) return;
  pushImageHistory();
  emitImageState();
  pushImageHistory();
});
frameWidthInput.addEventListener('input', () => {
  if (boardImage.img && !frameAdjustActive) {
    pushImageHistory();
    frameAdjustActive = true;
  }
  boardImage.frame.width = Number(frameWidthInput.value);
  redrawAll();
  emitImageState();
});
frameWidthInput.addEventListener('change', () => {
  if (!boardImage.img) return;
  pushImageHistory();
  frameAdjustActive = false;
});

removeLastTextBtn.addEventListener('click', removeLastText);

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

socket.on('init-room', ({ image, textItems: serverTextItems, strokes, protected: isProtected }) => {
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
  textItems.length = 0;
  if (Array.isArray(serverTextItems)) {
    textItems.push(...serverTextItems);
  }
  loadBoardImage(image || null, '', true);
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
  loadBoardImage(payload, 'Image synced for room.', true);
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

socket.on('text-added', (item) => {
  if (!item?.id) return;
  if (!textItems.some((t) => t.id === item.id)) {
    textItems.push(item);
    redrawAll();
  }
});

socket.on('text-removed', ({ id }) => {
  const index = textItems.findIndex((item) => item.id === id);
  if (index >= 0) {
    textItems.splice(index, 1);
    redrawAll();
  }
});

socket.on('text-updated', (item) => {
  if (!item?.id) return;
  const existing = textItems.find((textItem) => textItem.id === item.id);
  if (!existing) {
    textItems.push(item);
  } else {
    existing.text = item.text;
    existing.x = Number(item.x || existing.x || 0);
    existing.y = Number(item.y || existing.y || 0);
    existing.size = Number(item.size || existing.size || 24);
    existing.color = item.color || existing.color || '#111111';
  }
  redrawAll();
});

window.addEventListener('resize', resize);
loadFromQuery();
resize();
updateModeButtons();
if (roomInput.value.trim()) {
  joinRoom();
} else {
  setStatus('Enter room name and click Join.');
}
