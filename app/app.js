// /app/: device mode (Родител | Дете), the family (children, parents, invite) and the child's apps.
import { store } from '../core/store.js';
import { goTo, laRoot, showError } from '../core/ui.js';

const $ = (id) => document.getElementById(id);
const sections = ['mode-choice', 'parent-view', 'child-pick', 'child-apps'];

let family = null;
let schoolList = null;

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}

function avatarImg(n, alt = '') {
  return el('img', { src: `${laRoot()}avatars/${String(n).padStart(2, '0')}.webp`, alt, width: 96, height: 96 });
}

function show(sectionId) {
  $('loading').hidden = true;
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

// Screens

async function render() {
  showError($('page-error'), '');
  const user = await store.currentUser();
  if (!user) {
    goTo('login/');
    return;
  }
  const mode = await store.deviceMode();
  $('sign-out').hidden = mode !== 'parent';
  // Open decision: how parent mode is protected on the child's tablet (a PIN or the password again).
  // Until it is decided, „Родител“ switches back without any check.
  $('to-parent').hidden = mode !== 'child';
  $('bar-child').hidden = true;

  if (mode === 'parent') return renderParent(user);
  if (mode === 'child') return renderChild();
  show('mode-choice');
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

async function renderChild() {
  const current = await store.currentChild();
  if (current) return renderApps(current);

  const { children } = await store.myFamily();
  $('child-tiles').replaceChildren(...children.map((child) =>
    el('button', {
      className: 'child-tile',
      type: 'button',
      onclick: async () => {
        await store.selectChild(child.id);
        refresh();
      },
    }, avatarImg(child.avatar), el('span', { textContent: child.name }))));
  $('no-children-child').hidden = children.length > 0;
  show('child-pick');
}

async function renderApps(child) {
  $('bar-child').replaceChildren(avatarImg(child.avatar), el('span', { textContent: child.name }));
  $('bar-child').hidden = false;
  $('apps-title').textContent = `Какво ще учим, ${child.name}?`;
  const response = await fetch(`${laRoot()}apps.json`);
  const apps = response.ok ? await response.json() : [];
  $('apps-grid').replaceChildren(...apps.map((app) =>
    el('a', { className: 'app-tile', href: `${laRoot()}${app.path}` },
      app.avatar ? avatarImg(app.avatar) : null,
      el('strong', { textContent: app.name }),
      el('span', { textContent: app.about || '' }))));
  show('child-apps');
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
      refresh();
    });
  }
  $('to-child').addEventListener('click', async () => {
    await store.setDeviceMode('child');
    await store.selectChild(null);
    refresh();
  });
  $('to-parent').addEventListener('click', async () => {
    await store.setDeviceMode('parent');
    refresh();
  });
  $('change-child').addEventListener('click', async () => {
    await store.selectChild(null);
    refresh();
  });
  $('sign-out').addEventListener('click', async () => {
    await store.signOut();
    if (store.provider === 'local') goTo('login/');
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

  // Another tab changed the child or signed out.
  if (typeof BroadcastChannel !== 'undefined') {
    new BroadcastChannel('levacademy').addEventListener('message', refresh);
  }
}

function fail(error) {
  console.error(error);
  $('loading').hidden = true;
  showError($('page-error'), error.message || 'Нещо се обърка. Опитай пак.');
}

function refresh() {
  render().catch(fail);
}

wire();
refresh();
