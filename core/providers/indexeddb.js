// IndexedDB provider: everything in this browser's IndexedDB (database 'levacademy'), until the cloud
// provider (Supabase) is switched on. Same API as cloud.js, so the pages don't change; only the
// data stays behind in this browser when the provider is switched.
// Sign-in is local: e-mail + name + password (PBKDF2 hash, never the password itself). Several parents can
// share one browser, so an invite link works between them: sign out, open the link, register as the second parent.
export const name = 'indexeddb';

const DB_NAME = 'levacademy';
const DB_VERSION = 1;
const STORES = ['users', 'families', 'members', 'invites', 'children', 'activities', 'awards'];
const SESSION_KEY = 'la.local.session';
const OLD_DB_KEY = 'la.local.db';          // the earlier localStorage provider; copied over once
const INVITE_DAYS = 7;
const PASSWORD_MIN = 8;
const PBKDF2_ITERATIONS = 210000;

let siteRoot = '';

export function init(options) {
  siteRoot = options.siteRoot;
}

/* ---------- IndexedDB ---------- */

const request = (req) => new Promise((ok, fail) => { req.onsuccess = () => ok(req.result); req.onerror = () => fail(req.error); });
const done = (tx) => new Promise((ok, fail) => { tx.oncomplete = ok; tx.onerror = () => fail(tx.error); tx.onabort = () => fail(tx.error); });

let dbPromise;
function openDb() {
  dbPromise ||= new Promise((ok, fail) => {
    if (typeof indexedDB === 'undefined') { fail(new Error('Браузърът не поддържа запис на данни.')); return; }
    let created = false;
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      created = req.transaction.db.objectStoreNames.length === 0;
      for (const store of STORES) if (!req.result.objectStoreNames.contains(store)) req.result.createObjectStore(store, { keyPath: 'id' });
    };
    req.onsuccess = async () => {
      if (created) { try { await importOldLocalStorage(req.result); } catch (e) { console.warn('Could not copy the old local data:', e); } }
      ok(req.result);
    };
    req.onerror = () => fail(new Error('Браузърът не позволява да се запише. Провери дали не е в режим „инкогнито“.'));
  });
  return dbPromise;
}

// Reads every store into one snapshot: { users: [...], families: [...], ... }. Local data is small.
async function load() {
  const db = await openDb();
  const tx = db.transaction(STORES, 'readonly');
  const lists = await Promise.all(STORES.map((s) => request(tx.objectStore(s).getAll())));
  return Object.fromEntries(STORES.map((s, i) => [s, lists[i]]));
}

// Writes only what an operation changed, so two tabs (core + an app) don't overwrite each other.
// changes = { put: { store: [rows] }, remove: { store: [ids] } }
async function write({ put = {}, remove = {} }) {
  const db = await openDb();
  const names = [...new Set([...Object.keys(put), ...Object.keys(remove)])];
  const tx = db.transaction(names, 'readwrite');
  for (const [store, ids] of Object.entries(remove)) for (const id of ids) tx.objectStore(store).delete(id);
  for (const [store, rows] of Object.entries(put)) for (const row of rows) tx.objectStore(store).put(row);
  await done(tx);
}

// One-time copy from the earlier localStorage provider (la.local.db). The old key is left as it was.
async function importOldLocalStorage(db) {
  let old;
  try { old = JSON.parse(localStorage.getItem(OLD_DB_KEY) || 'null'); } catch { old = null; }
  if (!old) return;
  const tx = db.transaction(STORES, 'readwrite');
  for (const store of STORES) {
    for (const row of old[store] || []) {
      tx.objectStore(store).put(store === 'members' ? { ...row, id: memberId(row.familyId, row.userId) } : row);
    }
  }
  await done(tx);
}

/* ---------- Helpers ---------- */

/* crypto.randomUUID exists only on HTTPS (and localhost); getRandomValues works everywhere */
function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const memberId = (familyId, userId) => `${familyId}:${userId}`;
const now = () => new Date().toISOString();
const toHex = (buffer) => [...new Uint8Array(buffer)].map((x) => x.toString(16).padStart(2, '0')).join('');

