/* ═══════════════════════════════════════════════
   JADNIX TECH — Portfolio manager (admin portal)
   Loaded only after 5 clicks on the footer ©.
   This file holds NO credentials: every request is
   checked by the server (/api/admin/*), which holds
   the hashed password and issues an HttpOnly cookie.
═══════════════════════════════════════════════ */
'use strict';
(function () {
  const CATEGORIES = ['Web', 'Redesign', 'E-commerce', 'Web App', 'Software', 'CRM', 'Dashboard', 'Other'];
  const MAX_SIDE = 1600;

  /* ── tiny DOM helper (no innerHTML anywhere) ── */
  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return n;
  }

  /* ── API ── */
  async function api(path, { method = 'GET', json, form } = {}) {
    const headers = { 'X-Jadnix-Admin': '1' };
    let body;
    if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
    if (form) body = form;
    let res;
    try { res = await fetch(path, { method, headers, body, credentials: 'same-origin', cache: 'no-store' }); }
    catch { throw Object.assign(new Error('Network error — check your connection.'), { status: 0 }); }
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status}).`), { status: res.status });
    return data;
  }

  /* ── Image: resize in the browser before upload (keeps uploads small & strips metadata) ── */
  async function prepareImage(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Please choose a JPG, PNG or WEBP image.');
    if (file.size > 15 * 1024 * 1024) throw new Error('That image is over 15 MB.');
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), hgt = Math.round(bmp.height * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = hgt;
    const ctx = c.getContext('2d');
    const toBlob = (type, q) => new Promise(r => c.toBlob(r, type, q));
    ctx.drawImage(bmp, 0, 0, w, hgt);
    let blob = await toBlob('image/webp', 0.86);
    if (!blob || blob.type !== 'image/webp') {               // older Safari: fall back to JPEG on a dark background
      ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#0a0c0f'; ctx.fillRect(0, 0, w, hgt);
      blob = await toBlob('image/jpeg', 0.86);
    }
    if (!blob) throw new Error('Could not process that image.');
    if (blob.size > 3 * 1024 * 1024) throw new Error('Image is still over 3 MB after resizing — try a smaller one.');
    return blob;
  }

  /* ═════════ UI ═════════ */
  let dlg, view, user = null, items = [], editing = null, pendingImage = null, removeImage = false;

  function notifySite() { window.dispatchEvent(new CustomEvent('jadnix:portfolio-updated')); }

  function build() {
    view = h('div', { class: 'adm-view' });
    dlg = h('dialog', { class: 'adm', 'aria-label': 'Portfolio manager' }, view);
    dlg.addEventListener('click', e => { if (e.target === dlg && !user) dlg.close(); });
    document.body.append(dlg);
  }

  function status(el, msg, kind = 'info') { el.textContent = msg; el.dataset.kind = kind; }

  /* ── Login ── */
  function renderLogin(message) {
    const msg = h('p', { class: 'adm-msg', role: 'alert', 'aria-live': 'assertive' });
    const u = h('input', { id: 'adm-user', name: 'username', autocomplete: 'username', required: true, maxlength: 100, autocapitalize: 'none', spellcheck: 'false' });
    const p = h('input', { id: 'adm-pass', name: 'password', type: 'password', autocomplete: 'current-password', required: true, maxlength: 200 });
    const btn = h('button', { class: 'btn btn-solid full', type: 'submit', text: 'Sign in' });
    const form = h('form', { class: 'adm-login', onsubmit: async e => {
      e.preventDefault();
      btn.disabled = true; status(msg, 'Checking…');
      try {
        const r = await api('/api/admin/login', { method: 'POST', json: { username: u.value, password: p.value } });
        user = r.user; p.value = '';
        await renderManager();
      } catch (err) {
        status(msg, err.message, 'error'); p.value = ''; p.focus();
      } finally { btn.disabled = false; }
    } },
      h('div', { class: 'adm-login-head' },
        h('p', { class: 'mono', text: 'RESTRICTED' }),
        h('h2', { text: 'Portfolio manager' }),
        h('p', { class: 'sub', text: 'Sign in to add, edit or remove portfolio projects.' })),
      h('div', { class: 'fld' }, h('label', { for: 'adm-user', text: 'Username' }), u),
      h('div', { class: 'fld' }, h('label', { for: 'adm-pass', text: 'Password' }), p),
      msg, btn,
      h('button', { class: 'adm-link', type: 'button', text: 'Cancel', onclick: () => dlg.close() }));
    view.replaceChildren(form);
    if (message) status(msg, message, 'error');
    setTimeout(() => u.focus(), 30);
  }

  /* ── Manager ── */
  async function renderManager() {
    const list = h('div', { class: 'adm-list', 'aria-live': 'polite' });
    const listMsg = h('p', { class: 'adm-msg' });
    const count = h('span', { class: 'mono' });

    const header = h('header', { class: 'adm-head' },
      h('div', {}, h('p', { class: 'mono', text: 'JADNIX TECH · ADMIN' }), h('h2', { text: 'Portfolio manager' })),
      h('div', { class: 'adm-head-actions' },
        h('span', { class: 'adm-user' }, h('span', { class: 'dot' }), ` ${user}`),
        h('a', { class: 'btn btn-ghost sm', href: '/#work', target: '_self', text: 'View site', onclick: () => dlg.close() }),
        h('button', { class: 'btn btn-ghost sm', type: 'button', text: 'Log out', onclick: logout }),
        h('button', { class: 'adm-x', type: 'button', 'aria-label': 'Close', text: '✕', onclick: () => dlg.close() })));

    const formPanel = buildForm(async () => { await refresh(); });
    const listPanel = h('section', { class: 'adm-panel' },
      h('div', { class: 'adm-panel-head' }, h('h3', { text: 'Projects' }), count),
      h('p', { class: 'sub', text: 'Top of the list shows first on the site. Hidden projects stay saved but aren’t shown publicly.' }),
      listMsg, list);

    view.replaceChildren(header, h('div', { class: 'adm-body' }, formPanel.el, listPanel));

    async function refresh(data) {
      try {
        if (!data) data = await api('/api/admin/portfolio');
        items = data.projects || [];
        count.textContent = `${items.length} item${items.length === 1 ? '' : 's'} · ${items.filter(i => i.visible).length} visible`;
        list.replaceChildren(...(items.length ? items.map((it, i) => row(it, i)) : [h('p', { class: 'adm-empty', text: 'No projects yet — add your first one.' })]));
      } catch (err) { handle(err, listMsg); }
    }

    function row(it, i) {
      let armed = false;
      const del = h('button', { class: 'adm-btn danger', type: 'button', text: 'Delete', onclick: async () => {
        if (!armed) { armed = true; del.textContent = 'Confirm delete'; setTimeout(() => { armed = false; del.textContent = 'Delete'; }, 3500); return; }
        await act(() => api('/api/admin/portfolio', { method: 'DELETE', json: { id: it.id } }), 'Project deleted.');
        if (editing && editing.id === it.id) formPanel.reset();
      } });
      const thumb = it.image
        ? h('img', { src: it.image, alt: '', loading: 'lazy' })
        : h('span', { class: 'adm-noimg', text: (it.title || '?').slice(0, 1).toUpperCase() });
      return h('article', { class: 'adm-item' + (it.visible ? '' : ' is-hidden') },
        h('div', { class: 'adm-thumb' }, thumb),
        h('div', { class: 'adm-info' },
          h('p', { class: 'adm-title', text: it.title }),
          h('p', { class: 'mono', text: [it.category, it.year].filter(Boolean).join(' · ') }),
          it.url ? h('p', { class: 'adm-url', text: it.url }) : null,
          h('span', { class: 'adm-badge' + (it.visible ? ' on' : ''), text: it.visible ? 'Visible' : 'Hidden' })),
        h('div', { class: 'adm-actions' },
          h('button', { class: 'adm-btn', type: 'button', 'aria-label': `Move ${it.title} up`, text: '↑', disabled: i === 0,
            onclick: () => act(() => api('/api/admin/portfolio', { method: 'PATCH', json: { id: it.id, action: 'up' } })) }),
          h('button', { class: 'adm-btn', type: 'button', 'aria-label': `Move ${it.title} down`, text: '↓', disabled: i === items.length - 1,
            onclick: () => act(() => api('/api/admin/portfolio', { method: 'PATCH', json: { id: it.id, action: 'down' } })) }),
          h('button', { class: 'adm-btn', type: 'button', text: 'Edit', onclick: () => formPanel.edit(it) }),
          h('button', { class: 'adm-btn', type: 'button', text: it.visible ? 'Hide' : 'Show',
            onclick: () => act(() => api('/api/admin/portfolio', { method: 'PATCH', json: { id: it.id, action: 'toggle' } }), it.visible ? 'Project hidden.' : 'Project is now visible.') }),
          del));
    }

    async function act(fn, ok) {
      try { const data = await fn(); await refresh(data); notifySite(); if (ok) status(listMsg, ok, 'ok'); }
      catch (err) { handle(err, listMsg); }
    }
    formPanel.onSaved = async data => { await refresh(data); notifySite(); };
    await refresh();
  }

  function buildForm() {
    const msg = h('p', { class: 'adm-msg', 'aria-live': 'polite' });
    const f = {
      title: h('input', { id: 'af-title', name: 'title', required: true, maxlength: 120, placeholder: 'e.g. Corporate website redesign' }),
      category: h('select', { id: 'af-cat', name: 'category' }, CATEGORIES.map(c => h('option', { value: c, text: c }))),
      year: h('input', { id: 'af-year', name: 'year', maxlength: 10, inputmode: 'numeric', placeholder: String(new Date().getFullYear()) }),
      url: h('input', { id: 'af-url', name: 'url', type: 'url', maxlength: 500, placeholder: 'https://client-site.co.za' }),
      description: h('textarea', { id: 'af-desc', name: 'description', rows: 4, maxlength: 600, placeholder: 'What you built and the result for the client.' }),
      visible: h('input', { id: 'af-vis', name: 'visible', type: 'checkbox', checked: true }),
    };
    const counter = h('span', { class: 'mono adm-count', text: '0 / 600' });
    f.description.addEventListener('input', () => { counter.textContent = `${f.description.value.length} / 600`; });

    const preview = h('img', { class: 'adm-preview', alt: 'Selected image preview', hidden: true });
    const file = h('input', { id: 'af-img', type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'adm-file' });
    const clearImg = h('button', { class: 'adm-btn danger', type: 'button', text: 'Remove image', hidden: true });
    const drop = h('label', { class: 'adm-drop', for: 'af-img' },
      h('span', { text: 'Drop a screenshot here or click to browse' }),
      h('span', { class: 'sub', text: 'JPG, PNG or WEBP · resized automatically' }), file);

    let objectUrl = null;
    const showPreview = src => { preview.src = src; preview.hidden = !src; clearImg.hidden = !src; };
    async function pick(fl) {
      if (!fl) return;
      try {
        status(msg, 'Preparing image…');
        pendingImage = await prepareImage(fl); removeImage = false;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(pendingImage);
        showPreview(objectUrl); status(msg, '');
      } catch (err) { pendingImage = null; file.value = ''; status(msg, err.message, 'error'); }
    }
    file.addEventListener('change', () => pick(file.files[0]));
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); pick(e.dataTransfer.files[0]); });
    clearImg.addEventListener('click', () => { pendingImage = null; file.value = ''; removeImage = !!editing; showPreview(''); });

    const heading = h('h3', { text: 'Add a project' });
    const submit = h('button', { class: 'btn btn-solid full', type: 'submit', text: 'Add to portfolio' });
    const cancel = h('button', { class: 'adm-link', type: 'button', text: 'Cancel editing', hidden: true, onclick: () => api_.reset() });

    const form = h('form', { class: 'adm-panel adm-form', novalidate: true, onsubmit: async e => {
      e.preventDefault();
      if (!f.title.value.trim()) { status(msg, 'Project title is required.', 'error'); f.title.focus(); return; }
      if (f.url.value.trim() && !/^https?:\/\//i.test(f.url.value.trim())) { status(msg, 'Website URL must start with https://', 'error'); f.url.focus(); return; }
      const fd = new FormData();
      ['title', 'category', 'year', 'url', 'description'].forEach(k => fd.append(k, f[k].value));
      fd.append('visible', String(f.visible.checked));
      if (pendingImage) fd.append('image', pendingImage, 'image');
      if (editing) { fd.append('id', editing.id); if (removeImage) fd.append('removeImage', 'true'); }
      submit.disabled = true; status(msg, editing ? 'Saving…' : 'Adding…');
      try {
        const data = await api('/api/admin/portfolio', { method: editing ? 'PUT' : 'POST', form: fd });
        const wasEditing = !!editing;
        api_.reset();
        status(msg, wasEditing ? '✓ Changes saved.' : '✓ Project added to the portfolio.', 'ok');
        await api_.onSaved(data);
      } catch (err) { handle(err, msg); }
      finally { submit.disabled = false; }
    } },
      heading,
      h('div', { class: 'fld' }, h('label', { for: 'af-title', text: 'Project title *' }), f.title),
      h('div', { class: 'adm-2' },
        h('div', { class: 'fld' }, h('label', { for: 'af-cat', text: 'Category' }), f.category),
        h('div', { class: 'fld' }, h('label', { for: 'af-year', text: 'Year' }), f.year)),
      h('div', { class: 'fld' }, h('label', { for: 'af-url', text: 'Website URL' }), f.url),
      h('div', { class: 'fld' }, h('label', { for: 'af-desc' }, 'Description ', counter), f.description),
      h('div', { class: 'fld' }, h('span', { class: 'adm-label', text: 'Image' }), drop, preview, clearImg),
      h('label', { class: 'adm-check', for: 'af-vis' }, f.visible, ' Show on the website'),
      msg, submit, cancel);

    const api_ = {
      el: form,
      onSaved: async () => {},
      reset() {
        editing = null; pendingImage = null; removeImage = false;
        form.reset(); f.visible.checked = true; counter.textContent = '0 / 600'; file.value = '';
        showPreview(''); heading.textContent = 'Add a project'; submit.textContent = 'Add to portfolio'; cancel.hidden = true;
      },
      edit(it) {
        api_.reset();
        editing = it;
        f.title.value = it.title || ''; f.category.value = CATEGORIES.includes(it.category) ? it.category : 'Other';
        f.year.value = it.year || ''; f.url.value = it.url || ''; f.description.value = it.description || '';
        f.visible.checked = !!it.visible; counter.textContent = `${f.description.value.length} / 600`;
        if (it.image) showPreview(it.image);
        heading.textContent = `Editing: ${it.title}`; submit.textContent = 'Save changes'; cancel.hidden = false;
        status(msg, ''); form.scrollIntoView({ behavior: 'smooth', block: 'start' }); f.title.focus();
      },
    };
    return api_;
  }

  function handle(err, el) {
    if (err.status === 401) { user = null; renderLogin('Your session has ended — please sign in again.'); return; }
    status(el, err.message, 'error');
  }

  async function logout() {
    try { await api('/api/admin/logout', { method: 'POST' }); } catch {}
    user = null; dlg.close();
  }

  async function open() {
    if (!dlg) build();
    if (!dlg.open) dlg.showModal();
    try {
      const s = await api('/api/admin/session');
      if (s.authenticated) { user = s.user; await renderManager(); }
      else renderLogin();
    } catch (err) {
      view.replaceChildren(h('div', { class: 'adm-login' },
        h('h2', { text: 'Portal unavailable' }),
        h('p', { class: 'sub', text: err.status === 404 ? 'The admin API isn’t deployed. It only runs on Netlify (or with “netlify dev”).' : err.message }),
        h('button', { class: 'btn btn-ghost full', type: 'button', text: 'Close', onclick: () => dlg.close() })));
    }
  }

  window.JadnixAdmin = Object.freeze({ open });
})();
