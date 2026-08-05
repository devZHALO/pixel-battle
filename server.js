const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const WebSocket = require('ws');

const users = require('./store/users');
const canvasStore = require('./store/canvas');

const PORT = process.env.PORT || 3000;
const COOLDOWN_MS = 60 * 1000; // 1 минута
const CANVAS_SIZE = canvasStore.SIZE; // 500

// Палитра (32 цвета). Индекс 0 в хранилище холста = "пусто" (#ffffff),
// индексы 1..32 соответствуют этому списку по порядку.
const COLORS = [
  '#000000', '#3A3A3A', '#515252', '#808080', '#D4D7D9', '#FFFFFF',
  '#6D001A', '#BE0039', '#BE0075', '#FF4500', '#FFA800', '#FFD635', '#FFF8B8',
  '#00A368', '#00CC78', '#7EED56', '#00756F', '#009E9E', '#51E9F4',
  '#2450A4', '#3690EA', '#493FA5', '#6A5CFF', '#811E9F', '#B44AC0',
  '#FF99AA', '#FFD4E5', '#6D482F', '#9C6926', '#CC6E3B', '#FFB470', '#E4AB9F',
];

const app = express();
app.use(express.json());

const sessionMiddleware = session({
  secret: 'pixel-battle-local-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 дней
    httpOnly: true,
    sameSite: 'lax',
  },
});
app.use(sessionMiddleware);

app.use(express.static(path.join(__dirname, 'public')));

// Пользователь с этим никнеймом (без учёта регистра) рисует без кулдауна.
const UNLIMITED_USERNAME = 'oguricappu';

function hasNoCooldown(username) {
  return String(username).toLowerCase() === UNLIMITED_USERNAME;
}

// Время последнего размещённого пикселя на пользователя (ключ — username в нижнем регистре).
const lastPlacement = {};

function getCooldownRemaining(username) {
  if (hasNoCooldown(username)) return 0;
  const last = lastPlacement[username.toLowerCase()] || 0;
  return Math.max(0, COOLDOWN_MS - (Date.now() - last));
}

// ---------- Авторизация ----------

app.post('/api/register', async (req, res) => {
  const { username, password, acceptTos, acceptPrivacy } = req.body || {};

  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Введите никнейм и пароль' });
  }
  if (acceptTos !== true || acceptPrivacy !== true) {
    return res.status(400).json({ error: 'Нужно принять условия использования и политику конфиденциальности' });
  }
  const trimmed = username.trim();
  if (trimmed.length < 3 || trimmed.length > 20) {
    return res.status(400).json({ error: 'Никнейм должен быть от 3 до 20 символов' });
  }
  if (!/^[a-zA-Zа-яА-ЯёЁ0-9_]+$/.test(trimmed)) {
    return res.status(400).json({ error: 'Никнейм может содержать только буквы, цифры и "_"' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Пароль должен быть не короче 4 символов' });
  }
  if (!users.usernameAvailable(trimmed)) {
    return res.status(409).json({ error: 'Такой никнейм уже занят' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = users.createUser(trimmed, passwordHash);

  req.session.userId = user.id;
  req.session.username = user.username;

  res.json({ username: user.username, noCooldown: hasNoCooldown(user.username) });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Введите никнейм и пароль' });
  }

  const user = users.findUser(username.trim());
  if (!user) {
    return res.status(401).json({ error: 'Неверный никнейм или пароль' });
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: 'Неверный никнейм или пароль' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;

  res.json({ username: user.username, noCooldown: hasNoCooldown(user.username) });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

function requireAuth(req, res, next) {
  if (!req.session || !req.session.username) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  next();
}

app.get('/api/me', (req, res) => {
  if (!req.session || !req.session.username) {
    return res.json({ user: null });
  }
  const username = req.session.username;
  res.json({
    user: { username, noCooldown: hasNoCooldown(username) },
    cooldownRemaining: getCooldownRemaining(username),
    cooldownMs: COOLDOWN_MS,
  });
});

// ---------- Холст ----------

app.get('/api/canvas', requireAuth, (req, res) => {
  res.set('Content-Type', 'application/octet-stream');
  res.send(Buffer.from(canvasStore.getBuffer()));
});

app.post('/api/pixel', requireAuth, (req, res) => {
  const { x, y, colorIndex } = req.body || {};

  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= CANVAS_SIZE || y >= CANVAS_SIZE) {
    return res.status(400).json({ error: 'Некорректные координаты' });
  }
  if (!Number.isInteger(colorIndex) || colorIndex < 1 || colorIndex > COLORS.length) {
    return res.status(400).json({ error: 'Некорректный цвет' });
  }

  const username = req.session.username;
  const unlimited = hasNoCooldown(username);

  if (!unlimited) {
    const remaining = getCooldownRemaining(username);
    if (remaining > 0) {
      return res.status(429).json({ error: 'Подождите перед следующим пикселем', cooldownRemaining: remaining });
    }
  }

  canvasStore.setPixel(x, y, colorIndex);
  lastPlacement[username.toLowerCase()] = Date.now();

  broadcast({ type: 'pixel', x, y, colorIndex, username });

  res.json({ ok: true, cooldownRemaining: unlimited ? 0 : COOLDOWN_MS });
});

// ---------- Сервер + WebSocket ----------

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

function broadcast(message) {
  const data = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

server.listen(PORT, () => {
  console.log(`Pixel Battle запущен: http://localhost:${PORT}`);
});
