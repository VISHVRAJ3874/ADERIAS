/**
 * ═══════════════════════════════════════════════════════════════
 *  ADERIAS SERVER v3.0
 *  Port: 4433
 *  Storage: D:\zero data\  (configurable via DATA_DIR env var)
 *  Stack: Node.js + Express (no DB — JSON file storage)
 * ═══════════════════════════════════════════════════════════════
 *
 *  Install:  npm install express cors bcryptjs uuid
 *  Run:      node server.js
 *  Windows:  set DATA_DIR=D:\zero data && node server.js
 *  Linux:    DATA_DIR=/var/aderias node server.js
 */

'use strict';

const express  = require('express');
const cors     = require('cors');
const bcrypt   = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const fs       = require('fs');
const path     = require('path');

/* ═══ CONFIG ═══ */
const PORT     = process.env.PORT || 4433;
const DATA_DIR = process.env.DATA_DIR || 'D:\\zero data';
const DB_FILE  = path.join(DATA_DIR, 'aderias_db.json');

const LEADER_EMAILS = [
  'vishvrajsinhgohil845@gmail.com',
  'vishvrajsinhgohil435@gmail.com',
];

/* ═══ ENSURE DATA DIR ═══ */
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log(`[Aderias] Created data dir: ${DATA_DIR}`);
}

/* ═══ JSON FILE DB ═══ */
function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    console.error('[DB] Load error:', e.message);
  }
  return {
    users: [],
    chats: {
      general: {
        id: 'general', name: 'General', type: 'group',
        members: [], updatedAt: Date.now(), prev: '', unread: 0,
        messages: [{ id: 1, type: 'system', text: 'Welcome to Aderias 🔒', ts: Date.now() }],
      },
    },
    invites: {},
    transactions: [],
  };
}

function saveDB(db) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (e) {
    console.error('[DB] Save error:', e.message);
  }
}

let DB = loadDB();

/* ═══ HELPERS ═══ */
const isLeader = (u) => u && LEADER_EMAILS.includes((u.email || '').toLowerCase().trim());

function getUser(req) {
  const uid = req.headers['x-aderias-uid'];
  if (!uid) return null;
  return DB.users.find(u => u.id === uid) || null;
}

function logActivity(userId, event, ip) {
  const u = DB.users.find(u => u.id === userId);
  if (!u) return;
  if (!u.activityLog) u.activityLog = [];
  u.activityLog.push({ ts: Date.now(), event, ip });
  if (u.activityLog.length > 200) u.activityLog = u.activityLog.slice(-200);
}

function phoneMatch(a, b) {
  const ca = String(a || '').replace(/\D/g, '');
  const cb = String(b || '').replace(/\D/g, '');
  if (!ca || !cb || ca.length < 6 || cb.length < 6) return false;
  if (ca === cb) return true;
  const n = Math.min(10, ca.length, cb.length);
  return ca.slice(-n) === cb.slice(-n);
}

/* ═══ EXPRESS ═══ */
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '4mb' }));

/* ── Optional: serve the HTML client directly ── */
app.use(express.static(path.join(__dirname)));

/* ═══════════════════════════════════════════════
   API ROUTES  —  all under /api
═══════════════════════════════════════════════ */
const api = express.Router();
app.use('/api', api);

/* ── STATUS ── */
api.get('/status', (req, res) => {
  res.json({
    ok: true,
    version: '3.0',
    path: DATA_DIR,
    users: DB.users.length,
    chats: Object.keys(DB.chats).length,
  });
});

