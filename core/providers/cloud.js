// Cloud provider: sign-in with Amazon Cognito, data in Supabase (EU).
// Supabase trusts the Cognito access token (third-party auth); all row access goes through RLS
// with current_auth_id() = the token's sub. Table and RPC names follow server/migrations.
import {
  initCognito, redirectToLogin, handleCallback, accessToken, profile, signOutRedirect,
} from '../auth-cognito.js';

export const name = 'cloud';

const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const USER_KEY = 'la.cloud.user';
const CHILD_COLUMNS = 'id, name, city, school_choice, school_id, grade, avatar';

let config = null;
let siteRoot = '';
let clientPromise = null;

export function init(options) {
  config = options.config;
  siteRoot = options.siteRoot;
  initCognito({ domain: config.cognito.domain, clientId: config.cognito.clientId, siteRoot: options.siteRoot });
}

function client() {
  clientPromise ??= import(SUPABASE_ESM).then(({ createClient }) =>
    createClient(config.supabase.url, config.supabase.anonKey, {
      accessToken: async () => (await accessToken()) ?? null,
    }));
  return clientPromise;
}

// Supabase calls return { data, error }; turn an error into a message for the parent.
// The RPCs raise Bulgarian messages (e.g. „Поканата е изтекла.“): show those as they are.
function check({ data, error }, message = 'Нещо се обърка. Провери интернета и опитай пак.') {
  if (error) {
    console.error(error);
    throw new Error(/[а-яА-Я]/.test(error.message || '') ? error.message : message, { cause: error });
  }
  return data;
}

function displayName(row) {
  return row.display_name || String(row.email || '').split('@')[0];
}

function toChild(row) {
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    schoolChoice: row.school_choice,
    schoolId: row.school_id,
    grade: row.grade,
    avatar: row.avatar,
  };
}

function toActivity(row) {
  return {
    id: row.id,
    childId: row.child_id,
    app: row.app,
    kind: row.kind,
    topic: row.topic,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    points: row.points,
    maxPoints: row.max_points,
    seconds: row.seconds,
    details: row.details,
    contract: row.contract,
  };
}

function toAward(row) {
  return {
    id: row.id,
    childId: row.child_id,
    app: row.app,
    kind: row.kind,
    code: row.code,
    value: row.value,
    topic: row.topic ?? null,
    earnedAt: row.earned_at,
  };
}

// ensure_user creates the users row (and a first family) on the first sign-in; idempotent.
async function ensureUser(me) {
  const supabase = await client();
  const row = check(await supabase.rpc('ensure_user', { p_email: me.email, p_display_name: me.name }),
    'Не успяхме да те впишем. Опитай пак.');
  const user = { id: row.id, authId: me.sub, email: row.email, displayName: displayName(row) };
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  return user;
}

async function me() {
  const signedIn = await profile();
  if (!signedIn) return null;
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { /* ignore */ }
  return cached && cached.authId === signedIn.sub ? cached : ensureUser(signedIn);
}

async function requireMe() {
  const user = await me();
  if (!user) throw new Error('Трябва да влезеш отново.');
  return user;
}

// The family shown to the parent: the one joined last (after an invite, that is the shared family).
async function familyId() {
  const user = await requireMe();
  const supabase = await client();
  const rows = check(await supabase.from('family_members')
    .select('family_id, joined_at')
    .eq('user_id', user.id)
    .order('joined_at', { ascending: false })
    .limit(1));
  if (!rows.length) throw new Error('Няма намерено семейство.');
  return rows[0].family_id;
}

// Auth

export async function currentUser() {
  const user = await me();
  return user ? { id: user.id, email: user.email, displayName: user.displayName } : null;
}

export async function signIn({ mode = 'login' } = {}) {
  await redirectToLogin(mode);
}

export async function completeSignIn() {
  await handleCallback();
  return ensureUser(await profile()).then(({ id, email, displayName }) => ({ id, email, displayName }));
}

export async function signOut() {
  localStorage.removeItem(USER_KEY);
  signOutRedirect();
}

// Family

export async function myFamily() {
  const id = await familyId();
  const supabase = await client();
  const [members, children] = await Promise.all([
    supabase.from('family_members').select('joined_at, users(id, email, display_name)')
      .eq('family_id', id).order('joined_at'),
    supabase.from('children').select(CHILD_COLUMNS).eq('family_id', id).order('created_at'),
  ]);
  return {
    id,
    members: check(members).map(({ users: u }) => ({ id: u.id, email: u.email, displayName: displayName(u) })),
    children: check(children).map(toChild),
  };
}

export async function child(id) {
  const supabase = await client();
  const row = check(await supabase.from('children').select(CHILD_COLUMNS).eq('id', id).maybeSingle());
  return row ? toChild(row) : null;
}

export async function saveChild(input) {
  const supabase = await client();
  const row = {
    name: input.name,
    city: input.city,
    school_choice: input.schoolChoice,
    school_id: input.schoolId,
    grade: input.grade,
    avatar: input.avatar,
  };
  const query = input.id
    ? supabase.from('children').update(row).eq('id', input.id)
    : supabase.from('children').insert({ ...row, family_id: await familyId() });
  return toChild(check(await query.select(CHILD_COLUMNS).single(), 'Не успяхме да запишем детето. Опитай пак.'));
}

export async function removeChild(id) {
  const supabase = await client();
  check(await supabase.from('children').delete().eq('id', id), 'Не успяхме да премахнем детето. Опитай пак.');
}

export async function createInvite(email) {
  const supabase = await client();
  const token = check(await supabase.rpc('create_invite', { p_email: String(email || '').trim().toLowerCase() }),
    'Не успяхме да направим покана. Опитай пак.');
  return { token, link: `${siteRoot}register/?invite=${token}` };
}

export async function acceptInvite(token) {
  const supabase = await client();
  return check(await supabase.rpc('accept_invite', { p_token: token }),
    'Поканата не е валидна или е изтекла. Помоли за нова.');
}

// History

export async function saveActivity(childId, app, activity) {
  const supabase = await client();
  const row = {
    child_id: childId,
    app,
    kind: activity.kind,
    topic: activity.topic ?? null,
    started_at: activity.startedAt ?? null,
    finished_at: activity.finishedAt ?? null,
    points: activity.points ?? null,
    max_points: activity.maxPoints ?? null,
    seconds: activity.seconds ?? null,
    details: activity.details ?? null,
    contract: 1,
  };
  return toActivity(check(await supabase.from('activities').insert(row).select().single(),
    'Не успяхме да запишем. Провери интернета и опитай пак.'));
}

export async function activities(childId, { app, since } = {}) {
  const supabase = await client();
  let query = supabase.from('activities').select('*').eq('child_id', childId);
  if (app) query = query.eq('app', app);
  if (since) query = query.gte('started_at', new Date(since).toISOString());
  return check(await query.order('started_at', { ascending: false })).map(toActivity);
}

export async function award(childId, app, { kind, code, value = null, topic = null }) {
  const supabase = await client();
  const row = { child_id: childId, app, kind, code, value, topic };
  return toAward(check(await supabase.from('awards').insert(row).select().single(),
    'Не успяхме да запишем наградата. Опитай пак.'));
}

export async function awards(childId) {
  const supabase = await client();
  return check(await supabase.from('awards').select('*').eq('child_id', childId)
    .order('earned_at', { ascending: false })).map(toAward);
}

export async function percentile(childId, app, topic) {
  const supabase = await client();
  const value = check(await supabase.rpc('percentile_rank', { p_child_id: childId, p_app: app, p_topic: topic }));
  return value == null ? null : Number(value);
}
