// /app/dashboard/: the parent's view of one child's activity in every app.
// Parent mode only. The percentile comes from the store and is shown only when it is not null.
import { store } from '../../core/store.js';
import { goTo, laRoot, showError } from '../../core/ui.js';

const $ = (id) => document.getElementById(id);
const DAYS = 14;
const RECENT = 20;
const KIND_TEXT = { test: 'Тест', practice: 'Упражнение', lesson: 'Урок', game: 'Игра' };

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}

const avatarSrc = (n) => `${laRoot()}avatars/${String(n).padStart(2, '0')}.webp`;
const localDay = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const percentOf = (a) => (a.maxPoints > 0 ? Math.round((100 * a.points) / a.maxPoints) : null);
const minutesText = (s) => (s >= 60 ? `${Math.round(s / 60)} мин` : `${s} сек`);

function topicText(topic) {
  if (!topic || topic === 'all') return 'всички задачи';
  const type = /^type-(\d+)$/.exec(topic);
  return type ? `тип ${type[1]}` : topic;
}

async function loadApps() {
  try {
    const response = await fetch(`${laRoot()}apps.json`);
    return response.ok ? await response.json() : [];
  } catch {
    return [];
  }
}

// Activity per day

function lastDays() {
  const days = [];
  const today = new Date();
  for (let i = DAYS - 1; i >= 0; i--) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    days.push({ key: localDay(date), date, count: 0 });
  }
  return days;
}

function renderChart(activities) {
  const days = lastDays();
  for (const a of activities) {
    const day = days.find((d) => d.key === localDay(new Date(a.startedAt || a.finishedAt)));
    if (day) day.count++;
  }
  const max = Math.max(...days.map((d) => d.count));
  const peak = max > 0 ? days.findLastIndex((d) => d.count === max) : -1;
  const longDate = (d) => d.date.toLocaleDateString('bg-BG', { weekday: 'short', day: 'numeric', month: 'long' });
  const todayKey = days[days.length - 1].key;

  $('day-chart').replaceChildren(...days.map((d, i) => {
    const col = el('div', { className: `day-col${d.key === todayKey ? ' today' : ''}` },
      i === peak ? el('span', { className: 'day-value', textContent: String(d.count) }) : null,
      el('span', { className: 'day-bar' }),
      el('span', { className: 'day-tip', textContent: `${longDate(d)}: ${d.count}` }));
    col.querySelector('.day-bar').style.setProperty('--h', max ? `${(d.count / max) * 85}%` : '0');
    return col;
  }));
  $('day-chart').after(el('div', { className: 'day-labels', ariaHidden: 'true' },
    ...days.map((d) => el('span', { className: d.key === todayKey ? 'today' : '', textContent: String(d.date.getDate()) }))));

  const total = days.reduce((s, d) => s + d.count, 0);
  $('chart-caption').textContent = total
    ? `Общо ${total} ${total === 1 ? 'дейност' : 'дейности'} за ${DAYS} дни. Най-много: ${max} на ${longDate(days[peak])}.`
    : `Няма дейности през последните ${DAYS} дни.`;
  $('day-table').replaceChildren(...days.map((d) =>
    el('tr', {}, el('td', { textContent: longDate(d) }), el('td', { textContent: String(d.count) }))));
}

// Per app

async function renderApps(child, activities, apps) {
  const byApp = new Map();
  for (const a of activities) {
    if (!byApp.has(a.app)) byApp.set(a.app, []);
    byApp.get(a.app).push(a);
  }
  $('no-apps').hidden = byApp.size > 0;
  const cards = await Promise.all([...byApp].map(async ([appId, list]) => {
    const app = apps.find((a) => a.id === appId);
    const percents = list.map(percentOf).filter((p) => p !== null);
    const average = percents.length ? Math.round(percents.reduce((s, p) => s + p, 0) / percents.length) : null;
    const percentile = await store.percentile(child.id, appId, 'all').catch(() => null);
    return el('article', { className: 'app-card' },
      el('div', { className: 'app-card-head' },
        app?.avatar ? el('img', { src: avatarSrc(app.avatar), alt: '', width: 48, height: 48 }) : null,
        el('strong', { textContent: app?.name || appId })),
      el('div', { className: 'app-card-stats' },
        el('div', { className: 'stat' }, el('b', { textContent: String(list.length) }), el('span', { textContent: list.length === 1 ? 'дейност' : 'дейности' })),
        el('div', { className: 'stat' }, el('b', { textContent: average === null ? '—' : `${average} %` }), el('span', { textContent: 'среден резултат' }))),
      percentile == null ? null
        : el('p', { className: 'percentile', textContent: `по-добре от ${Math.round(percentile)} % от децата в същия клас` }));
  }));
  $('app-summary').replaceChildren(...cards);
}

// Recent activities

function renderRecent(activities, apps) {
  const recent = activities.slice(0, RECENT);
  $('no-recent').hidden = recent.length > 0;
  $('recent').replaceChildren(...recent.map((a) => {
    const app = apps.find((x) => x.id === a.app);
    const when = new Date(a.finishedAt || a.startedAt).toLocaleString('bg-BG', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    const pct = percentOf(a);
    return el('li', {},
      el('span', { className: 'what', textContent: `${app?.name || a.app} · ${KIND_TEXT[a.kind] || a.kind} · ${topicText(a.topic)}` }),
      el('span', { className: 'score', textContent: a.maxPoints ? `${a.points} от ${a.maxPoints} т.` : '' }),
      el('span', { className: 'when', textContent: a.seconds ? `${when} · ${minutesText(a.seconds)}` : when }),
      el('span', { className: 'pct', textContent: pct === null ? '' : `${pct} %` }));
  }));
}

// Page

async function renderChild(child, apps) {
  const activities = await store.activities(child.id);
  const since = new Date();
  since.setDate(since.getDate() - DAYS);
  renderChart(activities.filter((a) => new Date(a.startedAt || a.finishedAt) >= since));
  renderRecent(activities, apps);
  await renderApps(child, activities, apps);
}

function renderSwitch(children, selected, onPick) {
  $('child-switch').replaceChildren(...children.map((child) => el('button', {
    className: 'child-switch-item',
    type: 'button',
    ariaPressed: String(child.id === selected.id),
    onclick: () => onPick(child),
  }, el('img', { src: avatarSrc(child.avatar), alt: '', width: 40, height: 40 }), el('span', { textContent: child.name }))));
}

async function render() {
  if (!(await store.currentUser())) return goTo('login/');
  const mode = await store.deviceMode();
  $('loading').hidden = true;
  if (mode !== 'parent') {
    $('parent-only').hidden = false;
    return;
  }
  const [{ children }, apps] = await Promise.all([store.myFamily(), loadApps()]);
  if (!children.length) {
    $('no-children').hidden = false;
    return;
  }
  const pick = async (child) => {
    renderSwitch(children, child, pick);
    document.querySelector('.day-labels')?.remove();
    await renderChild(child, apps);
  };
  $('dashboard').hidden = false;
  await pick(children[0]);
}

render().catch((error) => {
  console.error(error);
  $('loading').hidden = true;
  showError($('page-error'), error.message || 'Нещо се обърка. Опитай пак.');
});

if (typeof BroadcastChannel !== 'undefined') {
  new BroadcastChannel('levacademy').addEventListener('message', ({ data }) => {
    if (data?.type === 'signed-out') location.reload();
  });
}
