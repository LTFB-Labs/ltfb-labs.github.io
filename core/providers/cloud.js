// Cloud provider: Supabase (EU, Frankfurt) for both sign-in (Supabase Auth) and data.
// Sign-in: e-mail + password, Google, Facebook; OAuth and e-mail links come back to /auth/callback/ (PKCE).
// All row access goes through RLS with current_auth_id() = the token's sub (the Supabase user id).
// Table and RPC names follow server/migrations. Same API and return shapes as indexeddb.js.
export const name = 'cloud';

const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const USER_KEY = 'la.cloud.user';
const CHILD_COLUMNS = 'id, name, city, school_choice, school_id, grade, avatar';
const PASSWORD_MIN = 8;
const SOCIAL_PROVIDERS = ['google', 'facebook'];

let config = null;
let siteRoot = '';
let clientPromise = null;

export function init(options) {
  config = options.config;
  siteRoot = options.siteRoot;
}

const callbackUrl = () => `${siteRoot}auth/callback/`;

function client() {
  clientPromise ??= import(SUPABASE_ESM).then(({ createClient }) =>
    createClient(config.supabase.url, config.supabase.anonKey, {
      // 'implicit': the e-mail link itself carries the session (#access_token=…), so confirming the e-mail or
      // setting a new password works on any device — the phone's mail app, another browser. (PKCE links work
      // only in the browser that started the sign-in.) /auth/callback/ reads the link in completeSignIn().
      auth: { flowType: 'implicit', detectSessionInUrl: false, persistSession: true, autoRefreshToken: true },
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

const USER_EXISTS = 'Вече има профил с този имейл. Влез с него.';
const LINK_EXPIRED = 'Връзката от писмото е изтекла или вече е използвана. Поискай нова.';

// Supabase Auth error codes → short messages for the parent.
const AUTH_MESSAGES = {
  invalid_credentials: 'Грешен имейл или парола.',
  email_not_confirmed: 'Имейлът още не е потвърден. Отвори писмото от LevAcademy и натисни връзката в него.',
  user_already_exists: USER_EXISTS,
  email_exists: USER_EXISTS,
  weak_password: `Паролата е твърде слаба. Избери поне ${PASSWORD_MIN} знака, които не се отгатват лесно.`,
  same_password: 'Новата парола трябва да е различна от старата.',
  email_address_invalid: 'Напиши истински имейл.',
  over_email_send_rate_limit: 'Изпратихме твърде много писма. Опитай пак след малко.',
  over_request_rate_limit: 'Твърде много опити. Изчакай малко и опитай пак.',
  otp_expired: LINK_EXPIRED,
  flow_state_expired: 'Входът продължи твърде дълго. Започни отначало.',
  signup_disabled: 'Регистрацията в момента е спряна.',
  provider_disabled: 'Този начин за вход още не е включен.',
  email_provider_disabled: 'Входът с имейл още не е включен.',
};

function authError(error, fallback) {
  console.error(error);
  const text = String(error?.message || '');
  const message = AUTH_MESSAGES[error?.code]
    || (/invalid login credentials/i.test(text) && AUTH_MESSAGES.invalid_credentials)
    || (/email not confirmed/i.test(text) && AUTH_MESSAGES.email_not_confirmed)
    || (/already (been )?registered/i.test(text) && USER_EXISTS)
    || fallback;
  return new Error(message, { cause: error });
}

function cleanEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(value)) throw new Error('Напиши истински имейл.');
  return value;
}

function checkNewPassword(password) {
  const value = String(password || '');
  if (value.length < PASSWORD_MIN) throw new Error(`Паролата трябва да е поне ${PASSWORD_MIN} знака.`);
  return value;
}

function displayName(row) {
  return row.display_name || String(row.email || '').split('@')[0];
}

const publicUser = ({ id, email, displayName: name }) => ({ id, email, displayName: name });

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

// The name from sign-up (display_name) or from Google/Facebook (full_name, name).
function metadataName(authUser) {
  const data = authUser.user_metadata || {};
  return String(data.display_name || data.full_name || data.name || '').trim() || null;
}

// ensure_user creates the users row (and a first family) on the first sign-in; idempotent.
// The e-mail comes from the token on the server; only the display name is sent.
async function ensureUser(authUser) {
  const supabase = await client();
  const row = check(await supabase.rpc('ensure_user', { p_display_name: metadataName(authUser) }),
    'Не успяхме да те впишем. Опитай пак.');
  const user = { id: row.id, authId: authUser.id, email: row.email, displayName: displayName(row) };
  try { localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch { /* private mode */ }
  return user;
}

// The signed-in Supabase user from the stored session (refreshed by supabase-js when needed), or null.
async function sessionUser() {
  const supabase = await client();
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

async function me() {
  const authUser = await sessionUser();
  if (!authUser) return null;
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { /* ignore */ }
  return cached && cached.authId === authUser.id ? cached : ensureUser(authUser);
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
  return user ? publicUser(user) : null;
}

// The /login/ and /register/ forms pass { mode, email, password, displayName };
// the social buttons pass { provider: 'google' | 'facebook' } and the browser leaves for that provider.
// Resolves to the user, or to { notice } when the sign-in is not finished yet.
export async function signIn({ mode = 'login', email, password, displayName: name, provider } = {}) {
  const supabase = await client();

  if (provider) {
    if (!SOCIAL_PROVIDERS.includes(provider)) throw new Error('Непознат начин за вход.');
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: callbackUrl(), skipBrowserRedirect: true },
    });
    if (error) throw authError(error, 'Входът не успя. Опитай пак.');
    location.assign(data.url);
    return { notice: 'Отваряме входа…' };
  }

  const address = cleanEmail(email);
  if (mode === 'register') {
    const pass = checkNewPassword(password);
    const cleanName = String(name || '').trim();   // optional: the parent can add a name later
    const { data, error } = await supabase.auth.signUp({
      email: address,
      password: pass,
      options: { data: cleanName ? { display_name: cleanName } : {}, emailRedirectTo: callbackUrl() },
    });
    if (error) throw authError(error, 'Регистрацията не успя. Опитай пак.');
    // With e-mail confirmation on, an existing address comes back as a user without identities.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw new Error(USER_EXISTS);
    }
    if (!data.session) {
      return { notice: `Изпратихме ти имейл за потвърждение на ${address}. Отвори го и натисни връзката в него, после влез.` };
    }
    return publicUser(await ensureUser(data.user));
  }

  if (!password) throw new Error('Напиши паролата си.');
  const { data, error } = await supabase.auth.signInWithPassword({ email: address, password: String(password) });
  if (error) throw authError(error, 'Входът не успя. Опитай пак.');
  return publicUser(await ensureUser(data.user));
}

