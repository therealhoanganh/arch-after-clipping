// Written by ARCH After Clipping. Edits here are overwritten when the plugin
// updates the extension; change youtube-notes/ in the plugin's repository.
//
// On YouTube only: one hotkey saves the moment, another pauses and saves the
// moment with a line typed into a small box. The first note on a video asks
// which vault it goes to, unless the video already has a note somewhere.
// Runs at document_start so its key listener sits ahead of YouTube's own.
'use strict';
(() => {
  const IS_MAC = /Mac/i.test(navigator.platform);
  const DEFAULT_KEYS = {
    bare: { code: 'KeyK', meta: IS_MAC, ctrl: false, alt: !IS_MAC, shift: false },
    typed: { code: 'KeyK', meta: IS_MAC, ctrl: false, alt: !IS_MAC, shift: true },
  };
  let keys = DEFAULT_KEYS;
  try {
    chrome.storage.sync.get('keys', (r) => { if (r && r.keys) keys = r.keys; });
    chrome.storage.onChanged.addListener((c) => { if (c.keys) keys = c.keys.newValue || DEFAULT_KEYS; });
  } catch (e) { /* the defaults stand */ }

  const same = (e, k) => !!k && e.code === k.code && e.metaKey === !!k.meta && e.ctrlKey === !!k.ctrl
    && e.altKey === !!k.alt && e.shiftKey === !!k.shift;

  const label = (sec) => {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  };

  function videoId() {
    const u = new URL(location.href);
    if (u.pathname === '/watch') return u.searchParams.get('v');
    const m = u.pathname.match(/^\/(?:shorts|live)\/([\w-]{11})/);
    return m ? m[1] : null;
  }
  const player = () => document.querySelector('#movie_player video') || document.querySelector('video');
  const adShowing = () => !!document.querySelector('#movie_player.ad-showing');
  function title() {
    const h = document.querySelector('ytd-watch-metadata h1') || document.querySelector('#title h1');
    const t = h && h.textContent.trim();
    return t || document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube$/, '').trim();
  }

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => {
          const e = chrome.runtime.lastError;
          resolve(e ? { error: e.message } : r || { error: 'No answer from the extension.' });
        });
      } catch (e) {
        resolve({ error: 'The extension was reloaded since this tab opened. Reload this YouTube tab and press again.' });
      }
    });
  }

  /* ---------------- the small window over the video ---------------- */

  let host = null, root = null, open = null; // open: the box currently asking
  function ui() {
    if (!host) {
      host = document.createElement('div');
      host.id = 'arch-youtube-notes';
      root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>
        :host { all: initial; }
        .wrap { position: fixed; left: 50%; bottom: 96px; transform: translateX(-50%); z-index: 2147483647;
          font: 14px/1.4 Roboto, "Helvetica Neue", Arial, sans-serif; color: #fff; }
        .toast, .box { background: rgba(20, 20, 20, 0.92); border: 1px solid rgba(255, 255, 255, 0.18);
          border-radius: 10px; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5); }
        .toast { padding: 8px 14px; max-width: 70vw; }
        .toast.bad { border-color: #ff6b6b; }
        .box { padding: 12px 14px; width: min(560px, 80vw); }
        .head { font-size: 12px; color: #bbb; margin-bottom: 8px; }
        .head b { color: #fff; font-weight: 500; }
        label { display: block; font-size: 12px; color: #bbb; margin: 8px 0 4px; }
        input, select { box-sizing: border-box; width: 100%; padding: 7px 9px; border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.25); background: #111; color: #fff; font: inherit; outline: none; }
        input:focus, select:focus { border-color: #3ea6ff; }
        .row { display: flex; gap: 8px; justify-content: flex-end; align-items: center; margin-top: 10px; }
        .hint { flex: 1; font-size: 12px; color: #999; }
        button { font: inherit; padding: 6px 12px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.25);
          background: transparent; color: #fff; cursor: pointer; }
        button.go { background: #3ea6ff; border-color: #3ea6ff; color: #0f0f0f; font-weight: 500; }
        [hidden] { display: none !important; }
      </style><div class="wrap"><div class="toast" hidden></div><div class="box" hidden></div></div>`;
    }
    const parent = document.fullscreenElement || document.body || document.documentElement;
    if (host.parentNode !== parent) parent.appendChild(host);
    return root;
  }
  document.addEventListener('fullscreenchange', () => { if (host && host.isConnected) ui(); });

  let toastTimer = 0;
  function toast(text, ms = 2600, bad = false) {
    const t = ui().querySelector('.toast');
    t.textContent = text;
    t.classList.toggle('bad', bad);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  // One box at a time. Resolves with the answer, or null on Esc / Cancel.
  function box(html, onEnter, focusSel) {
    const r = ui();
    r.querySelector('.toast').hidden = true;
    const b = r.querySelector('.box');
    b.innerHTML = html;
    b.hidden = false;
    return new Promise((resolve) => {
      const done = (v) => { b.hidden = true; b.innerHTML = ''; open = null; resolve(v); };
      open = { enter: () => { const v = onEnter(b); if (v !== undefined) done(v); }, cancel: () => done(null) };
      const go = b.querySelector('button.go'), no = b.querySelector('button.no');
      if (go) go.onclick = () => open && open.enter();
      if (no) no.onclick = () => open && open.cancel();
      setTimeout(() => { const f = b.querySelector(focusSel); if (f) f.focus(); }, 0);
    });
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  const askText = (at) => box(`
      <div class="head">Note at <b>${esc(at)}</b></div>
      <input class="text" type="text" placeholder="What happens here" autocomplete="off">
      <div class="row"><span class="hint">Enter saves · Esc cancels</span></div>`,
    (b) => b.querySelector('.text').value, '.text');

  async function askPlace(res, info, tpl) {
    const vaults = res.vaults || [];
    if (!vaults.length) {
      toast('Not saved: no Obsidian vault found on this computer. Open Obsidian once so it lists its vaults, then press again.', 8000, true);
      return null;
    }
    // the template's own vault first, as Web Clipper would; else the last one used
    const last = vaults.includes(tpl.vault) ? tpl.vault : vaults.includes(res.last) ? res.last : vaults[0];
    const folders = res.folders || {};
    const answer = box(`
        <div class="head">New note for <b>${esc(info.title || info.videoId)}</b>, clipped with the <b>${esc(tpl.name || 'Web Clipper')}</b> template</div>
        <label>Which Vault</label>
        <select class="vault">${vaults.map((v) => `<option${v === last ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>
        <label>Folder For the New Note</label>
        <input class="folder" type="text" list="arch-ytn-folders" placeholder="The vault's top level when empty" autocomplete="off">
        <datalist id="arch-ytn-folders"></datalist>
        <div class="row"><span class="hint">Asked once per video · Enter saves · Esc cancels</span>
          <button class="no">Cancel</button><button class="go">Save Here</button></div>`,
      (b) => ({ vault: b.querySelector('.vault').value, folder: b.querySelector('.folder').value.trim() }), '.vault');
    const b = root.querySelector('.box');
    const sel = b.querySelector('.vault'), folder = b.querySelector('.folder'), list = b.querySelector('datalist');
    const fill = async () => {
      // the folder last used in this vault, else the template's (his: YouTube)
      folder.value = folders[sel.value] != null ? folders[sel.value] : (tpl.path || '');
      list.innerHTML = '';
      const r = await send({ type: 'folders', vault: sel.value });
      list.innerHTML = (r.folders || []).map((f) => `<option value="${esc(f)}">`).join('');
    };
    sel.onchange = fill;
    fill();
    return answer;
  }

  /* ---------------- clipping, as Web Clipper would ---------------- */

  // Web Clipper cannot be asked by another extension to clip, so a new note is
  // made here from the same template and the same library (Defuddle), which
  // is what Web Clipper's {{content}} comes from.

  const pad2 = (n) => String(n).padStart(2, '0');
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function formatDate(value, fmt) {
    const d = value instanceof Date ? value : new Date(value);
    if (!value || isNaN(d)) return String(value || '');
    const dateOnly = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    const get = (utc, local) => (dateOnly ? d[utc]() : d[local]());
    const Y = get('getUTCFullYear', 'getFullYear'), M = get('getUTCMonth', 'getMonth') + 1, D = get('getUTCDate', 'getDate');
    const map = {
      YYYY: String(Y), YY: String(Y).slice(2), MMMM: MONTHS[M - 1], MMM: MONTHS[M - 1].slice(0, 3), MM: pad2(M), M: String(M),
      DD: pad2(D), D: String(D), HH: pad2(d.getHours()), H: String(d.getHours()), mm: pad2(d.getMinutes()), ss: pad2(d.getSeconds()),
    };
    return fmt.replace(/YYYY|YY|MMMM|MMM|MM|M|DD|D|HH|H|mm|ss/g, (t) => map[t]);
  }

  // {{name}}, {{meta:property:og:url}}, {{name|date:"YYYY-MM-DD"}}: what his
  // template uses. An unknown filter leaves the value as it is.
  function render(str, vars, meta) {
    return String(str || '').replace(/\{\{([\s\S]*?)\}\}/g, (_, expr) => {
      const [name, ...filters] = expr.split('|').map((x) => x.trim());
      let v;
      const m = name.match(/^meta:(property|name):(.+)$/);
      if (m) v = meta(m[1], m[2]);
      else v = vars[name];
      v = v == null ? '' : v;
      for (const f of filters) {
        const fm = f.match(/^date:\s*\\?["']?(.*?)\\?["']?$/);
        if (fm) v = formatDate(v, fm[1] || 'YYYY-MM-DD');
      }
      return String(v);
    });
  }

  function yamlScalar(v) {
    if (v === '') return '';
    return /^[\s[\]{}>|*&!%#`@,?:'"-]|: | #|\s$|^(true|false|null|yes|no|~)$/i.test(v) ? JSON.stringify(v) : v;
  }
  function yamlProperty(p, value) {
    const type = p.type || 'text';
    if (type === 'checkbox') return `${p.name}: ${/^(true|1|yes)$/i.test(value.trim()) ? 'true' : 'false'}`;
    if (type === 'number') return `${p.name}:${value.trim() && !isNaN(Number(value)) ? ' ' + value.trim() : ''}`;
    if (type === 'multitext') {
      const items = value.split(',').map((x) => x.trim()).filter(Boolean);
      return items.length ? `${p.name}:\n${items.map((x) => `  - ${yamlScalar(x)}`).join('\n')}` : `${p.name}:`;
    }
    const s = value.trim();
    if (type !== 'text') return `${p.name}:${s ? ' ' + s : ''}`; // date, datetime
    return `${p.name}:${s ? ' ' + (/^-?\d+(\.\d+)?$/.test(s) ? JSON.stringify(s) : yamlScalar(s)) : ''}`;
  }

  async function clip(vid) {
    const t = await send({ type: 'template' });
    if (t.error) throw new Error(t.error);
    const tpl = t.template;
    if (!self.Defuddle) {
      const r = await send({ type: 'inject' });
      if (r.error || !self.Defuddle) throw new Error(`Defuddle did not load (${r.error || 'unknown'})`);
    }
    const url = `https://www.youtube.com/watch?v=${vid}`;
    // YouTube changes videos without reloading the page, and what Defuddle
    // reads from the page's own scripts stays the first video's. The live page
    // is used only when it was loaded for this video; otherwise a fresh copy.
    const fresh = [...document.scripts].some((s) => {
      const m = s.textContent.indexOf('ytInitialPlayerResponse') >= 0 && s.textContent.match(/"videoDetails":\{"videoId":"([\w-]{11})"/);
      return !!m && m[1] === vid;
    });
    let doc = document;
    if (!fresh) {
      const html = await (await fetch(url, { credentials: 'include' })).text();
      doc = new DOMParser().parseFromString(html, 'text/html');
      // The page as served carries its VideoObject without the description,
      // which YouTube adds once the page runs; Defuddle reads it from there.
      // The full text is in the player data of the same page.
      const m = html.match(/"shortDescription":("(?:[^"\\]|\\.)*")/);
      if (m) {
        const description = JSON.parse(m[1]);
        for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
          try {
            const d = JSON.parse(s.textContent);
            if (d && d['@type'] === 'VideoObject' && !d.description) {
              d.description = description;
              s.textContent = JSON.stringify(d);
            }
          } catch (_) { /* not ours to fix */ }
        }
      }
    }
    const r = await new self.Defuddle(doc, { url, markdown: true }).parseAsync();
    const tags = r.metaTags || [];
    const meta = (kind, key) => {
      const hit = tags.find((m) => m[kind] === key);
      if (hit) return hit.content;
      const el = doc.querySelector(`meta[${kind}="${key}"]`);
      return el ? el.getAttribute('content') : (key === 'og:url' ? url : '');
    };
    const now = new Date();
    const vars = {
      title: r.title || title(), author: r.author || '', image: r.image || '', published: r.published || '',
      description: r.description || '', content: r.content || '', site: r.site || 'YouTube', domain: 'youtube.com',
      url, date: formatDate(now, 'YYYY-MM-DD'), time: formatDate(now, 'YYYY-MM-DD HH:mm'),
    };
    const props = (tpl.properties || []).map((p) => yamlProperty(p, render(p.value, vars, meta)));
    const body = render(tpl.noteContentFormat || '{{content}}', vars, meta);
    return {
      name: render(tpl.noteNameFormat || '{{title}}', vars, meta),
      markdown: `---\n${props.join('\n')}\n---\n${body.replace(/^\n+/, '')}${body.endsWith('\n') ? '' : '\n'}`,
      path: tpl.path || '',
      vault: tpl.vault || '',
      template: tpl.name || 'template',
      fresh,
    };
  }

  /* ---------------- saving ---------------- */

  function problem(res) {
    if (res.noHelper) {
      return `Not saved: Chrome could not start the helper (${res.error}). In Obsidian, run the command `
        + '"Set Up YouTube Notes From Chrome" (ARCH After Clipping), then press this extension\'s reload arrow in chrome://extensions and press again.';
    }
    return `Not saved: ${res.error}`;
  }

  async function save(info, lookup) {
    let res;
    const found = lookup ? await lookup : null;
    if (found && found.error) res = found;
    else if (found && found.found) res = await send(Object.assign({ type: 'add', vault: found.vault, path: found.path }, info));
    else if (found) res = { need: 'place', vaults: found.vaults, last: found.last, folders: found.folders };
    else res = await send(Object.assign({ type: 'add' }, info));
    let clipped = null, clipError = '';
    if (res.need === 'place') {
      const t = await send({ type: 'template' });
      const tpl = (t && t.template) || {};
      const place = await askPlace(res, info, tpl);
      if (!place) return toast('Not saved.');
      toast(`Clipping the video with the ${tpl.name || 'Web Clipper'} template…`, 30000);
      try {
        clipped = await clip(info.videoId);
      } catch (e) {
        clipError = e.message || String(e);
      }
      res = await send(Object.assign({ type: 'add', create: true }, info, place,
        clipped ? { markdown: clipped.markdown, name: clipped.name } : {}));
    }
    if (res.error) return toast(problem(res), 10000, true);
    const where = `${res.note} (${res.vault})`;
    if (clipError) return toast(`Saved ${res.label} in a new note, but without the clip: ${clipError}. ${where}`, 10000, true);
    toast(`Saved ${res.label}${res.created ? (clipped ? ', clipped into a new note' : ' in a new note') : ''} · ${where}`);
  }

  let busy = false;
  async function press(typed) {
    if (busy) return;
    const vid = videoId();
    if (!vid) return toast('No video on this page: open a video, then press again.');
    if (adShowing()) return toast('An ad is playing. Press again once the video is back.');
    const v = player();
    if (!v) return toast('No video player found on this page.');
    const info = { videoId: vid, seconds: Math.floor(v.currentTime || 0), title: title() };
    busy = true;
    try {
      if (!typed) {
        toast(`Saving ${label(info.seconds)}…`, 15000);
        return await save(info, null);
      }
      const wasPlaying = !v.paused;
      v.pause();
      const lookup = send({ type: 'find', videoId: vid }); // searched while you type
      const text = await askText(label(info.seconds));
      if (wasPlaying) v.play();
      if (text === null) return toast('Not saved.');
      info.text = text;
      await save(info, lookup);
    } finally {
      busy = false;
    }
  }

  // Keys: capture phase on window, registered before YouTube's scripts run,
  // so a hotkey never reaches the page and typing in the box never reaches
  // YouTube's own shortcuts (k, j, l, f, space...).
  const inBox = (e) => host && e.composedPath().includes(host);
  window.addEventListener('keydown', (e) => {
    if (open && inBox(e)) {
      e.stopImmediatePropagation();
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); open.enter(); }
      else if (e.key === 'Escape') { e.preventDefault(); open.cancel(); }
      return;
    }
    const typed = same(e, keys.typed);
    if (!typed && !same(e, keys.bare)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (open) return; // a box is already asking
    press(typed);
  }, true);
  for (const type of ['keyup', 'keypress']) {
    window.addEventListener(type, (e) => { if (open && inBox(e)) e.stopImmediatePropagation(); }, true);
  }
})();
