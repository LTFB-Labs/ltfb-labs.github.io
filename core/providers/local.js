// Local provider: everything in this browser's localStorage, for testing before the cloud accounts exist.
// Sign-in is fake (e-mail + name, no password). Several fake parents can share one browser,
// so an invite link works between them: sign out, open the link, register as the second parent.
export const name = 'local';

const DB_KEY = 'la.local.db';
const SESSION_KEY = 'la.local.session';
const INVITE_DAYS = 7;

let siteRoot = '';

export function init(options) {
  siteRoot = options.siteRoot;
}

function emptyDb() {
  return { users: [], families: [], members: [], invites: [], children: [], activities: [], awards: [] };
}

function load() {
  try {
    return { ...emptyDb(), ...JSON.parse(localStorage.getItem(DB_KEY) || '{}') };
  } catch {
    return emptyDb();
  }
}

function save(db) {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch {
    throw new Error('Браузърът не позволява да се запише. Провери дали не е в режим „инкогнито“.');
  }
}

function newId() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function publicUser(user) {
  return { id: user.id, email: user.email, displayName: user.displayName };
}

function sessionUser(db) {
  const id = localStorage.getItem(SESSION_KEY);
  return id ? db.users.find((u) => u.id === id) || null : null;
}

function requireUser(db) {
  const user = sessionUser(db);
  if (!user) throw new Error('Трябва да влезеш отново.');
  return user;
}

// The family shown to the parent: the one joined last (after an invite, that is the shared family).
function familyOf(db, userId) {
  const joined = db.members
    .filter((m) => m.userId === userId)
    .sort((a, b) => b.joinedAt.localeCompare(a.joinedAt));
  return joined.length ? db.families.find((f) => f.id === joined[0].familyId) : null;
}

function requireFamily(db) {
  const user = requireUser(db);
  const family = familyOf(db, user.id);
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

function publicChild(child) {
  const { familyId, createdAt, ...rest } = child;
  return rest;
}

// Auth

export async function currentUser() {
  const user = sessionUser(load());
  return user ? publicUser(user) : null;
}

// Local only: the /login/ and /register/ forms pass { email, displayName }.
export async function signIn({ mode, email, displayName } = {}) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) throw new Error('Напиши истински имейл.');
  const db = load();
  let user = db.users.find((u) => u.email === cleanEmail);
  if (mode === 'register') {
    if (user) throw new Error('Вече има профил с този имейл. Влез с него.');
    const cleanName = String(displayName || '').trim();
    if (!cleanName) throw new Error('Напиши името си.');
    user = { id: newId(), email: cleanEmail, displayName: cleanName, createdAt: now() };
    db.users.push(user);
    // Like ensure_user in the cloud: the first sign-in creates the user's own family.
    const family = { id: newId(), createdAt: now(), isTest: true };
    db.families.push(family);
    db.members.push({ familyId: family.id, userId: user.id, joinedAt: now() });
  } else if (!user) {
    throw new Error('Няма профил с този имейл. Регистрирай се.');
  }
  save(db);
  localStorage.setItem(SESSION_KEY, user.id);
  return publicUser(user);
}

export async function completeSignIn() {
  return currentUser();
}

export async function signOut() {
  localStorage.removeItem(SESSION_KEY);
}

// Family

export async function myFamily() {
  const db = load();
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
    return publicChild(requireChild(load(), id));
  } catch {
    return null;
  }
}

export async function saveChild(input) {
  const db = load();
  if (input.id) {
    const existing = requireChild(db, input.id);
    Object.assign(existing, input);
    save(db);
    return publicChild(existing);
  }
  const family = requireFamily(db);
  const created = { ...input, id: newId(), familyId: family.id, createdAt: now() };
  db.children.push(created);
  save(db);
  return publicChild(created);
}

export async function removeChild(id) {
  const db = load();
  requireChild(db, id);
  db.children = db.children.filter((c) => c.id !== id);
  db.activities = db.activities.filter((a) => a.childId !== id);
  db.awards = db.awards.filter((a) => a.childId !== id);
  save(db);
}

export async function createInvite(email) {
  const db = load();
  const user = requireUser(db);
  const family = requireFamily(db);
  const token = crypto.randomUUID().replaceAll('-', '');
  db.invites.push({
    id: newId(),
    familyId: family.id,
    email: String(email || '').trim().toLowerCase(),
    token,
    invitedBy: user.id,
    expiresAt: new Date(Date.now() + INVITE_DAYS * 864e5).toISOString(),
    acceptedAt: null,
  });
  save(db);
  return { token, link: `${siteRoot}register/?invite=${token}` };
}

export async function acceptInvite(token) {
  const db = load();
  const user = requireUser(db);
  const invite = db.invites.find((i) => i.token === token);
  if (!invite) throw new Error('Поканата не е намерена.');
  if (db.members.some((m) => m.familyId === invite.familyId && m.userId === user.id)) return invite.familyId;
  if (invite.acceptedAt) throw new Error('Поканата вече е използвана.');
  if (invite.expiresAt < now()) throw new Error('Поканата е изтекла. Помоли за нова.');
  invite.acceptedAt = now();
  // Drop the user's own family if it is still empty (only them, no children).
  const own = db.members.filter((m) => m.userId === user.id).map((m) => m.familyId);
  for (const familyId of own) {
    const alone = db.members.filter((m) => m.familyId === familyId).length === 1;
    const noChildren = !db.children.some((c) => c.familyId === familyId);
    if (alone && noChildren) {
      db.members = db.members.filter((m) => m.familyId !== familyId);
      db.families = db.families.filter((f) => f.id !== familyId);
    }
  }
  db.members.push({ familyId: invite.familyId, userId: user.id, joinedAt: now() });
  save(db);
  return invite.familyId;
}

// History

export async function saveActivity(childId, app, activity) {
  const db = load();
  requireChild(db, childId);
  const row = { ...activity, id: newId(), childId, app, contract: 1 };
  db.activities.push(row);
  save(db);
  return row;
}

export async function activities(childId, { app, since } = {}) {
  const db = load();
  requireChild(db, childId);
  const sinceIso = since ? new Date(since).toISOString() : null;
  return db.activities
    .filter((a) => a.childId === childId && (!app || a.app === app) && (!sinceIso || (a.startedAt || '') >= sinceIso))
    .sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
}

export async function award(childId, app, { kind, code, value = null, topic = null }) {
  const db = load();
  requireChild(db, childId);
  const row = { id: newId(), childId, app, kind, code, value, topic, earnedAt: now() };
  db.awards.push(row);
  save(db);
  return row;
}

export async function awards(childId) {
  const db = load();
  requireChild(db, childId);
  return db.awards
    .filter((a) => a.childId === childId)
    .sort((a, b) => b.earnedAt.localeCompare(a.earnedAt));
}

// The comparison with other children needs many families: never available locally.
export async function percentile() {
  return null;
}
