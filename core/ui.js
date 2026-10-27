// Small helpers shared by the core pages (/login/, /register/, /auth/callback/, /app/).

const PENDING_INVITE_KEY = 'la.pendingInvite';

// Path from the current page to the site root, from <meta name="la-root" content="../">.
export function laRoot() {
  return document.querySelector('meta[name="la-root"]')?.content || './';
}

export function goTo(path) {
  location.assign(laRoot() + path);
}

export function rememberInvite(token) {
  if (token) localStorage.setItem(PENDING_INVITE_KEY, token);
}

// After any sign-in: accept a remembered invite, then open /app/.
// Returns an error message (and stays on the page) if the invite could not be accepted.
export async function finishSignIn(store) {
  const token = localStorage.getItem(PENDING_INVITE_KEY);
  if (token) {
    localStorage.removeItem(PENDING_INVITE_KEY);
    try {
      await store.acceptInvite(token);
    } catch (error) {
      return error.message;
    }
  }
  goTo('app/');
  return null;
}

export function showError(element, message) {
  element.textContent = message || '';
  element.hidden = !message;
}
