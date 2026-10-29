// Public pages of LevAcademy: cookie banner and Google Analytics (only after consent).
// The text, header, footer and apps catalog are in the HTML itself, for search engines (decisions/0008);
// this script only adds on top. The catalog is written by build-catalog.mjs when publishing.
// Every page has <meta name="la-root" content="../"> (relative path from the page to the site root, ending with "/";
// "./" on the root page). laRoot() returns it; core/ and apps use the same convention.

const CONSENT_KEY = 'la.cookieConsent'; // 'accepted' | 'declined'

// Inside the shell (/app/, no app open) the home page is shown under the shell's bar: ?embed=shell.
// A script in the page's <head> sets the class "embedded" before the first paint; then the CSS hides the header and
// footer, and there is no cookie banner or analytics.
const EMBEDDED = document.documentElement.classList.contains('embedded');

export function laRoot() {
  const meta = document.querySelector('meta[name="la-root"]');
  const value = meta ? meta.getAttribute('content') : './';
  return value && value.endsWith('/') ? value : (value || '.') + '/';
}
window.laRoot = laRoot;

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function readConsent() {
  try { return localStorage.getItem(CONSENT_KEY); } catch { return null; }
}
function writeConsent(value) {
  try { localStorage.setItem(CONSENT_KEY, value); } catch { /* private mode: the choice just isn't remembered */ }
}

/* ---------- cookie banner ---------- */
function showBanner() {
  if (document.querySelector('.cookie-banner')) return;
  const root = laRoot();
  const banner = el(`
    <div class="cookie-banner" role="dialog" aria-labelledby="cookie-title" aria-describedby="cookie-text">
      <p id="cookie-title"><strong>Бисквитки</strong></p>
      <p id="cookie-text">Ако ни позволиш, ще пускаме Google Analytics само на тези публични страници, за да виждаме колко души ги посещават. Не го пускаме във входа, в профила на детето и в приложенията. Повече: <a href="${root}privacy/">Поверителност</a>.</p>
      <div class="actions">
        <button type="button" class="btn btn-small" data-consent="accepted">Приемам</button>
        <button type="button" class="btn btn-secondary btn-small" data-consent="declined">Отказвам</button>
      </div>
    </div>`);
  banner.addEventListener('click', (event) => {
    const choice = event.target.closest('[data-consent]')?.dataset.consent;
    if (!choice) return;
    writeConsent(choice);
    banner.remove();
    if (choice === 'accepted') loadAnalytics();
  });
  document.body.append(banner);
}

/* ---------- Google Analytics (public pages only, only after "Приемам") ---------- */
let analyticsLoaded = false;
async function loadAnalytics() {
  if (analyticsLoaded) return;
  let id = '';
  try {
    // core/config.js may not exist yet: then nothing is loaded.
    const { config } = await import(new URL(`${laRoot()}core/config.js`, document.baseURI).href);
    id = config?.gaMeasurementId || '';
  } catch { return; }
  if (!/^G-[A-Z0-9]+$/.test(id)) return;
  analyticsLoaded = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', id);
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
  document.head.append(script);
}

/* ---------- start ---------- */
if (EMBEDDED) {
  // Links to other pages of the site open in the whole window, not inside the shell.
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (link && !link.target) link.target = '_top';
  });
} else {
  // Without JS the button would do nothing, so it is hidden in the HTML.
  document.querySelectorAll('[data-cookie-settings]').forEach((button) => {
    button.hidden = false;
    button.addEventListener('click', () => showBanner());
  });
  const consent = readConsent();
  if (consent === 'accepted') loadAnalytics();
  else if (consent !== 'declined') showBanner();
}
