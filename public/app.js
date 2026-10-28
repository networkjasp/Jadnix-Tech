/* ═══════════════════════════════════════════════
   JADNIX TECH — site script
   No inline handlers, no innerHTML with data, no
   client-side "admin". Works under a strict CSP.
═══════════════════════════════════════════════ */
'use strict';
document.documentElement.classList.add('js');

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── Nav: background on scroll, mobile menu, active link ── */
(function nav() {
  const nav = document.getElementById('nav');
  const links = document.getElementById('nav-links');
  const btn = document.getElementById('menu-btn');

  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 20);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  const setOpen = open => {
    links.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  };
  btn.addEventListener('click', () => setOpen(btn.getAttribute('aria-expanded') !== 'true'));
  links.addEventListener('click', e => { if (e.target.closest('a')) setOpen(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setOpen(false); });
  document.addEventListener('click', e => { if (!nav.contains(e.target)) setOpen(false); });

  const map = new Map([...links.querySelectorAll('a')].map(a => [a.getAttribute('href').slice(1), a]));
  const spy = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      map.forEach(a => a.classList.remove('active'));
      const a = map.get(en.target.id);
      if (a) a.classList.add('active');
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  map.forEach((_, id) => { const s = document.getElementById(id); if (s) spy.observe(s); });
})();

/* ── Reveal on scroll ── */
(function reveal() {
  const els = document.querySelectorAll('.reveal, .steps li');
  if (reduceMotion || !('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('in')); return; }
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  els.forEach((e, i) => { e.style.transitionDelay = (i % 4) * 70 + 'ms'; io.observe(e); });
})();

/* ── Pricing tabs (WAI-ARIA tabs pattern) ── */
(function tabs() {
  const list = document.querySelector('.tabs');
  if (!list) return;
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const select = tab => {
    tabs.forEach(t => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', e => {
      let n = null;
      if (e.key === 'ArrowRight') n = tabs[(i + 1) % tabs.length];
      if (e.key === 'ArrowLeft') n = tabs[(i - 1 + tabs.length) % tabs.length];
      if (e.key === 'Home') n = tabs[0];
      if (e.key === 'End') n = tabs[tabs.length - 1];
      if (n) { e.preventDefault(); select(n); n.focus(); }
    });
  });
})();

/* ── Email: assembled on click so it isn't sitting in the HTML for scrapers ── */
(function email() {
  const a = document.getElementById('email-link');
  if (!a) return;
  a.addEventListener('click', e => {
    const addr = a.dataset.u + '@' + a.dataset.d;
    if (a.getAttribute('href') === '#') {
      e.preventDefault();
      a.setAttribute('href', 'mailto:' + addr);
      document.getElementById('email-text').textContent = addr;
    }
  });
})();

document.getElementById('year').textContent = String(new Date().getFullYear());

/* ═══════════════════════════════════════════════
   PORTFOLIO — loaded from /api/portfolio (Netlify
   Function + Blobs), managed in the hidden portal.
   Everything is rendered with textContent /
   setAttribute, never innerHTML.
═══════════════════════════════════════════════ */
function safeUrl(value, { allowRelative = false } = {}) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const u = new URL(value, window.location.origin);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;          // blocks javascript:, data:, etc.
    if (!allowRelative && !/^https?:\/\//i.test(value.trim())) return null;
    if (allowRelative && u.origin !== window.location.origin && u.protocol !== 'https:') return null;
    return u.href;
  } catch { return null; }
}
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
}
function workCard(item) {
  const card = el('article', 'card work reveal in');
  const thumb = el('div', 'work-thumb');
  const link = safeUrl(item.url);
  const img = safeUrl(item.image, { allowRelative: true });
  // Only same-origin images are allowed by the CSP; host screenshots in /images.
  if (img && new URL(img).origin === window.location.origin) {
    const i = el('img');
    i.src = img; i.alt = String(item.title || 'Project screenshot'); i.loading = 'lazy'; i.decoding = 'async';
    thumb.append(i);
  } else {
    const b = el('div', 'browser');
    const bar = el('div', 'browser-bar');
    bar.append(el('i'), el('i'), el('i'), el('span', null, link ? new URL(link).host : 'project preview'));
    b.append(bar, el('div', 'browser-body', item.title || ''));
    thumb.append(b);
  }
  const body = el('div', 'work-body');
  const meta = el('div', 'work-meta');
  meta.append(el('span', 'work-tag', item.category || 'Project'));
  if (item.year) meta.append(el('span', 'mono', item.year));
  body.append(meta, el('h3', null, item.title || 'Untitled project'), el('p', null, item.description || ''));
  if (link) {
    const a = el('a', 'work-link', 'Visit site ↗');
    a.href = link; a.target = '_blank'; a.rel = 'noopener noreferrer';
    body.append(a);
  }
  card.append(thumb, body);
  return card;
}
async function loadPortfolio() {
  const grid = document.getElementById('portfolio-grid');
  const empty = document.getElementById('portfolio-empty');
  try {
    const res = await fetch('/api/portfolio', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    const items = (Array.isArray(data) ? data : data.projects || []).filter(p => p && p.visible !== false).slice(0, 48);
    grid.replaceChildren(...items.map(workCard));
    empty.hidden = items.length > 0;
  } catch {
    grid.replaceChildren();
    empty.hidden = false;
  }
}
loadPortfolio();
// The admin portal fires this after every change so the public grid refreshes live.
window.addEventListener('jadnix:portfolio-updated', loadPortfolio);

/* ── Hidden admin entry: click the © in the footer 5 times (within ~2s) ── */
(function adminTrigger() {
  const mark = document.getElementById('copy-mark');
  if (!mark) return;
  let clicks = 0, timer = 0, loading = false;
  const open = () => {
    if (window.JadnixAdmin) { window.JadnixAdmin.open(); return; }
    if (loading) return;
    loading = true;
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = 'admin.css';
    document.head.append(css);
    const s = document.createElement('script');
    s.src = 'admin.js'; s.defer = true;
    s.onload = () => { loading = false; window.JadnixAdmin && window.JadnixAdmin.open(); };
    s.onerror = () => { loading = false; };
    document.body.append(s);
  };
  mark.addEventListener('click', () => {
    clicks += 1;
    clearTimeout(timer);
    timer = setTimeout(() => { clicks = 0; }, 2000);
    if (clicks >= 5) { clicks = 0; open(); }
  });
})();

/* ═══════════════════════════════════════════════
   HERO VORTEX — streams of light spiralling into
   the Jadnix "void". Pauses off-screen / hidden tab,
   lighter on phones, static for reduced motion.
═══════════════════════════════════════════════ */
function animatedCanvas(canvas, setup, step) {
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, raf = 0, visible = true, state;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state = setup(ctx, W, H);
  };
  const loop = () => { step(ctx, W, H, state); raf = requestAnimationFrame(loop); };
  const start = () => { if (!raf && visible && !document.hidden && !reduceMotion) raf = requestAnimationFrame(loop); };
  const stop = () => { cancelAnimationFrame(raf); raf = 0; };
  resize();
  if (reduceMotion) { for (let i = 0; i < 240; i++) step(ctx, W, H, state); return; }
  let t; window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { resize(); }, 150); });
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? start() : stop(); }).observe(canvas);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  start();
}

