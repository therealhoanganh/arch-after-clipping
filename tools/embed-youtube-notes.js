#!/usr/bin/env node
// Copies youtube-notes/ into main.js as YOUTUBE_NOTES_FILES, between the
// BEGIN and END markers, because a release ships main.js alone.
//   node tools/embed-youtube-notes.js          rewrite the block
//   node tools/embed-youtube-notes.js --check  exit 1 if main.js is behind
'use strict';
const fs = require('fs');
const path = require('path');

const repo = path.join(__dirname, '..');
const dir = path.join(repo, 'youtube-notes');
const mainPath = path.join(repo, 'main.js');
const BEGIN = '// BEGIN YOUTUBE_NOTES_FILES (written by tools/embed-youtube-notes.js from youtube-notes/, never edit by hand)';
const END = '// END YOUTUBE_NOTES_FILES';

const files = {};
for (const name of fs.readdirSync(dir).sort()) {
  if (name.startsWith('.') || !fs.statSync(path.join(dir, name)).isFile()) continue;
  files[name] = fs.readFileSync(path.join(dir, name), 'utf8');
}
const block = `${BEGIN}\nconst YOUTUBE_NOTES_FILES = ${JSON.stringify(files, null, 1)};\n${END}`;

const main = fs.readFileSync(mainPath, 'utf8');
const a = main.indexOf(BEGIN), b = main.indexOf(END);
if (a < 0 || b < a) {
  console.error('main.js has no YOUTUBE_NOTES_FILES markers.');
  process.exit(2);
}
const next = main.slice(0, a) + block + main.slice(b + END.length);
if (process.argv.includes('--check')) {
  if (next !== main) {
    console.error('main.js is behind youtube-notes/: run node tools/embed-youtube-notes.js');
    process.exit(1);
  }
  console.log('main.js matches youtube-notes/.');
} else {
  fs.writeFileSync(mainPath, next);
  console.log(`embedded ${Object.keys(files).length} files: ${Object.keys(files).join(', ')}`);
}