async function hashPassword(password, saltHex) {
  if (!crypto.subtle) throw new Error('Входът с парола работи само през https://.');
  const salt = saltHex ? Uint8Array.from(saltHex.match(/../g), (h) => parseInt(h, 16)) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, key, 256);
  return { salt: toHex(salt), hash: toHex(bits) };
}

function sessionUser(db) {
  let id = null;
  try { id = localStorage.getItem(SESSION_KEY); } catch { /* private mode */ }
  return id ? db.users.find((u) => u.id === id) || null : null;
}

function requireUser(db) {
  const user = sessionUser(db);
  if (!user) throw new Error('Трябва да влезеш отново.');
  return user;
}

const publicUser = (user) => ({ id: user.id, email: user.email, displayName: user.displayName });

function publicChild(child) {
  const { familyId, createdAt, ...rest } = child;
  return rest;
}

// The family shown to the parent: the one joined last (after an invite, that is the shared family).
function familyOf(db, userId) {
  const joined = db.members
    .filter((m) => m.userId === userId)
    .sort((a, b) => b.joinedAt.localeCompare(a.joinedAt));
  return joined.length ? db.families.find((f) => f.id === joined[0].familyId) : null;
}

function requireFamily(db) {
  const family = familyOf(db, requireUser(db).id);
  if (!family) throw new Error('Няма намерено семейство.');
  return family;
}

// A child is reachable only through a family the signed-in parent belongs to.
function requireChild(db, childId) {
  const user = requireUser(db);
  const child = db.children.find((c) => c.id === childId);
  if (!child || !db.members.some((m) => m.userId === user.id && m.familyId === child.familyId)) {
    throw new Error('Няма такова дете.');
  }
  return child;
}

/* ---------- Auth ---------- */

export async function currentUser() {
  const user = sessionUser(await load());
  return user ? publicUser(user) : null;
}

const CLOUD_ONLY = 'Входът с Google и Facebook работи само с облачния вход.';

// The /login/ and /register/ forms pass { mode, email, displayName, password }.
// { provider: 'google' | 'facebook' } (the social buttons) works only with the cloud provider.
export async function signIn({ mode, email, displayName, password, provider } = {}) {
  if (provider) throw new Error(CLOUD_ONLY);
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) throw new Error('Напиши истински имейл.');
  const pass = String(password || '');
  if (pass.length < PASSWORD_MIN) throw new Error(`Паролата трябва да е поне ${PASSWORD_MIN} знака.`);
  const db = await load();
  let user = db.users.find((u) => u.email === cleanEmail);

  if (mode === 'register') {
    if (user) throw new Error('Вече има профил с този имейл. Влез с него.');
    const cleanName = String(displayName || '').trim();
    if (!cleanName) throw new Error('Напиши името си.');
    user = { id: newId(), email: cleanEmail, displayName: cleanName, password: await hashPassword(pass), createdAt: now() };
    // Like ensure_user in the cloud: the first sign-in creates the user's own family.
    const family = { id: newId(), createdAt: now(), isTest: true };
    const member = { id: memberId(family.id, user.id), familyId: family.id, userId: user.id, joinedAt: now() };
    await write({ put: { users: [user], families: [family], members: [member] } });
  } else {
    if (!user) throw new Error('Няма профил с този имейл. Регистрирай се.');
    if (user.password) {
      const { hash } = await hashPassword(pass, user.password.salt);
      if (hash !== user.password.hash) throw new Error('Грешна парола.');
    } else {
      // Profiles from the earlier provider had no password: the first one given becomes theirs.
      await write({ put: { users: [{ ...user, password: await hashPassword(pass) }] } });
    }
  }
  try { localStorage.setItem(SESSION_KEY, user.id); } catch { /* private mode: no session */ }
  return publicUser(user);
}

export async function completeSignIn() {
  return currentUser();
}

export async function signOut() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* nothing to clear */ }
}

// Password reset needs e-mail: only the cloud provider has it.
export async function resetPassword() {
  throw new Error('Новата парола по имейл работи само с облачния вход.');
}

export async function setNewPassword() {
  throw new Error('Новата парола по имейл работи само с облачния вход.');
}

/* ---------- Family ---------- */