animatedCanvas(document.getElementById('vortex'),
  (ctx, W, H) => {
    const n = W < 700 ? 520 : 1400;
    const cx = W / 2, cy = H * 0.5;
    const span = H * 0.62;
    const rMin = Math.min(W, H) * 0.05, rMax = Math.max(W * 0.42, 340);
    const P = [];
    const spawn = (p, anywhere) => {
      p.v = anywhere ? (Math.random() * 2 - 1) : (Math.random() < 0.5 ? -1 : 1) * (0.85 + Math.random() * 0.15);
      p.a = Math.random() * Math.PI * 2;
      p.s = 0.6 + Math.random() * 0.8;
      p.c = Math.random();
      p.px = null;
      return p;
    };
    for (let i = 0; i < n; i++) P.push(spawn({}, true));
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    return { P, spawn, cx, cy, span, rMin, rMax };
  },
  (ctx, W, H, S) => {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(0,0,0,0.085)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1;
    for (const p of S.P) {
      const av = Math.abs(p.v);
      const R = S.rMin + (S.rMax - S.rMin) * Math.pow(av, 1.7);
      p.a += (0.0025 + 0.03 / (0.25 + av * 4)) * p.s;          // faster near the throat
      p.v -= Math.sign(p.v) * 0.0016 * p.s * (0.4 + av);         // flow toward the void
      const x = S.cx + Math.cos(p.a) * R;
      const y = S.cy + p.v * S.span + Math.sin(p.a) * R * 0.16;
      if (av < 0.035) { S.spawn(p, false); continue; }
      if (p.px !== null) {
        const depth = (Math.sin(p.a) + 1) / 2;                    // back of funnel dimmer
        const alpha = (0.22 + 0.7 * depth) * Math.min(1, av * 3);
        ctx.strokeStyle = p.c < 0.55 ? `rgba(0,229,255,${alpha})` : p.c < 0.85 ? `rgba(47,107,255,${alpha})` : `rgba(255,255,255,${alpha * 0.8})`;
        ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(x, y); ctx.stroke();
      }
      p.px = x; p.py = y;
    }
  }
);

/* ── CTA "data rain" ── */
animatedCanvas(document.getElementById('rain'),
  (ctx, W, H) => {
    const cols = Math.floor(W / 22);
    return { d: Array.from({ length: cols }, (_, i) => ({ x: i * 22 + 11, y: Math.random() * H, v: 0.6 + Math.random() * 1.8, l: 20 + Math.random() * 70 })) };
  },
  (ctx, W, H, S) => {
    ctx.clearRect(0, 0, W, H);
    for (const d of S.d) {
      d.y += d.v; if (d.y - d.l > H) { d.y = -Math.random() * 200; }
      const g = ctx.createLinearGradient(d.x, d.y - d.l, d.x, d.y);
      g.addColorStop(0, 'rgba(0,229,255,0)'); g.addColorStop(1, 'rgba(0,229,255,0.35)');
      ctx.strokeStyle = g; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(d.x, d.y - d.l); ctx.lineTo(d.x, d.y); ctx.stroke();
    }
  }
);
