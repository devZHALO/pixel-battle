// Простое файловое хранилище пользователей (JSON).
// Для локального теста этого достаточно и не требует установки/сборки СУБД.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify([]));

function loadUsers() {
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function findUser(username) {
  const users = loadUsers();
  return users.find((u) => u.username.toLowerCase() === String(username).toLowerCase()) || null;
}

function usernameAvailable(username) {
  return !findUser(username);
}

function createUser(username, passwordHash) {
  const users = loadUsers();
  const nextId = users.length ? Math.max(...users.map((u) => u.id)) + 1 : 1;
  const user = {
    id: nextId,
    username,
    passwordHash,
    createdAt: Date.now(),
  };
  users.push(user);
  saveUsers(users);
  return user;
}

module.exports = { findUser, createUser, usernameAvailable };
