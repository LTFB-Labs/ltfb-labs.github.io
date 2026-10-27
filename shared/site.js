// Public pages of LevAcademy: header + footer, cookie banner, Google Analytics (only after consent), apps catalog.
// Every page has <meta name="la-root" content="../"> (relative path from the page to the site root, ending with "/";
// "./" on the root page). laRoot() returns it; core/ and apps use the same convention.

const CONSENT_KEY = 'la.cookieConsent'; // 'accepted' | 'declined'

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

/* ---------- header and footer ---------- */
function buildHeader() {
  const root = laRoot();
  const page = document.body.dataset.page || '';
  const current = (name) => (page === name ? ' aria-current="page"' : '');
  const header = el(`
    <header class="site-header">
      <div class="wrap">
        <a class="brand" href="${root}"><img src="${root}img/logo.svg" alt="" width="40" height="40"><span>LevAcademy</span></a>
        <nav class="site-nav" aria-label="Главно меню">
          <a href="${root}parents/"${current('parents')}>Родители</a>
          <a href="${root}apps/"${current('apps')}>Приложения</a>
          <a href="${root}login/">Вход</a>
          <a class="btn" href="${root}register/">Регистрирай се</a>
        </nav>
      </div>
    </header>`);
  const skip = el('<a class="skip-link" href="#main">Към съдържанието</a>');
  document.body.prepend(header);
  document.body.prepend(skip);
}

function buildFooter() {
  const root = laRoot();
  const footer = el(`
    <footer class="site-footer">
      <div class="wrap">
        <nav aria-label="Правна информация">
          <a href="${root}privacy/">Поверителност</a>
          <a href="${root}terms/">Условия</a>
          <button type="button" class="link-button" data-cookie-settings>Бисквитки</button>
        </nav>
        <span>© LTFB</span>
      </div>
    </footer>`);
  document.body.append(footer);
  footer.querySelector('[data-cookie-settings]').addEventListener('click', () => showBanner());
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

/* ---------- apps catalog (apps.json) ---------- */
function avatarSrc(n) {
  return `${laRoot()}avatars/${String(n).padStart(2, '0')}.webp`;
}

async function renderApps(container) {
  const status = container.querySelector('.cards-status');
  try {
    const response = await fetch(`${laRoot()}apps.json`);
    if (!response.ok) throw new Error(String(response.status));
    const apps = await response.json();
    const root = laRoot();
    const nodes = apps.map((app) => {
      const card = document.createElement('a');
      card.className = 'card';
      card.href = `${root}${app.path}`;
      const img = document.createElement('img');
      img.src = avatarSrc(app.avatar);
      img.alt = '';
      img.width = 72;
      img.height = 72;
      img.loading = 'lazy';
      const body = document.createElement('div');
      const title = document.createElement('h3');
      title.textContent = app.name;
      const about = document.createElement('p');
      about.textContent = app.about;
      body.append(title, about);
      if (app.grades) {
        const grades = document.createElement('span');
        grades.className = 'grades';
        grades.textContent = app.grades;
        body.append(grades);
      }
      card.append(img, body);
      return card;
    });
    container.replaceChildren(...nodes);
  } catch {
    if (status) status.textContent = 'Списъкът с приложения не се зареди. Опитай пак по-късно.';
  }
}

/* ---------- start ---------- */
buildHeader();
buildFooter();
document.querySelectorAll('[data-apps]').forEach(renderApps);
const consent = readConsent();
if (consent === 'accepted') loadAnalytics();
else if (consent !== 'declined') showBanner();
