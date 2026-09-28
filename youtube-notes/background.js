// Written by ARCH After Clipping. Edits here are overwritten when the plugin
// updates the extension; change youtube-notes/ in the plugin's repository.
//
// The page script cannot talk to the helper program itself, so every request
// comes here and goes on to it through Chrome's native messaging. Two requests
// are answered here instead: the Web Clipper template, and loading Defuddle
// into the tab when a new note is clipped.
'use strict';

const HOST = 'com.hoanganh.arch_youtube_notes';

// The template imported on the options page, else the one shipped with the
// extension (his "YouTube Video" template, exported from Web Clipper).
async function template() {
  const stored = await chrome.storage.local.get('template');
  if (stored && stored.template) return { template: stored.template, imported: true };
  const r = await fetch(chrome.runtime.getURL('template.json'));
  return { template: await r.json(), imported: false };
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg && msg.type === 'template') {
    template().then(reply, (e) => reply({ error: `could not read the template (${e.message})` }));
    return true;
  }
  if (msg && msg.type === 'inject') {
    chrome.scripting.executeScript({ target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] }, files: ['defuddle.js'] })
      .then(() => reply({ ok: true }), (e) => reply({ error: e.message }));
    return true;
  }
  chrome.runtime.sendNativeMessage(HOST, msg, (res) => {
    const err = chrome.runtime.lastError;
    if (err) reply({ error: err.message, noHelper: true });
    else reply(res || { error: 'The helper sent no answer.' });
  });
  return true; // the answer comes later
});