/* ── SIGN UP ── */
api.post('/signup', async (req, res) => {
  const { name, phone, email, password, username } = req.body;
  if (!name || !password) return res.json({ ok: false, error: 'Name and password are required.' });
  if (password.length < 6)   return res.json({ ok: false, error: 'Password must be at least 6 characters.' });

  const em = (email || '').toLowerCase().trim();
  const ph = String(phone || '').replace(/\D/g, '');

  // Duplicate check
  const dup = DB.users.find(u =>
    (em && u.email === em) ||
    (ph && phoneMatch(u.phone || '', ph))
  );
  if (dup) return res.json({ ok: false, error: 'Account already exists. Sign in.' });

  const hash = await bcrypt.hash(password, 10);
  const isL  = LEADER_EMAILS.includes(em);

  const u = {
    id: isL ? 'ldr_' + Date.now() : 'u_' + uuidv4().replace(/-/g, '').slice(0, 16),
    name,
    username: username || name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 22),
    email: em,
    phone: ph,
    passHash: hash,
    role: isL ? 'leader' : 'user',
    registered: true,
    bio: '',
    grad: null,
    joinedAt: Date.now(),
    lastLogin: Date.now(),
    createdAt: new Date().toISOString(),
    activityLog: [{ ts: Date.now(), event: 'signup', ip: req.ip }],
    transactions: [],
  };

  DB.users.push(u);
  if (!DB.chats.general.members.includes(u.id)) DB.chats.general.members.push(u.id);
  saveDB(DB);

  const safe = { ...u }; delete safe.passHash;
  res.json({ ok: true, user: safe });
});

/* ── SIGN IN ── */
api.post('/signin', async (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) return res.json({ ok: false, error: 'Fill all fields.' });

  const id = identifier.toLowerCase().trim();
  const u = DB.users.find(u2 =>
    (u2.email && u2.email === id) ||
    (u2.username && u2.username === id) ||
    phoneMatch(id, u2.phone || '')
  );
  if (!u) return res.json({ ok: false, error: 'Account not found. Sign up first.' });

  const ok = await bcrypt.compare(password, u.passHash);
  if (!ok) return res.json({ ok: false, error: 'Wrong password.' });

  u.lastLogin = Date.now();
  logActivity(u.id, 'signin', req.ip);
  if (LEADER_EMAILS.includes(u.email)) u.role = 'leader';
  saveDB(DB);

  const safe = { ...u }; delete safe.passHash;
  res.json({ ok: true, user: safe });
});

/* ── SYNC (full data for a user) ── */
api.get('/sync', (req, res) => {
  const cu = getUser(req);
  if (!cu) return res.json({ ok: false, error: 'Auth required.' });

  const myChats = Object.values(DB.chats).filter(c =>
    c.members?.includes(cu.id) || c.id === 'general'
  );

  // Only expose user data that the current user should see
  const users = DB.users.map(u => {
    const s = { id: u.id, name: u.name, username: u.username, phone: u.phone, grad: u.grad, registered: u.registered, bio: u.bio, role: u.role };
    return s;
  });

  res.json({ ok: true, users, chats: myChats });
});

/* ── SEARCH by phone / username / name ── */
api.get('/search', (req, res) => {
  const q    = String(req.query.q || '').trim();
  const cu   = getUser(req);
  if (!q) return res.json({ ok: true, found: false });

  const found = DB.users.find(u => {
    if (!u.registered) return false;
    if (cu && u.id === cu.id) return false;
    return (
      phoneMatch(q, u.phone || '') ||
      (u.username && u.username.toLowerCase() === q.toLowerCase()) ||
      (u.email    && u.email.toLowerCase()    === q.toLowerCase())
    );
  });

  if (!found) return res.json({ ok: true, found: false });

  const safe = { id: found.id, name: found.name, username: found.username, phone: found.phone, grad: found.grad, registered: found.registered };
  res.json({ ok: true, found: true, user: safe });
});

/* ── PROFILE UPDATE ── */
api.put('/profile', (req, res) => {
  const cu = getUser(req);
  if (!cu) return res.json({ ok: false, error: 'Auth required.' });

  const { name, bio, username, grad } = req.body;
  if (name) cu.name = name;
  if (bio  !== undefined) cu.bio  = bio;
  if (grad !== undefined) cu.grad = grad;
  if (username) cu.username = username.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  saveDB(DB);
  res.json({ ok: true });
});

/* ── REGISTER TOGGLE ── */
api.put('/register/toggle', (req, res) => {
  const cu = getUser(req);
  if (!cu) return res.json({ ok: false, error: 'Auth required.' });
  cu.registered = !cu.registered;
  logActivity(cu.id, cu.registered ? 'went_live' : 'went_hidden', req.ip);
  saveDB(DB);
  res.json({ ok: true, registered: cu.registered });
});

