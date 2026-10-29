// The shell's top bar, the same on every /app/ page and while an app is open:
// on the left the logo and „LevAcademy“; on the right the apps (to switch at any time) and the avatar of who
// is using the device, with its menu (раница, табло, семейство, смяна на детето или режима, изход).
// Going back from „Дете“ to „Родител“ asks for the parent's password.
import { store } from './store.js';
import { appsFor, iconOf } from './apps.js';

const root = new URL('../', import.meta.url).href;
const avatarUrl = (n) => `${root}avatars/${String(n).padStart(2, '0')}.webp`;
const go = (path) => location.assign(`${root}${path}`);

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
}

// A button that opens a panel under it; one panel is open at a time, Escape and a click outside close it.
function closePanels() {
  document.querySelectorAll('.shell-drop-panel:not([hidden])').forEach((panel) => { panel.hidden = true; });
  document.querySelectorAll('.shell-drop > [aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
}
document.addEventListener('click', (event) => { if (!event.target.closest?.('.shell-drop')) closePanels(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closePanels(); });

function dropdown(button, panel) {
  panel.hidden = true;
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-haspopup', 'true');
  button.addEventListener('click', () => {
    const open = panel.hidden;
    closePanels();
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  });
  panel.addEventListener('click', (event) => { if (event.target.closest('a, button')) closePanels(); });
  return el('div', { className: 'shell-drop' }, button, panel);
}

// The parent's password before the device goes back to „Родител“.
function askPassword() {
  return new Promise((resolve) => {
    const input = el('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true });
    const error = el('p', { className: 'core-error', role: 'alert', hidden: true });
    const forgot = store.provider === 'cloud'
      ? el('button', { type: 'button', className: 'core-text-button', textContent: 'Забравена парола?' }) : null;
    const form = el('form', { className: 'core-form', method: 'dialog' },
      el('h2', { textContent: 'Родител' }),
      el('p', { className: 'core-note', textContent: 'Напиши паролата си, за да минеш в режим „Родител“.' }),
      el('label', { className: 'field' }, 'Парола', input),
      error,
      el('div', { className: 'dialog-actions' },
        el('button', { type: 'submit', className: 'button button-primary', textContent: 'Влез като родител' }),
        el('button', { type: 'button', className: 'button', textContent: 'Откажи', onclick: () => dialog.close() }),
        forgot));
    const dialog = el('dialog', { className: 'core-dialog' }, form);
    let ok = false;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await store.verifyPassword(input.value);
        ok = true;
        dialog.close();
      } catch (e) {
        error.textContent = e.message;
        error.hidden = false;
        input.select();
      }
    });
    forgot?.addEventListener('click', async () => {
      try {
        const user = await store.currentUser();
        const { notice } = await store.resetPassword(user.email);
        error.textContent = notice;
      } catch (e) { error.textContent = e.message; }
      error.hidden = false;
    });
    dialog.addEventListener('close', () => { dialog.remove(); resolve(ok); });
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
  });
}

async function toParent() {
  if (await askPassword()) {
    await store.setDeviceMode('parent');
    go('app/#/family');
  }
}

async function toChild() {
  await store.setDeviceMode('child');
  await store.selectChild(null);
  go('app/#/who');
}

async function signOut() {
  await store.signOut();
  go('login/');
}

function menuItem(text, action) {
  return typeof action === 'string'
    ? el('a', { className: 'shell-menu-item', href: `${root}${action}`, textContent: text })
    : el('button', { type: 'button', className: 'shell-menu-item', textContent: text, onclick: action });
}

/** Draws the bar into `header` and returns { refresh, setActiveRoute } to redraw it after a change. */
export function shellBar(header) {
  let activeRoute = null;
  header.className = 'shell-bar';

  async function draw() {
    const user = await store.currentUser();
    const mode = await store.deviceMode();
    const child = mode === 'child' ? await store.currentChild() : null;

    const brand = el('a', { className: 'shell-brand', href: `${root}app/#/` },
      el('img', { src: `${root}img/logo.svg`, alt: '', width: 36, height: 36 }),
      el('span', { textContent: 'LevAcademy' }));
    const end = el('div', { className: 'shell-bar-end' });

    if (user && child) {
      const all = await appsFor(child);
      const link = (app) => el('a', {
        className: `shell-app${app.manifest.route === activeRoute ? ' is-active' : ''}`,
        href: `${root}app/#/${app.manifest.route}`,
      }, el('img', { src: iconOf(app), alt: '', width: 40, height: 40 }), el('span', { textContent: app.manifest.name }));
      const apps = all.filter((app) => app.kind === 'app');
      const games = all.filter((app) => app.kind === 'game');
      const list = el('div', { className: 'shell-drop-panel shell-apps-panel', role: 'menu' },
        el('p', { className: 'shell-menu-title', textContent: 'Апи' }),
        ...apps.map(link),
        apps.length ? null : el('p', { className: 'core-note', textContent: 'Още няма апи за този клас.' }),
        games.length ? el('p', { className: 'shell-menu-title', textContent: 'Игри' }) : null,
        ...games.map(link));
      const button = el('button', { type: 'button', className: 'shell-icon-button', ariaLabel: 'Апи' },
        el('span', { className: 'shell-grid-icon', ariaHidden: 'true' }), el('span', { className: 'shell-label', textContent: 'Апи' }));
      end.append(dropdown(button, list));
    }

    if (user) {
      const face = child
        ? el('img', { className: 'shell-avatar', src: avatarUrl(child.avatar), alt: '' })
        : el('span', { className: 'shell-avatar shell-initials', textContent: initials(user.displayName) });
      const who = child ? child.name : user.displayName;
      const items = mode === 'child'
        ? [child ? menuItem('Моята раница', 'app/backpack/') : null,
          menuItem(child ? 'Смени детето' : 'Кой учи?', async () => { await store.selectChild(null); go('app/#/who'); }),
          menuItem('Родител', toParent)]
        : mode === 'parent'
          ? [menuItem('Семейство', 'app/#/family'), menuItem('Табло', 'app/dashboard/'), menuItem('Раница', 'app/backpack/'),
            menuItem('Режим „Дете“', toChild), menuItem('Изход', signOut)]
          : [menuItem('Изход', signOut)];
      const panel = el('div', { className: 'shell-drop-panel shell-person-panel', role: 'menu' },
        el('p', { className: 'shell-menu-title' }, el('strong', { textContent: who }),
          el('span', { textContent: mode === 'child' ? 'режим „Дете“' : mode === 'parent' ? user.email : '' })),
        ...items.filter(Boolean));
      const button = el('button', { type: 'button', className: 'shell-person-button', ariaLabel: `Профил: ${who}` },
        face, el('span', { className: 'shell-label', textContent: who }));
      end.append(dropdown(button, panel));
    } else {
      end.append(el('a', { className: 'button button-small', href: `${root}login/`, textContent: 'Вход' }));
    }

    header.replaceChildren(brand, end);
  }

  draw().catch((error) => console.error('shell bar:', error));
  const refresh = () => draw().catch((error) => console.error('shell bar:', error));
  return { refresh, setActiveRoute(route) { activeRoute = route; refresh(); } };
}

export { toParent };
