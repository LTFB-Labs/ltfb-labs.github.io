// LevAcademy SDK, contract v1: what an app loads to learn which child is learning and to save what it did.
//
//   <script type="module" src="../core/levacademy.js"></script>
//   const la = await LevAcademy.connect({ app: 'nvo-matematika', contract: 1 });
//   la.child                      // { id, name, grade, avatar } or null (not signed in / no child picked)
//   await la.saveActivity({ kind, topic, startedAt, finishedAt, points, maxPoints, seconds, details })
//   await la.award({ kind: 'medal' | 'points', code, value, topic })
//   la.on('child-changed' | 'signed-out' | 'award', fn)   // returns a function that removes the listener
//
// Classic (non-module) scripts: `await window.LevAcademyReady` gives the same LevAcademy object
// once this module has run. If this file cannot be loaded at all, the app keeps working on its own.
//
// connect() puts a 44px bar as the first element of <body> (normal flow, so it pushes the page down):
// „← LevAcademy“, the child's avatar and name, „Смени“. Styles: core/topbar.css, classes la-topbar*.
import { store } from './store.js';

const SUPPORTED_CONTRACTS = [1];
const EVENTS = ['child-changed', 'signed-out', 'award'];
const siteRoot = new URL('../', import.meta.url).href;

const avatarUrl = (n) => `${siteRoot}avatars/${String(n).padStart(2, '0')}.webp`;

// What an app may know about the child: no school, no city.
const appChild = (child) => (child ? { id: child.id, name: child.name, grade: child.grade, avatar: child.avatar } : null);

// The child counts only when the device is in child mode (a parent's leftover choice does not).
async function readChild() {
  if ((await store.deviceMode()) !== 'child') return null;
  return appChild(await store.currentChild());
}

function emit(type, detail) {
  window.dispatchEvent(new CustomEvent(`levacademy:${type}`, { detail }));
}

// Top bar

let leaving = false;   // the bar's own „Смени“ is navigating away: ignore the echo of its own change

function loadTopbarCss() {
  const href = new URL('topbar.css', import.meta.url).href;
  if (document.querySelector(`link[href="${href}"]`)) return Promise.resolve();
  return new Promise((resolve) => {
    const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href });
    link.onload = resolve;
    link.onerror = resolve;
    setTimeout(resolve, 1500);   // never hold the app back for the bar's looks
    document.head.append(link);
  });
}

function node(tag, className, props = {}) {
  return Object.assign(document.createElement(tag), { className, ...props });
}

async function renderTopbar(child) {
  let bar = document.querySelector('.la-topbar');
  if (!bar) {
    bar = node('nav', 'la-topbar');
    bar.setAttribute('aria-label', 'LevAcademy');
    document.body.prepend(bar);
    document.documentElement.classList.add('la-has-topbar');
  }
  const home = node('a', 'la-topbar-link la-topbar-home', { href: `${siteRoot}app/`, textContent: '← LevAcademy' });
  if (!child) {
    const signedIn = Boolean(await store.currentUser());
    const enter = signedIn
      ? node('a', 'la-topbar-button', { href: `${siteRoot}app/`, textContent: 'Избери дете' })
      : node('a', 'la-topbar-button', { href: `${siteRoot}login/`, textContent: 'Влез в LevAcademy' });
    bar.replaceChildren(home, node('span', 'la-topbar-spacer'), enter);
    return;
  }
  const who = node('span', 'la-topbar-child');
  who.append(
    node('img', 'la-topbar-avatar', { src: avatarUrl(child.avatar), alt: '', width: 32, height: 32 }),
    node('span', 'la-topbar-name', { textContent: child.name }));
  const change = node('a', 'la-topbar-button', { href: `${siteRoot}app/`, textContent: 'Смени' });
  change.addEventListener('click', async (event) => {
    event.preventDefault();
    leaving = true;
    await store.selectChild(null);   // /app/ then shows „Кой учи днес?“
    location.assign(change.href);
  });
  bar.replaceChildren(home, node('span', 'la-topbar-spacer'), who, change);
}

// Connection

let connection = null;   // one connection per page: a promise of `la`

async function connect({ app, contract } = {}) {
  if (!SUPPORTED_CONTRACTS.includes(contract)) {
    const message = `LevAcademy: contract ${JSON.stringify(contract)} is not supported (supported: ${SUPPORTED_CONTRACTS.join(', ')}). The app keeps running on its own.`;
    console.error(message);
    throw new Error(message);
  }
  if (!app || typeof app !== 'string') {
    const message = 'LevAcademy: connect() needs the app id, e.g. { app: "nvo-matematika", contract: 1 }.';
    console.error(message);
    throw new Error(message);
  }
  connection ??= open(app, contract).catch((error) => { connection = null; throw error; });
  return connection;
}

async function open(app, contract) {
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('levacademy');
  const la = {
    app,
    contract,
    child: await readChild(),

    async saveActivity(activity = {}) {
      if (!la.child) throw new Error('Няма избрано дете в LevAcademy.');
      const { kind, topic = null, startedAt, finishedAt, points = null, maxPoints = null, seconds = null, details = null } = activity;
      if (!kind) throw new Error('LevAcademy: saveActivity needs a kind.');
      const finished = finishedAt || new Date().toISOString();
      return store.saveActivity(la.child.id, app, {
        kind, topic, startedAt: startedAt || finished, finishedAt: finished, points, maxPoints, seconds, details,
      });
    },

    async award({ kind, code, value = null, topic = null } = {}) {
      if (!la.child) throw new Error('Няма избрано дете в LevAcademy.');
      if (kind !== 'medal' && kind !== 'points') throw new Error('LevAcademy: award kind is "medal" or "points".');
      const row = await store.award(la.child.id, app, { kind, code, value, topic });
      emit('award', row);
      channel?.postMessage({ type: 'award', award: row });
      return row;
    },

    on(type, fn) {
      if (!EVENTS.includes(type)) throw new Error(`LevAcademy: unknown event "${type}" (${EVENTS.join(', ')}).`);
      const listener = (event) => fn(event.detail);
      window.addEventListener(`levacademy:${type}`, listener);
      return () => window.removeEventListener(`levacademy:${type}`, listener);
    },
  };

  // Other tabs (and the store in this tab) post { type } on the channel: refresh the child and the bar, then tell the app.
  channel?.addEventListener('message', async ({ data }) => {
    if (leaving || !data || !EVENTS.includes(data.type)) return;
    if (data.type === 'award') return emit('award', data.award);
    la.child = data.type === 'signed-out' ? null : await readChild();
    await renderTopbar(la.child);
    emit(data.type, { child: la.child });
  });

  await loadTopbarCss();
  await renderTopbar(la.child);
  return la;
}

const LevAcademy = { connect, contracts: SUPPORTED_CONTRACTS };
window.LevAcademy = LevAcademy;
window.LevAcademyReady = Promise.resolve(LevAcademy);
export { LevAcademy, connect };
