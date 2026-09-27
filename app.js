// Seafood catalog PoC: static page, data from data/products.csv, photos from photos/ (thumbnails in photos/thumb/).
const CONFIG = {
  // SHA-256 of the demo password. Client-side check only: keeps bots out, not a security boundary.
  passHash: 'bd9ffa2e28a1bb0aae0c20f03ba0d15329df8b93d0e16c79a90010acef78f4ee',
  videoUrl: 'https://videos.pexels.com/video-files/6952922/6952922-hd_1366_720_25fps.mp4', // Pexels, cottonbro studio
  idleMs: 60000,           // return to home screen after inactivity
  categories: ['Устриці', 'Креветки', 'Мідії', 'Краби та лобстери', 'Восьминіг'],
  headlineMs: 7000,
  headlines: [
    { h: 'Не знаєте, що обрати? Підкажемо', p: 'Ціна, опис і рецепт до кожного морепродукту з цієї вітрини' },
    { h: 'Чим устриця №2 відрізняється від №4?', p: 'Дізнайтеся за один дотик: ціни, походження та рецепти всього, що на вітрині' },
  ],
};
let heroTimer;

let products = [];
const app = document.getElementById('app');

// ---------- helpers ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n.toLocaleString('uk-UA', { maximumFractionDigits: 2 });

