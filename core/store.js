// The store: one API for every core page and for core/levacademy.js.
// It picks the provider (indexeddb or cloud) from config.js; the device settings (mode, current child)
// always live in this browser's localStorage, whatever the provider.
import { config } from './config.js';
import * as indexeddb from './providers/indexeddb.js';
import * as cloud from './providers/cloud.js';

const siteRoot = new URL('../', import.meta.url).href;

function cloudReady() {
  const { supabase } = config;
  return config.provider === 'cloud' && Boolean(supabase?.url && supabase?.anonKey);
}

const provider = cloudReady() ? cloud : indexeddb;
provider.init({ config, siteRoot });

const MODE_KEY = 'la.deviceMode';
const CHILD_KEY = 'la.currentChildId';

function readKey(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeKey(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* private mode: the device settings just don't stick */ }
}

// Both providers get a checked Child: { id?, name, city, schoolChoice, schoolId, grade, avatar }.
function normalizeChild(child) {
  const name = String(child.name || '').trim();
  if (!name) throw new Error('Напиши име или прякор на детето.');
  if (name.length > 40) throw new Error('Името е твърде дълго.');
  const city = child.city === 'sofia' ? 'sofia' : 'other';
  let schoolChoice = ['listed', 'other', 'hidden'].includes(child.schoolChoice) ? child.schoolChoice : 'hidden';
  let schoolId = schoolChoice === 'listed' && child.schoolId ? String(child.schoolId) : null;
  if (schoolChoice === 'listed' && (!schoolId || city !== 'sofia')) {
    schoolChoice = 'hidden';
    schoolId = null;
  }
  const grade = Number(child.grade);
  if (!Number.isInteger(grade) || grade < 1 || grade > 7) throw new Error('Избери клас от 1 до 7.');
  const avatar = Number(child.avatar);
  if (!Number.isInteger(avatar) || avatar < 1 || avatar > 12) throw new Error('Избери картинка.');
  return { ...(child.id ? { id: child.id } : {}), name, city, schoolChoice, schoolId, grade, avatar };
}

function broadcast(type) {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel('levacademy');
  channel.postMessage({ type });
  channel.close();
}

export const store = {
  provider: provider.name,       // 'indexeddb' | 'cloud'
  siteRoot,

  // Auth
  currentUser: () => provider.currentUser(),
  // { mode: 'login' | 'register', email, password, displayName } or { provider: 'google' | 'facebook' }.
  // Resolves to the user, or to { notice } when the sign-in is not finished yet (e-mail confirmation).
  signIn: (options) => provider.signIn(options),
  completeSignIn: () => provider.completeSignIn(),
  resetPassword: (email) => provider.resetPassword(email),
  setNewPassword: (password) => provider.setNewPassword(password),
  async signOut() {
    writeKey(MODE_KEY, null);
    writeKey(CHILD_KEY, null);
    broadcast('signed-out');
    await provider.signOut();
  },

  // Family (parent)
  myFamily: () => provider.myFamily(),
  saveChild: async (child) => provider.saveChild(normalizeChild(child)),
  async removeChild(id) {
    await provider.removeChild(id);
    if (readKey(CHILD_KEY) === id) {
      writeKey(CHILD_KEY, null);
      broadcast('child-changed');
    }
  },
  createInvite: (email) => provider.createInvite(email),
  acceptInvite: (token) => provider.acceptInvite(token),
  async schools() {
    try {
      const response = await fetch(new URL('schools-sofia.json', import.meta.url));
      if (!response.ok) return [];
      const data = await response.json();
      const list = Array.isArray(data) ? data : (data.schools || []);
      return list
        .map((s) => ({ id: String(s.id ?? s.mon_code ?? s.monCode ?? ''), name: s.name, city: s.city }))
        .filter((s) => s.id && s.name);
    } catch {
      return [];
    }
  },

  // Device (always localStorage)
  async deviceMode() {
    const mode = readKey(MODE_KEY);
    return mode === 'parent' || mode === 'child' ? mode : null;
  },
  async setDeviceMode(mode) {
    if (mode !== 'parent' && mode !== 'child' && mode !== null) throw new Error('Непознат режим.');
    writeKey(MODE_KEY, mode);
  },
  async currentChild() {
    const id = readKey(CHILD_KEY);
    if (!id) return null;
    if (!(await provider.currentUser())) return null;
    return provider.child(id);
  },
  async selectChild(id) {   // null clears the choice
    if (readKey(CHILD_KEY) === (id || null)) return;
    writeKey(CHILD_KEY, id || null);
    broadcast('child-changed');
  },

  // History
  saveActivity: (childId, app, activity) => provider.saveActivity(childId, app, activity),
  activities: (childId, filter = {}) => provider.activities(childId, filter),
  award: (childId, app, award) => provider.award(childId, app, award),
  awards: (childId) => provider.awards(childId),
  percentile: (childId, app, topic) => provider.percentile(childId, app, topic),
};