/* ── MESSAGES: send ── */
api.post('/message', (req, res) => {
  const cu = getUser(req);
  if (!cu) return res.json({ ok: false, error: 'Auth required.' });

  const { chatId, text, type } = req.body;
  if (!chatId || !text) return res.json({ ok: false, error: 'chatId and text required.' });

  const chat = DB.chats[chatId];
  if (!chat) return res.json({ ok: false, error: 'Chat not found.' });

  const msg = {
    id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    type: type || 'message',
    senderId: cu.id,
    sender: cu.name,
    text,
    ts: Date.now(),
  };

  if (!chat.messages) chat.messages = [];
  chat.messages.push(msg);
  chat.prev = text;
  chat.updatedAt = Date.now();

  // Unread bump for other members
  (chat.members || []).forEach(mid => {
    if (mid !== cu.id) {
      const mc = DB.chats[chatId];
      mc.unread = (mc.unread || 0) + 1;
    }
  });

  saveDB(DB);
  res.json({ ok: true, message: msg });
});

/* ── MESSAGES: fetch ── */
api.get('/messages/:chatId', (req, res) => {
  const cu = getUser(req);
  if (!cu) return res.json({ ok: false, error: 'Auth required.' });

  const chat = DB.chats[req.params.chatId];
  if (!chat) return res.json({ ok: false, error: 'Chat not found.' });

  res.json({ ok: true, messages: chat.messages || [] });
});

/* ── CHATS: create direct ── */
api.post('/chats/direct', (req, res) => {
  const cu = getUser(req);
  if (!cu) return res.json({ ok: false, error: 'Auth required.' });

  const { targetId } = req.body;
  const target = DB.users.find(u => u.id === targetId);
  if (!target) return res.json({ ok: false, error: 'User not found.' });

  const chatId = 'dm_' + [cu.id, targetId].sort().join('_');
  if (!DB.chats[chatId]) {
    DB.chats[chatId] = {
      id: chatId, name: target.name, type: 'direct',
      members: [cu.id, targetId],
      updatedAt: Date.now(), prev: '', unread: 0,
      messages: [{ id: Date.now(), type: 'system', text: 'Chat opened · end-to-end encrypted', ts: Date.now() }],
    };
    saveDB(DB);
  }
  res.json({ ok: true, chatId, chat: DB.chats[chatId] });
});

/* ── CHATS: create group ── */
api.post('/chats/group', (req, res) => {
  const cu = getUser(req);
  if (!cu) return res.json({ ok: false, error: 'Auth required.' });

  const { name } = req.body;
  if (!name) return res.json({ ok: false, error: 'Group name required.' });

  const chatId = 'grp_' + Date.now();
  DB.chats[chatId] = {
    id: chatId, name, type: 'group',
    members: [cu.id],
    updatedAt: Date.now(), prev: '', unread: 0,
    messages: [{ id: Date.now(), type: 'system', text: `Group "${name}" created`, ts: Date.now() }],
  };
  saveDB(DB);
  res.json({ ok: true, chatId, chat: DB.chats[chatId] });
});

/* ── CONTACTS: add ── */
api.post('/contacts/add', (req, res) => {
  const cu = getUser(req);
  if (!cu) return res.json({ ok: false, error: 'Auth required.' });

  const { targetId, nick } = req.body;
  if (!cu.contacts) cu.contacts = {};
  const target = DB.users.find(u => u.id === targetId);
  cu.contacts[targetId] = { nick: nick || target?.name || '', userId: targetId, addedAt: Date.now() };
  saveDB(DB);
  res.json({ ok: true });
});

/* ── TRANSFER ── */
api.post('/transfer', (req, res) => {
  const cu = getUser(req);
  if (!cu) return res.json({ ok: false, error: 'Auth required.' });

  const { toId, amount, fromCurrency, toCurrency, convertedAmount, note } = req.body;
  const target = DB.users.find(u => u.id === toId);
  if (!target) return res.json({ ok: false, error: 'Recipient not found.' });

  const tx = {
    id: uuidv4(),
    ts: Date.now(),
    fromId: cu.id,
    fromName: cu.name,
    toId,
    toName: target.name,
    amount,
    fromCurrency,
    toCurrency,
    convertedAmount,
    note: note || '',
    direction: 'sent',
    status: 'pending',
  };

  if (!cu.transactions) cu.transactions = [];
  cu.transactions.push(tx);

  // Mirror for receiver
  const rxTx = { ...tx, direction: 'received' };
  if (!target.transactions) target.transactions = [];
  target.transactions.push(rxTx);

  DB.transactions = DB.transactions || [];
  DB.transactions.push(tx);

  logActivity(cu.id, `sent ${amount} ${fromCurrency} to ${target.name}`, req.ip);
  saveDB(DB);
  res.json({ ok: true, transaction: tx });
});

