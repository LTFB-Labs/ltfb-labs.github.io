// The app's side: `defineApp` for academy-app.js, and the code that runs the app inside the shell's frame.
//
//   import { defineApp } from '../core/academy-core/app.js';
//   export default defineApp({ id, name, route, contract: 2, permissions: ['user', 'storage'], mount(el, core) { … } });
import { AC, isMessage } from './protocol.js';
import { checkApp } from './validate.js';
/** Checks the app now (in the browser too) and returns it unchanged. */
export function defineApp(app) {
    return checkApp(app);
}
/** The shell's side of the conversation, seen from the frame. */
function connectToShell() {
    const shell = window.parent;
    const pending = new Map();
    const listeners = new Set();
    let nextId = 1;
    let route = '';
    let started;
    const ready = new Promise((ok) => { started = ok; });
    addEventListener('message', (event) => {
        if (event.source !== shell || !isMessage(event.data))
            return;
        const message = event.data;
        if (message.type === 'init') {
            route = message.route;
            started();
        }
        else if (message.type === 'change')
            listeners.forEach((fn) => fn());
        else if (message.type === 'response') {
            const call = pending.get(message.id);
            if (!call)
                return;
            pending.delete(message.id);
            if (message.error)
                call.fail(new Error(message.error));
            else
                call.ok(message.result);
        }
    });
    // The secret from this frame's address: a page the frame goes to later cannot know it.
    const secret = new URLSearchParams(location.search).get('t') ?? '';
    const send = (message) => shell.postMessage({ ...message, t: secret }, '*');
    const call = (method, params) => new Promise((ok, fail) => {
        const id = nextId++;
        pending.set(id, { ok: ok, fail });
        send({ ac: AC, type: 'request', id, method, params });
    });
    const appData = {
        get: (collection, id) => call('appData.get', { collection, id }),
        all: (collection) => call('appData.all', { collection }),
        put: (collection, record) => call('appData.put', { collection, record }),
        putMany: (collection, records) => call('appData.putMany', { collection, records }),
        remove: (collection, id) => call('appData.remove', { collection, id }),
        clear: (collection) => call('appData.clear', { collection }),
    };
    const core = {
        contract: AC,
        embedded: true,
        get route() { return route; },
        getUser: () => call('getUser'),
        getSettings: () => call('getSettings'),
        onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        grantUserBadge: (badge) => call('grantUserBadge', badge),
        appData,
        navigate(next) { route = next; void call('navigate', { route: next }); },
    };
    send({ ac: AC, type: 'hello' });
    return { core, ready };
}
/**
 * The module the frame may load: only an app's folder on this same site, never the shell's own files and never
 * another site or a data: address. Returns null for anything else.
 */
function allowedEntry(entry) {
    if (!entry)
        return null;
    let url;
    try {
        url = new URL(entry, location.href);
    }
    catch {
        return null;
    }
    const sameSite = url.protocol === location.protocol && url.host === location.host;
    const inShell = /^\/(core|app|shared|login|register|auth)\//.test(url.pathname);
    return sameSite && !inShell && url.pathname.endsWith('.js') ? url.href : null;
}
/** Runs inside /core/frame.html: loads the app's module from ?entry= and mounts it. */
export async function startFrame(root) {
    // Only inside the shell's sandbox (no origin): opened directly, the page would run on the shell's origin.
    if (self.origin !== 'null' || window.parent === window) {
        root.textContent = 'Апът се отваря само в LevAcademy.';
        return;
    }
    const entry = allowedEntry(new URLSearchParams(location.search).get('entry'));
    const { core, ready } = connectToShell();
    try {
        if (!entry)
            throw new Error('Няма разрешен адрес на апа.');
        const module = await import(entry);
        const app = checkApp(module.default);
        await ready;
        await app.mount(root, core);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('academy-core:', error);
        window.parent.postMessage({ ac: AC, type: 'fail', message, t: new URLSearchParams(location.search).get('t') ?? '' }, '*');
        root.textContent = 'Апът не е достъпен.';
    }
}
