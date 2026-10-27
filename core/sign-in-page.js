// /login/ and /register/: <body data-mode="login|register">. Accepts ?invite=TOKEN on both.
import { store } from './store.js';
import { finishSignIn, rememberInvite, showError } from './ui.js';

const mode = document.body.dataset.mode;
const invite = new URLSearchParams(location.search).get('invite');
const error = document.getElementById('error');

if (invite) {
  rememberInvite(invite);
  document.getElementById('invite-note').hidden = false;
  document.querySelector('.core-lead').hidden = true;
  const other = document.getElementById('other-link');
  other.href += `?invite=${encodeURIComponent(invite)}`;
}

async function start() {
  if (await store.currentUser()) {
    showError(error, await finishSignIn(store));
    return;
  }
  if (store.provider === 'local') {
    const form = document.getElementById('local-form');
    form.hidden = false;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      try {
        await store.signIn({ mode, email: data.get('email'), displayName: data.get('displayName') });
        showError(error, await finishSignIn(store));
      } catch (e) {
        showError(error, e.message);
      }
    });
  } else {
    const box = document.getElementById('cloud-box');
    box.hidden = false;
    document.getElementById('cloud-button').addEventListener('click', () => {
      store.signIn({ mode }).catch((e) => showError(error, e.message));
    });
  }
}

start().catch((e) => showError(error, e.message));
