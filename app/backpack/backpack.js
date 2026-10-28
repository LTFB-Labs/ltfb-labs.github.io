// /app/backpack/ and /app/dashboard/: the child's card. Earned badges only, as trophies with their story
// (picture, name, why, when, which app), newest first; then the child's apps with „Отвори“. Progress is the apps':
// they show it themselves. Backpack: the picked child in child mode, any child in parent mode.
// Dashboard (<body data-view="dashboard">): parent mode only.
import { store } from '../../core/store.js';
import { goTo, laRoot, showError } from '../../core/ui.js';
import { shellBar } from '../../core/shell-bar.js';
import { appsFor, contractApps, iconOf } from '../../core/apps.js';

const $ = (id) => document.getElementById(id);
const dashboard = document.body.dataset.view === 'dashboard';

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}

const avatarSrc = (n) => `${laRoot()}avatars/${String(n).padStart(2, '0')}.webp`;
const dateText = (iso) => new Date(iso).toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', year: 'numeric' });
const badgesWord = (n) => (n === 1 ? 'значка' : 'значки');

async function renderCard(child, mode) {
  $('hero-avatar').src = avatarSrc(child.avatar);
  $('hero-title').textContent = dashboard ? child.name : `Раницата на ${child.name}`;
  const [badges, allApps, childApps] = await Promise.all([store.badges(child.id), contractApps(), appsFor(child)]);
  const appName = (id) => allApps.find((a) => a.id === id)?.manifest.name || id;

  $('total-badges').textContent = String(badges.length);
  $('badges-word').textContent = badgesWord(badges.length);
  $('empty').hidden = badges.length > 0;
  $('trophies').replaceChildren(...badges.map((badge) => el('li', { className: 'trophy' },
    el('img', { src: badge.icon, alt: '', width: 72, height: 72 }),
    el('div', { className: 'trophy-text' },
      el('strong', { textContent: badge.name }),
      badge.reason || badge.description ? el('span', { textContent: badge.reason || badge.description }) : null,
      el('span', { className: 'trophy-meta', textContent: `${appName(badge.app)} · ${dateText(badge.earnedAt)}` })))));

  $('apps').replaceChildren(...childApps.map((app) => el('article', { className: 'backpack-app' },
    el('div', { className: 'backpack-app-head' },
      el('img', { src: iconOf(app), alt: '', width: 56, height: 56 }),
      el('h3', { textContent: app.manifest.name }),
      mode === 'child'
        ? el('a', { className: 'button button-small', href: `${laRoot()}app/#/${app.manifest.route}`, textContent: 'Отвори' })
        : null),
    app.manifest.description ? el('p', { className: 'core-note', textContent: app.manifest.description }) : null)));
  if (!childApps.length) $('apps').append(el('p', { className: 'core-note', textContent: 'Още няма апи за този клас.' }));
  $('card').hidden = false;
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
  $('loading').hidden = true;
  if (dashboard && mode !== 'parent') {
    $('parent-only').hidden = false;
    return;
  }

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
  if (!selected) {
    if (mode === 'parent') {
      $('no-child-text').textContent = 'Още няма деца. Добави първото.';
      $('no-child-link').textContent = 'Добави дете';
      $('no-child-link').href = `${laRoot()}app/#/family`;
    }
    $('no-child').hidden = false;
    return;
  }
  const pick = async (child) => {
    renderSwitch(children, child, pick);
    await renderCard(child, mode);
  };
  await pick(selected);
}

const bar = shellBar($('shell-bar'));
render().catch((error) => {
  console.error(error);
  $('loading').hidden = true;
  showError($('page-error'), error.message || 'Нещо се обърка. Опитай пак.');
});

// Another tab changed the child, signed out or a badge came.
if (typeof BroadcastChannel !== 'undefined') {
  new BroadcastChannel('levacademy').addEventListener('message', ({ data }) => {
    bar.refresh();
    if (['signed-out', 'child-changed', 'badges-changed'].includes(data?.type)) location.reload();
  });
}
