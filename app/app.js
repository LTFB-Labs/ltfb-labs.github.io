// /app/: the shell. Under its bar it shows the home page (no app open), an app (#/<route>), the family (#/family,
// parent mode) or „Кой учи днес?“ (#/who, child mode). Apps run in a sandboxed frame through @ltfb/academy-core.
import { store } from '../core/store.js';
import { goTo, laRoot, showError } from '../core/ui.js';
import { shellBar } from '../core/shell-bar.js';
import { appsFor } from '../core/apps.js';
import { mountApp } from '../core/academy-core/shell.js';
import { DEFAULT_SETTINGS } from '../core/academy-core/types.js';

const $ = (id) => document.getElementById(id);
const sections = ['parent-view', 'child-pick', 'parent-only'];
const PENDING_ROUTE_KEY = 'la.pendingRoute';

let family = null;
let schoolList = null;
let bar = null;
let opened = null;   // { route, inner, childId, app, mounted }

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}

function avatarImg(n, alt = '') {
  return el('img', { src: `${laRoot()}avatars/${String(n).padStart(2, '0')}.webp`, alt, width: 96, height: 96 });
}

// What is on screen: the stage (home page or app, the whole height) or one section of the page.
function showStage() {
  $('loading').hidden = true;
  $('page').hidden = true;
  $('stage').hidden = false;
}

function show(sectionId) {
  closeApp();
  $('loading').hidden = true;
  $('stage').hidden = true;
  $('page').hidden = false;
  for (const id of sections) $(id).hidden = id !== sectionId;
}

async function schools() {
  schoolList ??= await store.schools();
  return schoolList;
}

async function schoolText(child) {
  if (child.schoolChoice === 'other') return 'друго училище';
  if (child.schoolChoice !== 'listed') return '';
  const school = (await schools()).find((s) => s.id === child.schoolId);
  return school ? school.name : '';
}