export async function myFamily() {
  const db = await load();
  const family = requireFamily(db);
  const members = db.members
    .filter((m) => m.familyId === family.id)
    .map((m) => db.users.find((u) => u.id === m.userId))
    .filter(Boolean)
    .map(publicUser);
  const children = db.children
    .filter((c) => c.familyId === family.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(publicChild);
  return { id: family.id, members, children };
}

export async function child(id) {
  try {
    return publicChild(requireChild(await load(), id));
  } catch {
    return null;
  }
}

export async function saveChild(input) {
  const db = await load();
  if (input.id) {
    const updated = { ...requireChild(db, input.id), ...input };
    await write({ put: { children: [updated] } });
    return publicChild(updated);
  }
  const created = { ...input, id: newId(), familyId: requireFamily(db).id, createdAt: now() };
  await write({ put: { children: [created] } });
  return publicChild(created);
}

export async function removeChild(id) {
  const db = await load();
  requireChild(db, id);
  await write({
    remove: {
      children: [id],
      activities: db.activities.filter((a) => a.childId === id).map((a) => a.id),
      awards: db.awards.filter((a) => a.childId === id).map((a) => a.id),
    },
  });
}

export async function createInvite(email) {
  const db = await load();
  const user = requireUser(db);
  const family = requireFamily(db);
  const token = newId().replaceAll('-', '');
  await write({
    put: {
      invites: [{
        id: newId(),
        familyId: family.id,
        email: String(email || '').trim().toLowerCase(),
        token,
        invitedBy: user.id,
        expiresAt: new Date(Date.now() + INVITE_DAYS * 864e5).toISOString(),
        acceptedAt: null,
      }],
    },
  });
  return { token, link: `${siteRoot}register/?invite=${token}` };
}

export async function acceptInvite(token) {
  const db = await load();
  const user = requireUser(db);
  const invite = db.invites.find((i) => i.token === token);
  if (!invite) throw new Error('Поканата не е намерена.');
  if (db.members.some((m) => m.familyId === invite.familyId && m.userId === user.id)) return invite.familyId;
  if (invite.acceptedAt) throw new Error('Поканата вече е използвана.');
  if (invite.expiresAt < now()) throw new Error('Поканата е изтекла. Помоли за нова.');

  // Drop the user's own family if it is still empty (only them, no children).
  const removeFamilies = [];
  const removeMembers = [];
  for (const m of db.members.filter((m) => m.userId === user.id)) {
    const alone = db.members.filter((x) => x.familyId === m.familyId).length === 1;
    const noChildren = !db.children.some((c) => c.familyId === m.familyId);
    if (alone && noChildren) { removeFamilies.push(m.familyId); removeMembers.push(m.id); }
  }
  await write({
    remove: { families: removeFamilies, members: removeMembers },
    put: {
      invites: [{ ...invite, acceptedAt: now() }],
      members: [{ id: memberId(invite.familyId, user.id), familyId: invite.familyId, userId: user.id, joinedAt: now() }],
    },
  });
  return invite.familyId;
}

/* ---------- History ---------- */

export async function saveActivity(childId, app, activity) {
  requireChild(await load(), childId);
  const row = { ...activity, id: newId(), childId, app, contract: 1 };
  await write({ put: { activities: [row] } });
  return row;
}

export async function activities(childId, { app, since } = {}) {
  const db = await load();
  requireChild(db, childId);
  const sinceIso = since ? new Date(since).toISOString() : null;
  return db.activities
    .filter((a) => a.childId === childId && (!app || a.app === app) && (!sinceIso || (a.startedAt || '') >= sinceIso))
    .sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
}

export async function award(childId, app, { kind, code, value = null, topic = null }) {
  requireChild(await load(), childId);
  const row = { id: newId(), childId, app, kind, code, value, topic, earnedAt: now() };
  await write({ put: { awards: [row] } });
  return row;
}

export async function awards(childId) {
  const db = await load();
  requireChild(db, childId);
  return db.awards
    .filter((a) => a.childId === childId)
    .sort((a, b) => b.earnedAt.localeCompare(a.earnedAt));
}

// The comparison with other children needs many families: never available locally.
export async function percentile() {
  return null;
}
