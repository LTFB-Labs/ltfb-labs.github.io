// The apps the shell shows: only the ones in apps.json that implement the contract (`"contract": 2`).
// Their name, icon, path and permissions come from the app's own levacademy.json, checked against the contract.
// The other entries in apps.json are only for the public catalog (/apps/).
import { checkManifest, isAvailable } from './academy-core/validate.js';

const siteRoot = new URL('../', import.meta.url).href;

let cache = null;

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

// [{ id, url, manifest }] for every contract app that is on today.
export function contractApps() {
  cache ??= (async () => {
    let registry = [];
    try { registry = await fetchJson(`${siteRoot}apps.json`); } catch (error) { console.warn('apps.json:', error); }
    const apps = await Promise.all(registry.filter((entry) => entry.contract === 2).map(async (entry) => {
      const url = new URL(entry.path, siteRoot).href;
      try {
        const manifest = checkManifest(await fetchJson(`${url}levacademy.json`));
        if (manifest.id !== entry.id) throw new Error(`id „${manifest.id}“ не съвпада с „${entry.id}“`);
        return isAvailable(manifest) ? { id: entry.id, url, manifest } : null;
      } catch (error) {
        console.warn(`${entry.id}: апът не спазва договора и не се показва.`, error);
        return null;
      }
    }));
    const seen = new Set();
    return apps.filter((app) => app && !seen.has(app.manifest.route) && seen.add(app.manifest.route));
  })();
  return cache;
}

// The apps for one child: all contract apps, or only the ones for the child's grade if the app says so.
export async function appsFor(child) {
  const apps = await contractApps();
  return apps.filter((app) => !child || !app.manifest.grades?.length || app.manifest.grades.includes(child.grade));
}

export const iconOf = (app) => (app.manifest.icon ? new URL(app.manifest.icon, app.url).href : `${siteRoot}img/logo.svg`);
