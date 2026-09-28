// Written by ARCH After Clipping. Edits here are overwritten when the plugin
// updates the extension; change youtube-notes/ in the plugin's repository.
//
// The page script cannot talk to the helper program itself, so every request
// comes here and goes on to it through Chrome's native messaging.
'use strict';

const HOST = 'com.hoanganh.arch_youtube_notes';

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg && msg.type === 'options') {
    chrome.runtime.openOptionsPage();
    return false;
  }
  chrome.runtime.sendNativeMessage(HOST, msg, (res) => {
    const err = chrome.runtime.lastError;
    if (err) reply({ error: err.message, noHelper: true });
    else reply(res || { error: 'The helper sent no answer.' });
  });
  return true; // the answer comes later
});
