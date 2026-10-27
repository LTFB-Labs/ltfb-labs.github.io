// Sign-in with Amazon Cognito managed login: OAuth2 authorization code + PKCE, from a static site
// (public app client, no client secret). Tokens stay in localStorage so the parent stays signed in;
// the access token is refreshed with the refresh token when it is about to expire.
//
// Cognito app client must have: no secret, "Authorization code grant", scopes openid + email + profile,
// callback URL  <site root>auth/callback/  and sign-out URL  <site root>  (exactly, with the trailing slash).

const TOKENS_KEY = 'la.cognito.tokens';
const PKCE_KEY = 'la.cognito.pkce';
const EXPIRY_MARGIN_MS = 60_000;

let settings = null;   // { domain, clientId, siteRoot }
let refreshing = null;

export function initCognito({ domain, clientId, siteRoot }) {
  const host = String(domain).replace(/^https?:\/\//, '').replace(/\/+$/, '');
  settings = { base: `https://${host}`, clientId, siteRoot };
}

function redirectUri() {
  return `${settings.siteRoot}auth/callback/`;
}

function base64Url(bytes) {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(size = 32) {
  return base64Url(crypto.getRandomValues(new Uint8Array(size)));
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

function decodeJwt(token) {
  const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(part), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function readTokens() {
  try { return JSON.parse(localStorage.getItem(TOKENS_KEY) || 'null'); } catch { return null; }
}

function writeTokens(response, previousRefreshToken) {
  const tokens = {
    idToken: response.id_token,
    accessToken: response.access_token,
    // Cognito does not send a new refresh token on refresh (unless rotation is on): keep the old one.
    refreshToken: response.refresh_token || previousRefreshToken,
    expiresAt: Date.now() + Number(response.expires_in || 3600) * 1000,
  };
  localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
  return tokens;
}

async function tokenRequest(params) {
  const response = await fetch(`${settings.base}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: settings.clientId, ...params }),
  });
  if (!response.ok) throw new Error('Входът не успя. Опитай пак.');
  return response.json();
}

// Sends the browser to the managed login page. mode 'register' opens the sign-up form.
export async function redirectToLogin(mode = 'login') {
  const verifier = randomString(48);
  const state = randomString(16);
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: settings.clientId,
    redirect_uri: redirectUri(),
    scope: 'openid email profile',
    state,
    code_challenge: base64Url(await sha256(verifier)),
    code_challenge_method: 'S256',
  });
  const path = mode === 'register' ? '/signup' : '/oauth2/authorize';
  location.assign(`${settings.base}${path}?${query}`);
}

// On /auth/callback/: trade the ?code= for tokens. Returns the tokens.
export async function handleCallback() {
  const params = new URLSearchParams(location.search);
  if (params.get('error')) throw new Error('Входът беше прекъснат. Опитай пак.');
  const code = params.get('code');
  const saved = JSON.parse(sessionStorage.getItem(PKCE_KEY) || 'null');
  sessionStorage.removeItem(PKCE_KEY);
  if (!code || !saved || saved.state !== params.get('state')) {
    throw new Error('Входът не успя. Започни отначало от страницата за вход.');
  }
  const response = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    code_verifier: saved.verifier,
  });
  return writeTokens(response);
}

// A valid access token, refreshed when needed; null when signed out or the refresh failed.
export async function accessToken() {
  const tokens = readTokens();
  if (!tokens) return null;
  if (tokens.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return tokens.accessToken;
  if (!tokens.refreshToken) return null;
  refreshing ??= tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken })
    .then((response) => writeTokens(response, tokens.refreshToken).accessToken)
    .catch(() => {
      localStorage.removeItem(TOKENS_KEY);
      return null;
    })
    .finally(() => { refreshing = null; });
  return refreshing;
}

// Who is signed in, from the ID token: { sub, email, name } or null.
export async function profile() {
  if (!(await accessToken())) return null;
  const claims = decodeJwt(readTokens().idToken);
  return {
    sub: claims.sub,
    email: claims.email || '',
    name: claims.name || claims.given_name || (claims.email || '').split('@')[0],
  };
}

export function signOutRedirect() {
  localStorage.removeItem(TOKENS_KEY);
  const query = new URLSearchParams({ client_id: settings.clientId, logout_uri: settings.siteRoot });
  location.assign(`${settings.base}/logout?${query}`);
}