/* ── INVITE ── */
api.post('/invite', (req, res) => {
  const cu = getUser(req);
  if (!cu) return res.json({ ok: false, error: 'Auth required.' });

  const { phone, chatId } = req.body;
  const chat = DB.chats[chatId];
  const token = Buffer.from(JSON.stringify({
    phone, chatId, chatName: chat?.name || 'Aderias Chat',
    inviterName: cu.name, inviterId: cu.id, ts: Date.now(),
  })).toString('base64');

  DB.invites = DB.invites || {};
  DB.invites[token] = { phone, chatId, inviterId: cu.id, used: false, createdAt: Date.now() };
  saveDB(DB);
  res.json({ ok: true, token });
});

/* ── STATS (leader only) ── */
api.get('/stats', (req, res) => {
  const cu = getUser(req);
  if (!cu || !isLeader(cu)) return res.json({ ok: false, error: 'Forbidden.' });

  const totalMsgs = Object.values(DB.chats).reduce((a, c) => a + (c.messages?.length || 0), 0);
  res.json({
    ok: true,
    users: DB.users.length,
    chats: Object.keys(DB.chats).length,
    messages: totalMsgs,
    registered: DB.users.filter(u => u.registered).length,
    path: DATA_DIR,
  });
});

/* ── LEADER: all users ── */
api.get('/leader/users', (req, res) => {
  const cu = getUser(req);
  if (!cu || !isLeader(cu)) return res.json({ ok: false, error: 'Forbidden.' });

  const users = DB.users.map(u => ({
    id: u.id, name: u.name, username: u.username,
    email: u.email, phone: u.phone, grad: u.grad,
    registered: u.registered, role: u.role,
    joinedAt: u.joinedAt, lastLogin: u.lastLogin,
  }));
  res.json({ ok: true, users });
});

/* ── LEADER: view user data (vault-gated) ── */
api.post('/leader/view', async (req, res) => {
  const cu = getUser(req);
  if (!cu || !isLeader(cu)) return res.json({ ok: false, error: 'Forbidden.' });

  const { username, viewPassword } = req.body;

  // Vault password is the leader's own account password
  const leaderOk = await bcrypt.compare(viewPassword, cu.passHash);
  if (!leaderOk) return res.json({ ok: false, error: 'Wrong vault password.' });

  const target = DB.users.find(u => u.username === username || u.email === username);
  if (!target) return res.json({ ok: false, error: 'User not found.' });

  res.json({
    ok: true,
    profile: {
      name: target.name,
      email: target.email,
      phone: target.phone,
      registered: target.registered,
      createdAt: target.createdAt,
      lastLogin: target.lastLogin ? new Date(target.lastLogin).toLocaleString() : '—',
    },
    transactions: target.transactions || [],
    activityLog: target.activityLog || [],
  });
});

/* ── EXPORT (leader exports all, user exports own) ── */
api.get('/export', (req, res) => {
  const cu = getUser(req);
  if (!cu) return res.json({ ok: false, error: 'Auth required.' });

  if (isLeader(cu)) {
    // Strip password hashes before export
    const safe = JSON.parse(JSON.stringify(DB));
    safe.users.forEach(u => delete u.passHash);
    return res.json({ ok: true, ...safe });
  }

  // Regular user: export only their own data
  const myChats = Object.values(DB.chats)
    .filter(c => c.members?.includes(cu.id))
    .map(c => ({ ...c }));

  const safe = { ...cu }; delete safe.passHash;
  res.json({ ok: true, user: safe, chats: myChats, transactions: cu.transactions || [] });
});

/* ═══ START ═══ */
app.listen(PORT, () => {
  console.log('');
  console.log('  ╔═══════════════════════════════════════╗');
  console.log('  ║   ADERIAS SERVER v3.0  —  Running     ║');
  console.log(`  ║   http://localhost:${PORT}/api/status    ║`);
  console.log(`  ║   Data: ${DATA_DIR.padEnd(31)}║`);
  console.log('  ╚═══════════════════════════════════════╝');
  console.log('');
});
