// Written by ARCH After Clipping. Edits here are overwritten when the plugin
// updates the extension; change youtube-notes/ in the plugin's repository.
'use strict';

const IS_MAC = /Mac/i.test(navigator.platform);
const DEFAULT_KEYS = {
  bare: { code: 'KeyK', meta: IS_MAC, ctrl: false, alt: !IS_MAC, shift: false },
  typed: { code: 'KeyK', meta: IS_MAC, ctrl: false, alt: !IS_MAC, shift: true },
};
let keys = DEFAULT_KEYS;

function show(k) {
  const parts = [];
  if (k.ctrl) parts.push(IS_MAC ? 'Control' : 'Ctrl');
  if (k.alt) parts.push(IS_MAC ? 'Option' : 'Alt');
  if (k.shift) parts.push('Shift');
  if (k.meta) parts.push(IS_MAC ? 'Cmd' : 'Meta');
  parts.push(k.code.replace(/^Key|^Digit/, ''));
  return parts.join(' + ');
}

function draw() {
  for (const id of ['bare', 'typed']) {
    const b = document.getElementById(id);
    b.textContent = show(keys[id]);
    b.classList.remove('recording');
  }
}

for (const id of ['bare', 'typed']) {
  document.getElementById(id).onclick = (ev) => {
    const b = ev.currentTarget;
    b.textContent = 'Press the keys…';
    b.classList.add('recording');
    const take = (e) => {
      if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return; // wait for the key itself
      e.preventDefault();
      window.removeEventListener('keydown', take, true);
      if (e.key === 'Escape') return draw();
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        b.textContent = 'Needs Cmd, Ctrl or Option';
        setTimeout(draw, 1500);
        return;
      }
      keys = Object.assign({}, keys, { [id]: { code: e.code, meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey } });
      chrome.storage.sync.set({ keys }, draw);
    };
    window.addEventListener('keydown', take, true);
  };
}

document.getElementById('reset').onclick = () => {
  keys = DEFAULT_KEYS;
  chrome.storage.sync.remove('keys', draw);
};

document.getElementById('check').onclick = () => {
  const out = document.getElementById('check-result');
  out.className = '';
  out.textContent = 'Checking…';
  chrome.runtime.sendNativeMessage('com.hoanganh.arch_youtube_notes', { type: 'ping' }, (r) => {
    const err = chrome.runtime.lastError;
    if (err || !r || !r.ok) {
      out.className = 'bad';
      out.textContent = `The helper did not answer: ${err ? err.message : (r && r.error) || 'no answer'}.\n`
        + 'Nothing can be saved until it does. To fix it: in Obsidian, run the command "Set Up YouTube Notes From Chrome" '
        + '(ARCH After Clipping), then press this extension\'s reload arrow in chrome://extensions and click Check the Helper again.';
      return;
    }
    out.className = 'good';
    out.textContent = `The helper works: Python ${r.python}, ${r.vaults} vault${r.vaults === 1 ? '' : 's'} found.`
      + (r.vaults ? '' : ' Open Obsidian once so it lists its vaults.');
  });
};

chrome.storage.sync.get('keys', (r) => { if (r && r.keys) keys = r.keys; draw(); });

/* ---- the Web Clipper template ---- */

async function showTemplate() {
  const stored = (await chrome.storage.local.get('template')).template;
  const bundled = await (await fetch(chrome.runtime.getURL('template.json'))).json();
  const t = stored || bundled;
  const props = (t.properties || []).map((p) => p.name).join(', ');
  document.getElementById('tpl-now').textContent = `In use: "${t.name}"${stored ? ', imported' : ', the one shipped with the extension'}; `
    + `note name ${t.noteNameFormat || '{{title}}'}, folder ${t.path || '(top level)'}${t.vault ? `, vault ${t.vault}` : ''}; properties ${props || 'none'}.`;
  document.getElementById('tpl-reset').disabled = !stored;
}

document.getElementById('tpl-import').onclick = () => document.getElementById('tpl-file').click();
document.getElementById('tpl-file').onchange = async (e) => {
  const out = document.getElementById('tpl-result');
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const t = JSON.parse(await f.text());
    if (!t || !Array.isArray(t.properties) || typeof t.noteContentFormat !== 'string') {
      throw new Error('it has no properties or note content, so it is not a Web Clipper template export');
    }
    await chrome.storage.local.set({ template: t });
    out.className = 'good';
    out.textContent = `Imported "${t.name}". New notes use it from now on.`;
  } catch (err) {
    out.className = 'bad';
    out.textContent = `Not imported: ${err.message}. The template in use has not changed. Export the template from Web Clipper again and choose that .json file.`;
  }
  showTemplate();
};
document.getElementById('tpl-reset').onclick = async () => {
  await chrome.storage.local.remove('template');
  document.getElementById('tpl-result').textContent = '';
  showTemplate();
};
showTemplate();