const routeParts = () => location.hash.replace(/^#\/?/, '').split('/');
const readPending = () => { try { return sessionStorage.getItem(PENDING_ROUTE_KEY); } catch { return null; } };
const writePending = (value) => { try { if (value) sessionStorage.setItem(PENDING_ROUTE_KEY, value); else sessionStorage.removeItem(PENDING_ROUTE_KEY); } catch { /* private mode */ } };

// Screens

async function render() {
  showError($('page-error'), '');
  const user = await store.currentUser();
  if (!user) {
    goTo('login/');
    return;
  }
  const mode = await store.deviceMode();
  if (!mode && !$('mode-dialog').open) $('mode-dialog').showModal();

  const [route, ...rest] = routeParts();
  if (!route) return showHome();
  if (route === 'family') return mode === 'parent' ? renderParent(user) : showHome();
  if (route === 'who') return mode === 'child' ? renderChildPick() : showHome();
  return openApp(route, rest.join('/'), mode);
}

// No app open: the LevAcademy home page under the shell's bar (without its own header, footer and analytics).
function showHome() {
  closeApp();
  showStage();
  if (!$('stage').querySelector('.home-frame')) {
    $('stage').replaceChildren(el('iframe', { className: 'home-frame', title: 'LevAcademy', src: `${laRoot()}?embed=shell` }));
  }
}

async function renderParent(user) {
  family = await store.myFamily();
  $('parent-hello').textContent = `Здравей, ${user.displayName}!`;

  const list = $('children-list');
  list.replaceChildren();
  for (const child of family.children) {
    const details = [`${child.grade}. клас`, await schoolText(child)].filter(Boolean).join(' · ');
    list.append(el('li', { className: 'child-card' },
      avatarImg(child.avatar),
      el('div', { className: 'child-card-text' },
        el('strong', { textContent: child.name }),
        el('span', { textContent: details })),
      el('button', {
        className: 'button button-small',
        type: 'button',
        textContent: 'Промени',
        onclick: () => openChildDialog(child),
      })));
  }
  $('no-children-parent').hidden = family.children.length > 0;

  $('members-list').replaceChildren(...family.members.map((m) =>
    el('li', {}, el('strong', { textContent: m.displayName }), el('span', { textContent: m.email }))));
  show('parent-view');
}

async function renderChildPick() {
  const { children } = await store.myFamily();
  $('child-tiles').replaceChildren(...children.map((child) =>
    el('button', {
      className: 'child-tile',
      type: 'button',
      onclick: async () => {
        await store.selectChild(child.id);
        const pending = readPending();
        writePending(null);
        location.hash = pending ? `#/${pending}` : '#/';
        bar.refresh();
      },
    }, avatarImg(child.avatar), el('span', { textContent: child.name }))));
  $('no-children-child').hidden = children.length > 0;
  show('child-pick');
}

// The child's profile for the apps: never the place, the school or the parents.
async function profileOf(child) {
  return {
    id: child.id,
    kind: 'child',
    displayName: child.name,
    grade: child.grade,
    avatar: child.avatar,
    avatarUrl: new URL(`avatars/${String(child.avatar).padStart(2, '0')}.webp`, new URL(laRoot(), location.href)).href,
    badges: await store.badges(child.id),
  };
}

function toast(text) {
  const note = el('div', { className: 'shell-toast', role: 'status', textContent: text });
  $('stage').append(note);
  setTimeout(() => note.remove(), 4000);
}

function closeApp() {
  if (opened) bar.setActiveRoute(null);
  opened?.mounted.destroy();
  opened = null;
  $('stage').querySelector('.app-frame')?.remove();
}

async function openApp(route, inner, mode) {
  if (mode !== 'child') {
    show('parent-only');
    return;
  }
  const child = await store.currentChild();
  if (!child) {
    writePending([route, inner].filter(Boolean).join('/'));
    location.hash = '#/who';
    return;
  }
  // The same app for the same child stays; the bar's link to it (no inner path) opens it from its start again.
  if (opened && opened.route === route && opened.childId === child.id && (inner === opened.inner || inner)) return;
  const app = (await appsFor(child)).find((a) => a.manifest.route === route);
  if (!app) {
    show(null);
    showError($('page-error'), 'Този ап не е достъпен.');
    return;
  }
  closeApp();
  $('stage').querySelector('.home-frame')?.remove();
  showStage();
  const mounted = mountApp({
    container: $('stage'),
    app,
    frameUrl: new URL(`${laRoot()}core/frame.html`, location.href).href,
    route: inner,
    handlers: {
      getUser: () => profileOf(child),
      getSettings: async () => DEFAULT_SETTINGS,
      grantUserBadge: async (appId, badge) => {
        const row = await store.grantBadge(child.id, appId, badge);
        toast(`Нова значка: ${row.name}`);
        return row;
      },
      appData: (appId, op, params) => store.appData(child.id, appId, op, params),
      navigate: (appId, next) => {
        if (opened) opened.inner = next;
        history.replaceState(null, '', `#/${route}${next ? `/${next}` : ''}`);
      },
      onFail: () => toast('Апът не е достъпен.'),
    },
  });
  opened = { route, inner, childId: child.id, app, mounted };
  bar.setActiveRoute(route);
}

// Child dialog

let editing = null;

function fillGradeAndAvatarChoices() {
  $('grade-choices').replaceChildren(...[1, 2, 3, 4, 5, 6, 7].map((g) =>
    el('label', { className: 'chip chip-square' },
      el('input', { type: 'radio', name: 'grade', value: String(g), required: true }),
      el('span', { textContent: String(g) }))));
  $('avatar-choices').replaceChildren(...Array.from({ length: 12 }, (_, i) =>
    el('label', { className: 'avatar-choice' },
      el('input', { type: 'radio', name: 'avatar', value: String(i + 1), required: true }),
      avatarImg(i + 1, `Картинка ${i + 1}`))));
}

// The select always has „Друго училище“ and „Не искам да посочвам“; in София it also lists the schools
// that match the search text.
function fillSchoolSelect(selected) {
  const form = $('child-form');
  const inSofia = form.elements.city.value === 'sofia';
  const list = inSofia ? schoolList || [] : [];
  $('school-search').hidden = list.length === 0;
  const query = $('school-search').value.trim().toLowerCase();
  const matches = query ? list.filter((s) => s.name.toLowerCase().includes(query)) : list;
  const select = $('school-select');
  select.replaceChildren(
    el('option', { value: 'hidden', textContent: 'Не искам да посочвам' }),
    el('option', { value: 'other', textContent: 'Друго училище' }),
    ...matches.map((s) => el('option', { value: `listed:${s.id}`, textContent: s.name })));
  const values = [...select.options].map((o) => o.value);
  const keep = values.includes(selected) && (selected.startsWith('listed:') || !query || !matches.length);
  if (keep) select.value = selected;
  else if (query && matches.length) select.value = `listed:${matches[0].id}`;   // typing picks the first match
  else select.value = 'hidden';
}

async function openChildDialog(child = null) {
  editing = child;
  await schools();
  const form = $('child-form');
  form.reset();
  showError($('child-error'), '');
  $('school-search').value = '';
  $('child-dialog-title').textContent = child ? 'Промени детето' : 'Ново дете';
  $('child-remove').hidden = !child;
  form.elements.name.value = child?.name || '';
  form.elements.city.value = child?.city || 'sofia';
  if (child) {
    form.elements.grade.value = String(child.grade);
    form.elements.avatar.value = String(child.avatar);
  }
  const selected = child?.schoolChoice === 'listed' ? `listed:${child.schoolId}` : (child?.schoolChoice || 'hidden');
  fillSchoolSelect(selected);
  $('child-dialog').showModal();
}

async function saveChildFromForm(event) {
  event.preventDefault();
  const form = $('child-form');
  const school = form.elements.school.value;
  const [schoolChoice, schoolId] = school.startsWith('listed:') ? ['listed', school.slice(7)] : [school, null];
  if (!form.elements.grade.value) return showError($('child-error'), 'Избери клас.');
  if (!form.elements.avatar.value) return showError($('child-error'), 'Избери картинка.');
  try {
    await store.saveChild({
      ...(editing ? { id: editing.id } : {}),
      name: form.elements.name.value,
      city: form.elements.city.value,
      schoolChoice,
      schoolId,
      grade: Number(form.elements.grade.value),
      avatar: Number(form.elements.avatar.value),
    });
    $('child-dialog').close();
    refresh();
  } catch (error) {
    showError($('child-error'), error.message);
  }
}

async function removeEditingChild() {
  if (!editing || !confirm(`Да премахнем ли ${editing.name}? Историята на детето също ще се изтрие.`)) return;
  try {
    await store.removeChild(editing.id);
    $('child-dialog').close();
    refresh();
  } catch (error) {
    showError($('child-error'), error.message);
  }
}

// Invite dialog

function openInviteDialog() {
  $('invite-form').reset();
  $('invite-result').hidden = true;
  $('invite-create').hidden = false;
  showError($('invite-error'), '');
  $('invite-dialog').showModal();
}

async function createInvite(event) {
  event.preventDefault();
  try {
    const { link } = await store.createInvite($('invite-form').elements.email.value);
    $('invite-link').value = link;
    $('invite-result').hidden = false;
    $('invite-create').hidden = true;
    $('invite-share').hidden = !navigator.share;
    showError($('invite-error'), '');
  } catch (error) {
    showError($('invite-error'), error.message);
  }
}

async function copyInvite() {
  const input = $('invite-link');
  try {
    await navigator.clipboard.writeText(input.value);
    $('invite-copy').textContent = 'Копирано';
    setTimeout(() => { $('invite-copy').textContent = 'Копирай'; }, 2000);
  } catch {
    input.select();   // clipboard blocked: leave the text selected for a manual copy
  }
}

function shareInvite() {
  navigator.share({
    title: 'Покана за LevAcademy',
    text: 'Поканвам те в нашето семейство в LevAcademy.',
    url: $('invite-link').value,
  }).catch(() => { /* the parent closed the share sheet */ });
}

// Wiring

function wire() {
  fillGradeAndAvatarChoices();
  for (const button of document.querySelectorAll('.mode-button')) {
    button.addEventListener('click', async () => {
      await store.setDeviceMode(button.dataset.mode);
      $('mode-dialog').close();
      location.hash = button.dataset.mode === 'parent' ? '#/family' : '#/who';
      bar.refresh();
      refresh();
    });
  }
  $('to-child-mode').addEventListener('click', async () => {
    await store.setDeviceMode('child');
    await store.selectChild(null);
    location.hash = '#/who';
    bar.refresh();
  });

  $('add-child').addEventListener('click', () => openChildDialog());
  $('child-form').addEventListener('submit', saveChildFromForm);
  $('child-cancel').addEventListener('click', () => $('child-dialog').close());
  $('child-remove').addEventListener('click', removeEditingChild);
  $('child-form').addEventListener('change', (event) => {
    if (event.target.name === 'city') fillSchoolSelect($('school-select').value);
  });
  $('school-search').addEventListener('input', () => fillSchoolSelect($('school-select').value));

  $('invite-button').addEventListener('click', openInviteDialog);
  $('invite-form').addEventListener('submit', createInvite);
  $('invite-copy').addEventListener('click', copyInvite);
  $('invite-share').addEventListener('click', shareInvite);
  $('invite-close').addEventListener('click', () => $('invite-dialog').close());

  addEventListener('hashchange', refresh);

  // Another tab changed the child, signed out or a badge came: redraw the bar; a new child reopens the app.
  if (typeof BroadcastChannel !== 'undefined') {
    new BroadcastChannel('levacademy').addEventListener('message', ({ data }) => {
      bar.refresh();
      if (data?.type === 'badges-changed') opened?.mounted.notifyChange();
      else refresh();
    });
  }
}

function fail(error) {
  console.error(error);
  $('loading').hidden = true;
  $('page').hidden = false;
  $('stage').hidden = true;
  showError($('page-error'), error.message || 'Нещо се обърка. Опитай пак.');
}

function refresh() {
  render().catch(fail);
}

bar = shellBar($('shell-bar'));
wire();
refresh();