// On /auth/callback/: Google/Facebook and e-mail links come back with ?code= (PKCE, same browser only)
// or ?token_hash=&type= (from our e-mail templates, works in any browser). Returns the user.
export async function completeSignIn() {
  const supabase = await client();
  const query = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const errorCode = query.get('error_code') || hash.get('error_code');
  if (errorCode || query.get('error') || hash.get('error')) {
    console.error(query.get('error_description') || hash.get('error_description'));
    throw new Error(errorCode === 'otp_expired' ? LINK_EXPIRED : 'Входът беше прекъснат. Опитай пак.');
  }

  let result = null;
  if (hash.get('access_token') && hash.get('refresh_token')) {
    // Implicit flow: e-mail confirmation, new-password and Google/Facebook links land here with the session.
    try {
      result = await supabase.auth.setSession({ access_token: hash.get('access_token'), refresh_token: hash.get('refresh_token') });
    } catch (e) {
      console.error(e);
      throw new Error(LINK_EXPIRED);
    }
    if (result.error) throw authError(result.error, LINK_EXPIRED);
  } else if (query.get('token_hash')) {
    result = await supabase.auth.verifyOtp({ token_hash: query.get('token_hash'), type: query.get('type') || 'email' });
    if (result.error) throw authError(result.error, LINK_EXPIRED);
  } else if (query.get('code')) {
    result = await supabase.auth.exchangeCodeForSession(query.get('code'));
    if (result.error) {
      // Links sent before the switch to the implicit flow (PKCE) work only in the browser that asked for them.
      throw authError(result.error, 'Тази връзка е от по-стар вид и работи само в браузъра, от който е поискана. '
        + 'Ако потвърждаваше имейла си, той вече е потвърден: влез с паролата си. Ако искаше нова парола, поискай пак „Забравена парола?“.');
    }
  }
  // The one-time code is spent: take it out of the address bar.
  history.replaceState(null, '', location.pathname + (query.has('reset') ? '?reset=1' : ''));

  const authUser = result?.data?.user ?? await sessionUser();
  if (!authUser) throw new Error('Входът не успя. Започни отначало от страницата за вход.');
  return publicUser(await ensureUser(authUser));
}

// „Забравена парола?“: Supabase sends a link to /auth/callback/?reset=1. Resolves to { notice }.
export async function resetPassword(email) {
  const address = cleanEmail(email);
  const supabase = await client();
  const { error } = await supabase.auth.resetPasswordForEmail(address, { redirectTo: `${callbackUrl()}?reset=1` });
  if (error) throw authError(error, 'Не успяхме да изпратим писмото. Опитай пак.');
  return { notice: `Ако има профил с ${address}, изпратихме писмо с връзка за нова парола.` };
}

// On /auth/callback/?reset=1, after completeSignIn().
export async function setNewPassword(password) {
  const pass = checkNewPassword(password);
  const supabase = await client();
  const { error } = await supabase.auth.updateUser({ password: pass });
  if (error) throw authError(error, 'Не успяхме да сменим паролата. Опитай пак.');
}

// Signs out only this device ('local'): a parent signing out on the phone keeps the child's tablet signed in.
export async function signOut() {
  try { localStorage.removeItem(USER_KEY); } catch { /* nothing to clear */ }
  const supabase = await client();
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) throw authError(error, 'Не успяхме да излезем. Провери интернета и опитай пак.');
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