function track(name) {
  // GoatCounter event; no personal data, only the event name
  try { window.goatcounter?.count?.({ path: name, event: true }); } catch (e) { /* analytics is optional */ }
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(v => v !== '')) rows.push(row);
  const [head, ...body] = rows;
  return body.map(r => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

function normalize(p) {
  const price = parseFloat(String(p.price).replace(',', '.')) || 0;
  const pct = parseFloat(p.promo_pct) || 0;
  const expired = p.promo_until && new Date(p.promo_until + 'T23:59:59') < new Date();
  const promo = pct > 0 && !expired ? pct : 0;
  return { ...p, price, promo, promoPrice: promo ? Math.round(price * (1 - promo / 100) * 100) / 100 : price, sort: +p.sort || 0 };
}

const dateWords = d => new Date(d).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });
const thumb = p => p.photo.replace(/^photos\//, 'photos/thumb/');

// Price: paper tag stuck in ice, like at a fish counter
function priceHtml(p) {
  const per = esc(String(p.unit).replace(/^грн\//, 'за '));
  return `<div class="tag${p.promo ? ' is-promo' : ''}"><span class="tag-hole"></span>
    ${p.promo ? `<span class="tag-old">${fmt(p.price)}</span>` : ''}
    <span class="tag-price">${fmt(p.promoPrice)}<small> грн</small></span>
    <span class="tag-unit">${per}</span>
    ${p.promo ? `<span class="tag-promo">−${p.promo}%${p.promo_until ? ` до ${dateWords(p.promo_until)}` : ''}</span>` : ''}</div>`;
}

// Likes: counted on this device (the counter tablet); one like per product per customer visit.
// A visit ends when the screen returns home after idle. Each like is also sent to GoatCounter.
const LIKES_KEY = 'seafood-likes';
let likedThisVisit = new Set();
function loadLikes() { try { return JSON.parse(localStorage.getItem(LIKES_KEY)) || {}; } catch (e) { return {}; } }
function saveLikes(l) { try { localStorage.setItem(LIKES_KEY, JSON.stringify(l)); } catch (e) { /* storage may be blocked */ } }
const HEART = '<svg class="heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.8 4.5c2.1 0 3.6 1.1 5.2 3 1.6-1.9 3.1-3 5.2-3 3.8 0 5.9 3.8 4.4 7.2C19.5 16.4 12 21 12 21z"/></svg>';
function likeHtml(p, big) {
  const n = loadLikes()[p.id] || 0;
  const on = likedThisVisit.has(p.id);
  // zero is not shown: an empty heart on a card, "Подобається" on the product page
  const label = n ? `<span class="like-n">${n}</span>` : (big ? '<span class="like-n">Подобається</span>' : '');
  return `<button class="like${big ? ' big' : ''}${on ? ' on' : ''}${n ? '' : ' zero'}" data-like="${esc(p.id)}" aria-pressed="${on}" aria-label="Подобається${n ? ', ' + n : ''}">${HEART}${label}</button>`;
}
function toggleLike(id) {
  const likes = loadLikes();
  if (likedThisVisit.has(id)) { likedThisVisit.delete(id); likes[id] = Math.max(0, (likes[id] || 0) - 1); track('unlike-' + id); }
  else { likedThisVisit.add(id); likes[id] = (likes[id] || 0) + 1; track('like-' + id); }
  try { navigator.vibrate?.(10); } catch (e) { /* not supported */ }
  saveLikes(likes);
  const p = products.find(x => x.id === id);
  document.querySelectorAll(`[data-like="${CSS.escape(id)}"]`).forEach(b => {
    b.outerHTML = likeHtml(p, b.classList.contains('big'));
  });
  document.querySelectorAll(`[data-like="${CSS.escape(id)}"]`).forEach(b => b.classList.add('bump'));
}

const byCat = cat => products.filter(p => p.category === cat).sort((a, b) => a.sort - b.sort);

// ---------- views ----------
function viewHome() {
  // no 7 MB video on phones or with data saver: the poster photo stays as background
  const light = matchMedia('(max-width: 760px)').matches || navigator.connection?.saveData;
  const video = CONFIG.videoUrl && !light
    ? `<video src="${esc(CONFIG.videoUrl)}" poster="photos/103.jpg" autoplay muted loop playsinline></video>` : '';
  return `
  <a class="home" href="#/catalog">
    ${video}
    <div class="home-inner">
      <div class="home-hero">${CONFIG.headlines.map((x, i) => `
        <div class="slide${i === 0 ? ' on' : ''}"><h1>${esc(x.h)}</h1><p>${esc(x.p)}</p></div>`).join('')}
      </div>
      <div class="home-hint"><span class="hint-dot"></span>Торкніться екрана, щоб відкрити каталог</div>
    </div>
  </a>`;
}

function startHeadlines() {
  let i = 0;
  heroTimer = setInterval(() => {
    const slides = document.querySelectorAll('.home-hero .slide');
    if (!slides.length) return;
    slides[i].classList.remove('on');
    i = (i + 1) % slides.length;
    slides[i].classList.add('on');
  }, CONFIG.headlineMs);
}

function topbar(title, back) {
  const backLink = back && back !== '#/' ? `<a class="btn-back" href="${back}">← Назад</a>` : '';
  return `<header class="topbar">${backLink}<h2>${esc(title)}</h2>
    <a class="btn-home" href="#/" aria-label="На головну">⌂ <span>На головну</span></a></header>`;
}

function viewCatalog() {
  return topbar('Каталог', '#/') + `<div class="grid">${CONFIG.categories.map(cat => {
    const items = byCat(cat);
    if (!items.length) return '';
    return `<a class="tile" href="#/c/${encodeURIComponent(cat)}">
      <img src="${esc(thumb(items[0]))}" alt="" width="600" height="450">
      <span>${esc(cat)}</span></a>`;
  }).join('')}</div>`;
}

function viewCategory(cat) {
  return topbar(cat, '#/catalog') + `
  <section class="cat">
  <div class="rail-wrap">
    <button class="rail-arrow prev" data-rail="-1" aria-label="Назад">‹</button>
    <div class="rail" id="rail">${byCat(cat).map(p => `
      <div class="card">
        <img src="${esc(thumb(p))}" alt="" loading="lazy" width="600" height="450">${likeHtml(p)}
        <div class="card-body">${priceHtml(p)}<a class="card-name" href="#/p/${esc(p.id)}">${esc(p.name)}</a></div>
      </div>`).join('')}</div>
    <button class="rail-arrow next" data-rail="1" aria-label="Далі">›</button>
  </div>
  <div class="rail-foot"><div class="dots" id="dots"></div><span class="rail-count" id="rail-count"></span></div>
  </section>`;
}

// Paging state for the product rail: which cards are visible, dots, arrows, counter
function updateRail() {
  const rail = document.getElementById('rail');
  if (!rail) return;
  const cards = rail.children, total = cards.length;
  const step = cards.length > 1 ? cards[1].offsetLeft - cards[0].offsetLeft : rail.clientWidth;
  const perPage = Math.max(1, Math.round((rail.clientWidth + 16) / step));
  const pages = Math.ceil(total / perPage);
  const first = Math.min(total - 1, Math.round(rail.scrollLeft / step));
  const page = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 4 ? pages - 1 : Math.floor(first / perPage);
  const last = Math.min(total, first + perPage);
  const atEnd = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 4;
  document.querySelector('.rail-arrow.prev').disabled = rail.scrollLeft <= 4;
  document.querySelector('.rail-arrow.next').disabled = atEnd;
  document.getElementById('rail-count').textContent = pages > 1 ? `${first + 1}–${last} з ${total}` : '';
  document.getElementById('dots').innerHTML = pages > 1
    ? Array.from({ length: pages }, (_, i) => `<button class="dot${i === page ? ' on' : ''}" data-page="${i}" aria-label="Сторінка ${i + 1}"></button>`).join('') : '';
  rail.dataset.perPage = perPage;
}

function scrollRail(dir, toPage) {
  const rail = document.getElementById('rail');
  const step = rail.children.length > 1 ? rail.children[1].offsetLeft - rail.children[0].offsetLeft : rail.clientWidth;
  const perPage = +rail.dataset.perPage || 4;
  const left = toPage != null ? toPage * perPage * step : rail.scrollLeft + dir * perPage * step;
  rail.scrollTo({ left, behavior: 'smooth' });
}

function viewProduct(id) {
  const p = products.find(x => x.id === id);
  if (!p) return viewCatalog();
  const steps = (p.recipe_text || '').split('|').map(s => s.trim()).filter(Boolean);
  return topbar(p.category, `#/c/${encodeURIComponent(p.category)}`) + `
  <article class="product">
    <div><div class="product-photo"><img src="${esc(p.photo)}" alt="${esc(p.name)}" width="1200" height="900">${likeHtml(p, true)}</div>${p.photo_credit ? `<p class="credit">${esc(p.photo_credit)}</p>` : ''}</div>
    <div>
      <h1>${esc(p.name)}</h1>
      ${p.origin ? `<p class="origin">Походження: ${p.origin_code
        ? `<img class="flag" src="flags/${esc(p.origin_code)}.svg" alt="">` : ''}<span class="country">${esc(p.origin)}</span></p>` : ''}
      ${priceHtml(p)}
      <p class="desc">${esc(p.description)}</p>
      ${steps.length ? `
      <button class="btn-recipe" data-toggle="recipe">Ідея рецепту</button>
      <div class="recipe" id="recipe" hidden>
        <h3>${esc(p.recipe_title)}</h3>
        <ol>${steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      </div>` : ''}
    </div>
  </article>`;
}

// ---------- routing ----------
function render() {
  clearInterval(heroTimer);
  const [, route, arg] = (location.hash || '#/').split('/');
  const a = decodeURIComponent(arg || '');
  if (route === 'catalog') app.innerHTML = viewCatalog();
  else if (route === 'c') app.innerHTML = viewCategory(a);
  else if (route === 'p') { app.innerHTML = viewProduct(a); track('product-' + a); }
  else { app.innerHTML = viewHome(); startHeadlines(); }
  window.scrollTo(0, 0);
  const rail = document.getElementById('rail');
  if (rail) { rail.addEventListener('scroll', () => requestAnimationFrame(updateRail), { passive: true }); updateRail(); }
  document.querySelectorAll('.flag').forEach(img => img.addEventListener('error', () => img.remove()));
}
window.addEventListener('resize', () => updateRail());

app.addEventListener('click', e => {
  const like = e.target.closest('[data-like]');
  if (like) { toggleLike(like.dataset.like); return; }
  const arrow = e.target.closest('[data-rail]');
  if (arrow) { scrollRail(+arrow.dataset.rail); return; }
  const dot = e.target.closest('[data-page]');
  if (dot) { scrollRail(0, +dot.dataset.page); return; }
  const t = e.target.closest('[data-toggle]');
  if (t) {
    const el = document.getElementById(t.dataset.toggle);
    el.hidden = !el.hidden;
    t.textContent = el.hidden ? 'Ідея рецепту' : 'Сховати рецепт';
    if (!el.hidden) track('recipe-' + location.hash.split('/')[2]);
  }
});

let idleTimer;
function resetIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    likedThisVisit = new Set(); // next customer may like again
    if (location.hash && location.hash !== '#/') location.hash = '#/';
  }, CONFIG.idleMs);
}
['click', 'touchstart', 'scroll', 'keydown'].forEach(ev => window.addEventListener(ev, resetIdle, { passive: true }));

// ---------- start ----------
async function start() {
  const res = await fetch('data/products.csv', { cache: 'no-cache' });
  products = parseCsv(await res.text()).map(normalize);
  document.getElementById('gate').hidden = true;
  app.hidden = false;
  window.addEventListener('hashchange', render);
  render();
  resetIdle();
}

document.getElementById('gate-form').addEventListener('submit', async e => {
  e.preventDefault();
  const ok = (await sha256(document.getElementById('gate-pass').value.trim())) === CONFIG.passHash;
  document.getElementById('gate-error').hidden = ok;
  if (!ok) return;
  try { sessionStorage.setItem('seafood-ok', '1'); } catch (err) { /* storage may be blocked */ }
  track('login');
  start();
});

let unlocked = false;
try { unlocked = sessionStorage.getItem('seafood-ok') === '1'; } catch (err) { /* ignore */ }
if (unlocked) start();
