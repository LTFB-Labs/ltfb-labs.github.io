// The store: one API for every core page and for the shell, which answers the apps from it.
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

// On this computer (localhost) the provider can be forced for trying things out: localStorage la.dev.provider = 'indexeddb'.
function devProvider() {
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) return null;
  try { return localStorage.getItem('la.dev.provider'); } catch { return null; }
}

const forced = devProvider();
const provider = forced === 'indexeddb' ? indexeddb : forced === 'cloud' || cloudReady() ? cloud : indexeddb;
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

const iconUrl = (icon) => (String(icon).startsWith('core:') ? `${siteRoot}core/badges/${String(icon).slice(5)}.svg` : icon);
const withIconUrl = (badge) => ({ ...badge, icon: iconUrl(badge.icon) });

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
    if (readKey(MODE_KEY) === mode) return;
    writeKey(MODE_KEY, mode);
    broadcast('mode-changed');
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

  // Parent mode on the child's tablet
  verifyPassword: (password) => provider.verifyPassword(password),

  // Badges: the child's trophies, given by the apps through the shell. `core:<name>` icons point to core/badges/.
  async badges(childId) {
    return (await provider.badges(childId)).map(withIconUrl);
  },
  async grantBadge(childId, app, badge) {
    const row = withIconUrl(await provider.grantBadge(childId, app, badge));
    broadcast('badges-changed');
    return row;
  },

  // The apps' own data, per app and child: op is get | all | put | putMany | remove | clear.
  appData: (childId, app, op, params) => provider.appData(childId, app, op, params),
};
