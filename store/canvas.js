// Холст хранится в памяти как Uint8Array 500*500, каждый байт — индекс цвета:
// 0 = пусто (#ffffff), 1..4 = индекс в палитре COLORS (см. server.js).
// Периодически сбрасывается на диск в бинарный файл, чтобы состояние
// переживало перезапуск сервера.

const fs = require('fs');
const path = require('path');

const SIZE = 500;
const DATA_DIR = path.join(__dirname, '..', 'data');
const CANVAS_FILE = path.join(DATA_DIR, 'canvas.bin');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let buffer;
if (fs.existsSync(CANVAS_FILE)) {
  const fileBuf = fs.readFileSync(CANVAS_FILE);
  if (fileBuf.length === SIZE * SIZE) {
    buffer = new Uint8Array(fileBuf);
  } else {
    // Файл от холста другого размера — начинаем заново.
    buffer = new Uint8Array(SIZE * SIZE);
  }
} else {
  buffer = new Uint8Array(SIZE * SIZE);
}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFile(CANVAS_FILE, Buffer.from(buffer), () => {});
  }, 1000);
}

function setPixel(x, y, colorIndex) {
  buffer[y * SIZE + x] = colorIndex;
  scheduleSave();
}

function getPixel(x, y) {
  return buffer[y * SIZE + x];
}

function getBuffer() {
  return buffer;
}

module.exports = { setPixel, getPixel, getBuffer, SIZE };
