// /app/backpack/: the child's medals and points from every app, grouped by app.
// Child mode: the picked child. Parent mode: any child of the family (switcher on top).
import { store } from '../../core/store.js';
import { goTo, laRoot, showError } from '../../core/ui.js';

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}

const avatarSrc = (n) => `${laRoot()}avatars/${String(n).padStart(2, '0')}.webp`;
const dateText = (iso) => new Date(iso).toLocaleDateString('bg-BG', { day: 'numeric', month: 'long' });

async function loadApps() {
  try {
    const response = await fetch(`${laRoot()}apps.json`);
    return response.ok ? await response.json() : [];
  } catch {
    return [];
  }
}

// The app's own description (levacademy.json) names its medals: { code, name, icon? }. Missing file = codes only.
async function loadMedals(app) {
  if (!app?.path) return [];
  try {
    const response = await fetch(`${laRoot()}${app.path}levacademy.json`);
    if (!response.ok) return [];
    const info = await response.json();
    return (info.medals || []).map((m) => ({ ...m, icon: m.icon ? `${laRoot()}${app.path}${m.icon}` : null }));
  } catch {
    return [];
  }
}

async function renderBackpack(child) {
  $('hero-avatar').src = avatarSrc(child.avatar);
  $('hero-title').textContent = `Раницата на ${child.name}`;
  const [awards, apps] = await Promise.all([store.awards(child.id), loadApps()]);

  const byApp = new Map();
  for (const award of awards) {
    if (!byApp.has(award.app)) byApp.set(award.app, []);
    byApp.get(award.app).push(award);
  }
  const pointsOf = (list) => list.filter((a) => a.kind === 'points').reduce((sum, a) => sum + (Number(a.value) || 0), 0);
  const points = pointsOf(awards);
  const medalCount = awards.filter((a) => a.kind === 'medal').length;
  $('total-points').textContent = String(points);
  $('points-word').textContent = points === 1 ? 'точка' : 'точки';
  $('total-medals').textContent = String(medalCount);
  $('medals-word').textContent = medalCount === 1 ? 'медал' : 'медала';
  $('empty').hidden = awards.length > 0;

  const sections = await Promise.all([...byApp].map(async ([appId, list]) => {
    const app = apps.find((a) => a.id === appId);
    const medalInfo = await loadMedals(app);
    const medals = list.filter((a) => a.kind === 'medal');
    return el('section', { className: 'backpack-app' },
      el('div', { className: 'backpack-app-head' },
        app?.avatar ? el('img', { src: avatarSrc(app.avatar), alt: '', width: 56, height: 56 }) : null,
        el('h2', { textContent: app?.name || appId }),
        el('span', { className: 'points', textContent: `${pointsOf(list)} т.` })),
      medals.length
        ? el('ul', { className: 'medals' }, ...medals.map((medal) => {
          const info = medalInfo.find((m) => m.code === medal.code);
          return el('li', { className: 'medal' },
            el('span', { className: 'medal-icon', ariaHidden: 'true' },
              info?.icon ? el('img', { src: info.icon, alt: '' }) : '★'),
            el('span', { className: 'medal-name', textContent: info?.name || medal.code }),
            el('span', { className: 'medal-date', textContent: dateText(medal.earnedAt) }));
        }))
        : el('p', { className: 'no-medals', textContent: 'Още няма медали тук, само точки.' }));
  }));
  $('apps').replaceChildren(...sections);
  $('backpack').hidden = false;
}

function renderSwitch(children, selected, onPick) {
  const nav = $('child-switch');
  nav.hidden = children.length < 2;
  nav.replaceChildren(...children.map((child) => el('button', {
    className: 'child-switch-item',
    type: 'button',
    ariaPressed: String(child.id === selected.id),
    onclick: () => onPick(child),
  }, el('img', { src: avatarSrc(child.avatar), alt: '', width: 40, height: 40 }), el('span', { textContent: child.name }))));
}

async function render() {
  if (!(await store.currentUser())) return goTo('login/');
  const mode = await store.deviceMode();
  if (!mode) return goTo('app/');

  let children;
  let selected;
  if (mode === 'child') {
    selected = await store.currentChild();
    children = selected ? [selected] : [];
  } else {
    children = (await store.myFamily()).children;
    const wanted = (await store.currentChild())?.id;
    selected = children.find((c) => c.id === wanted) || children[0];
  }
  $('loading').hidden = true;
  if (!selected) {
    $('no-child').hidden = false;
    return;
  }
  const pick = async (child) => {
    renderSwitch(children, child, pick);
    await renderBackpack(child);
  };
  renderSwitch(children, selected, pick);
  await renderBackpack(selected);
}

render().catch((error) => {
  console.error(error);
  $('loading').hidden = true;
  showError($('page-error'), error.message || 'Нещо се обърка. Опитай пак.');
});

// Another tab changed the child or signed out.
if (typeof BroadcastChannel !== 'undefined') {
  new BroadcastChannel('levacademy').addEventListener('message', ({ data }) => {
    if (data?.type === 'signed-out' || data?.type === 'child-changed') location.reload();
  });
}
