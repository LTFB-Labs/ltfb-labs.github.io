// /login/ and /register/: <body data-mode="login|register">. Accepts ?invite=TOKEN on both.
// One e-mail form for both providers; Google/Facebook and „Забравена парола?“ only with the cloud provider.
import { config } from './config.js';
import { store } from './store.js';
import { finishSignIn, rememberInvite, showError } from './ui.js';

const mode = document.body.dataset.mode;
const invite = new URLSearchParams(location.search).get('invite');
const error = document.getElementById('error');
const notice = document.getElementById('notice');
const form = document.getElementById('sign-in-form');
const cloud = store.provider === 'cloud';

if (invite) {
  rememberInvite(invite);
  document.getElementById('invite-note').hidden = false;
  document.querySelector('.core-lead').hidden = true;
  const other = document.getElementById('other-link');
  other.href += `?invite=${encodeURIComponent(invite)}`;
}

function say(message) {
  showError(error, null);
  showError(notice, message);
}

function fail(message) {
  showError(notice, null);
  showError(error, message);
}

// A user means signed in: accept a remembered invite and open /app/. { notice } means "not yet" (e.g. confirm the e-mail).
async function afterSignIn(result) {
  if (result?.notice) {
    say(result.notice);
    return;
  }
  fail(await finishSignIn(store));
}

async function start() {
  if (await store.currentUser()) {
    fail(await finishSignIn(store));
    return;
  }

  form.hidden = false;
  document.getElementById('local-note').hidden = cloud;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    try {
      await afterSignIn(await store.signIn({
        mode, email: data.get('email'), password: data.get('password'), displayName: data.get('displayName'),
      }));
    } catch (e) {
      fail(e.message);
    }
  });

  if (!cloud) return;

  // Only the providers switched on in Supabase (config.socialProviders) get a button.
  const providers = config.socialProviders || [];
  document.getElementById('social-box').hidden = providers.length === 0;
  for (const button of document.querySelectorAll('[data-provider]')) {
    button.hidden = !providers.includes(button.dataset.provider);
    button.addEventListener('click', () => {
      store.signIn({ provider: button.dataset.provider }).then(afterSignIn).catch((e) => fail(e.message));
    });
  }

  const forgot = document.getElementById('forgot-button');
  if (forgot) {
    forgot.hidden = false;
    forgot.addEventListener('click', async () => {
      const email = String(new FormData(form).get('email') || '').trim();
      if (!email) {
        fail('Напиши имейла си горе и натисни пак „Забравена парола?“.');
        return;
      }
      try {
        say((await store.resetPassword(email)).notice);
      } catch (e) {
        fail(e.message);
      }
    });
  }
}

start().catch((e) => fail(e.message));
