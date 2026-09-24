'use strict';

const {
  MarkdownView,
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  TFile,
  TFolder,
  Modal,
  normalizePath,
  requestUrl,
} = require('obsidian');

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');

/* ------------------------------------------------------------------ *
 * One computer does the automatic work (1.18.0)
 * ------------------------------------------------------------------ */

// Since 2026-09-25 the vaults are mirrored between the Mac and an Ubuntu PC by
// Syncthing. A note written on one machine arrives on the other as a new file,
// so with Obsidian open on both, both would process it: two downloads, two
// conversions, conflict files. The setting automaticOn names the one computer
// that runs the automatic work; the settings file syncs, so both machines read
// the same answer. Commands and menus run anywhere. Shared with ARCH Images
// Plus, copied word for word.
//
// The name is macOS's Local Hostname there, because the kernel hostname can
// change with the network; elsewhere os.hostname().
function computerName() {
  if (process.platform === 'darwin') {
    try {
      const n = require('child_process')
        .execFileSync('/usr/sbin/scutil', ['--get', 'LocalHostName'], { encoding: 'utf8', timeout: 3000 })
        .trim();
      if (n) return n;
    } catch (_) {}
  }
  return os.hostname().replace(/\.local$/, '');
}

// automaticOn: '' is unclaimed (the first computer to load this version claims
// it), '*' is every computer, anything else one computer's name.
function automaticRunsHere(settings, here) {
  const a = String(settings.automaticOn || '');
  return !a || a === '*' || a === here;
}

/* ------------------------------------------------------------------ *
 * Videos outside the vault
 * ------------------------------------------------------------------ */

// The drive a folder outside the vault lives on. On macOS that is
// /Volumes/<name>; elsewhere the path's root.
function driveOf(p) {
  const parts = String(p).split(path.sep);
  if (process.platform === 'darwin' && parts[1] === 'Volumes' && parts[2]) {
    return path.join('/', 'Volumes', parts[2]);
  }
  return path.parse(String(p)).root;
}

// Whether that drive is plugged in. /Volumes/<name> can exist as an ordinary
// folder on the Mac's own disk (macOS leaves one behind, and mkdir -p would
// create one), and writing into it fills the Mac instead of the drive. A
// mounted drive has a different device number from /Volumes itself.
function driveMounted(p) {
  const d = driveOf(p);
  try {
    if (d.startsWith('/Volumes/')) return fs.statSync(d).dev !== fs.statSync('/Volumes').dev;
    return fs.existsSync(d);
  } catch (_) {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

const MD_IMAGE_RE = /!\[([^\]]*)\]\((https?:\/\/[^\s)"']+)(?:\s+(?:"[^"]*"|'[^']*'))?\)/g;
// A plain link, not an embed. Never a download candidate on its own -- it is
// rewritten only when its address is one an image property or embed already
// fetched, as with a template that writes [Cover]({{image}}) in the body and
// the same address in a cover property.
const MD_LINK_RE = /(^|[^!])\[([^\]]*)\]\((https?:\/\/[^\s)"']+)(?:\s+(?:"[^"]*"|'[^']*'))?\)/g;
const HTML_IMG_RE = /<img\s[^>]*\bsrc=(?:"(https?:\/\/[^"]+)"|'(https?:\/\/[^']+)')[^>]*>/gi;
const BARE_URL_RE = /https?:\/\/[^\s)\]>"'`]+/;

// Below this, it is almost certainly a tracking pixel or a spacer.
// Written into notes before 1.0.0 and never since. Still read, so a note that
// already has its media is not downloaded again.
const LEGACY_DONE_KEY = 'archived';

const MIN_IMAGE_BYTES = 1024;
const IMAGE_CONCURRENCY = 3;
const HTTP_TIMEOUT_MS = 20000;

const MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
  'image/bmp': '.bmp',
  'image/tiff': '.tif',
};
const KNOWN_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'bmp', 'tif', 'tiff'];

const DEFAULT_VIDEO_HOSTS = [
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'vimeo.com',
  // These sites serve profiles and videos from one domain, so a bare entry
  // costs a yt-dlp round trip on every profile clip. A slash-wrapped entry is
  // compiled as a regex, which narrows it to real media URLs.
  '/(?:twitter|x)\\.com\\/[^\\/]+\\/status\\//',
  '/instagram\\.com\\/(?:p|reel|tv)\\//',
  'facebook.com',
  'fb.watch',
  'twitch.tv',
  'dailymotion.com',
  'bilibili.com',
  'v.redd.it',
  'soundcloud.com',
  'bandcamp.com',
  'streamable.com',
  'rumble.com',
  'nicovideo.jp',
  'odysee.com',
].join(', ');

const DEFAULT_SETTINGS = {
  enabled: true,

  // --- scope -------------------------------------------------------
  watchAllFolders: true,
  clipFolders: [],
  excludeFolders: ['_'],
  graceSeconds: 120, // a "create" event for a file older than this is the vault re-index, not a clip

  // --- shared ------------------------------------------------------
  frontmatterUrlKeys: ['url', 'source', 'link', 'permalink', 'original-url'],
  // Notes carrying any of these properties belong to another ARCH plugin and are
  // left alone. Editable, so a new marker needs no code change.
  skipOtherArchNotes: true,
  otherArchKeys: ['yt-playlist', 'dl-all', 'x-author', 'x-name'],
  otherArchTags: ['yt-channel'],
  processedUrls: [],
  duplicateAction: 'warn', // warn | ignore

  // --- images ------------------------------------------------------
  downloadImages: true,
  // Images have their own watch list; media stays on clipFolders so a video
  // still downloads anywhere the plugin runs. Empty means every folder, which
  // is how clipFolders already behaves.
  imageFolders: [],
  // Mirrors Obsidian's own "Default location for new attachments" choices.
  imageLocationMode: 'subfolder', // obsidian | vault | same | subfolder | specified
  imageSubfolder: 'Images',
  imageFolder: '',
  imageNameTemplate: '{{notename}} {{index}}',
  rewriteFrontmatterImages: true,
  frontmatterImageKeys: ['img', 'image', 'cover', 'thumbnail', 'banner', 'icon'],
  frontmatterImageLabels: {},       // { banner: 'Banner' } -> [[file.webp|Banner]]; unlisted keys stay bare

  // --- transform ---------------------------------------------------
  enableTransform: true,
  pythonPath: '',
  transformRules: [
    { name: 'Gemini chat', pattern: 'gemini.google.com', script: 'gemini_chat.py' },
    { name: 'Reddit thread', pattern: 'reddit.com', script: 'reddit_thread.py' },
  ],
  backupBeforeTransform: false,
  backupFolder: '_raw',

  // --- media (yt-dlp) ----------------------------------------------
  downloadVideo: true,
  askDownloadMode: true,
  defaultDownloadMode: 'video_and_audio',
  // Written to the note once media is on disk. Empty writes nothing.
  markDownloadedKey: 'dl-ed',
  // Applied whenever this plugin writes frontmatter. Listed properties come
  // first in this order; everything else keeps its place after them. The
  // default is the ARCH video note template, media first, so a download does
  // not leave the player at the bottom of the properties panel.
  frontmatterOrder: 'media, channel, yt-playlist, banner, url, dl-ed, rank, duration, status, published, tags',
  ytDlpPath: 'yt-dlp',
  ffmpegLocation: '',
  videoLocationMode: 'subfolder', // vault | same | subfolder | specified
  videoSubfolder: 'Medias',
  videoFolder: '',
  // An absolute folder on another drive. When set, the video file alone goes
  // there, under the vault's name and the folders it would have had in the
  // vault; subtitles and audio stay in the vault. Empty keeps it in the vault.
  externalVideoFolder: '',
  // The script that makes notes' file:/// links follow a video moved or renamed
  // on the drive (backup-strategy/relink-videos.py). It also runs after every
  // backup; the command is for right after reorganising the drive. Filled in
  // when found at its usual place.
  relinkScript: '',
  // Folders (vault paths, one per line) whose videos stay in the vault even
  // when Videos outside the vault is set: the sensitive ones. Their default in
  // the download popup and for the commands is the vault.
  keepVideosInVault: '',
  // A video saved in the vault only because the drive was not plugged in is
  // queued, and moved to the drive once it is back when this is on.
  moveToDriveWhenBack: true,
  driveMoveQueue: [],
  // The one computer that runs the automatic work (1.18.0): new-note
  // processing, the startup catch-up, the move of waiting videos to the drive.
  // '' unclaimed, '*' every computer, else a computer's name.
  automaticOn: '',
  quality: 'bestvideo*+bestaudio/best',
  audioFormat: 'mp3',
  cookiesFromBrowser: '',
  cookiesFile: '',
  videoHosts: DEFAULT_VIDEO_HOSTS,
  probeUnknownUrls: false,
  noPlaylist: true,
  remoteComponents: 'ejs:github',
  ytDlpExtraArgs: '',
  fallbackExtractorArgs: 'youtube:player_client=mweb',
  jsRuntime: '',
  linkDownloadedMedia: true,
  embedLocalMedia: true,
  renameNoteFromMedia: true,
  // Writes the video's length into `duration`, in whole minutes rounded up,
  // the way ARCH YT Playlists does. Never overwrites a value already there.
  fillVideoLength: true,
  noteNameTemplate: '%(channel)s \u2014 %(title)s',
  noteTitleSource: 'filename', // filename | metadata

  // --- subtitles -------------------------------------------------
  downloadSubtitles: true,
  subtitleLangs: 'en.*',
  // 'en.*' matches en, en-US, en-GB and en-orig, so yt-dlp writes one file
  // per variant. Keep the best and delete the rest.
  keepOneSubtitle: true,

  setupDone: false,
};

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function trimSlashes(s) {
  return String(s || '').replace(/^\/+|\/+$/g, '');
}

function splitList(raw) {
  return String(raw || '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// "banner=Banner, icon=Icon" <-> { banner: 'Banner', icon: 'Icon' }. An entry
// with no "=" or an empty side is ignored rather than half-applied.
function parseLabels(raw) {
  const out = {};
  for (const entry of splitList(raw)) {
    const eq = entry.indexOf('=');
    if (eq === -1) continue;
    const key = entry.slice(0, eq).trim();
    const label = entry.slice(eq + 1).trim();
    if (key && label) out[key] = label;
  }
  return out;
}

// The label a property value already carries: "[Thumbnail](url)",
// "![Thumbnail](url)" or "[[file|Thumbnail]]". A bare address, or an empty
// label such as "![](url)", yields ''.
function existingLabel(value) {
  const v = String(value || '').trim();
  const md = v.match(/^!?\[([^\]]*)\]\(/);
  if (md) return md[1].trim();
  const wiki = v.match(/^!?\[\[[^\]|]*\|([^\]]*)\]\]$/);
  if (wiki) return wiki[1].trim();
  return '';
}

function joinLabels(labels) {
  return Object.entries(labels || {}).map(([k, v]) => `${k}=${v}`).join(', ');
}

function sanitizeName(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|#^[\]]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120) || 'file';
}

// Returns { fm, body } where fm keeps its own trailing newline, or '' when absent.
function splitFrontmatter(content) {
  const m = content.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/);
  if (!m) return { fm: '', body: content };
  return { fm: m[0], body: content.slice(m[0].length) };
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function urlLooksLikeImage(url) {
  try {
    const clean = new URL(url).pathname.toLowerCase();
    return KNOWN_IMAGE_EXTS.some((e) => clean.endsWith('.' + e));
  } catch (_) {
    return false;
  }
}

function extFromResponse(url, contentType) {
  const ct = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (MIME_EXT[ct]) return MIME_EXT[ct];
  try {
    const p = new URL(url).pathname.toLowerCase();
    const hit = KNOWN_IMAGE_EXTS.find((e) => p.endsWith('.' + e));
    if (hit) return '.' + (hit === 'jpeg' ? 'jpg' : hit);
  } catch (_) {
    /* ignore */
  }
  return '.jpg';
}

function matchesPattern(url, pattern) {
  const p = String(pattern || '').trim();
  if (!p) return false;
  if (p.length > 2 && p.startsWith('/') && p.endsWith('/')) {
    try {
      return new RegExp(p.slice(1, -1), 'i').test(url);
    } catch (_) {
      return false;
    }
  }
  return url.toLowerCase().includes(p.toLowerCase());
}

async function runWithConcurrency(tasks, limit) {
  const out = new Array(tasks.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]();
    }
  });
  await Promise.all(workers);
  return out;
}

/* ------------------------------------------------------------------ *
 * Plugin
 * ------------------------------------------------------------------ */

module.exports = class ClipArchiver extends Plugin {
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new ClipArchiverSettingTab(this.app, this));
    this.ensureTransformers();

    this.inFlight = new Set();
    this.askQueue = Promise.resolve();
    this.downloadQueue = Promise.resolve();
    this.chosenPlace = new Map();
    this.sessionMode = null; // set by "use this for the rest of this session"
    this.resolvedPython = null;

    // Obsidian replays a "create" event for every existing file while it indexes
    // the vault at startup. Registering after layout-ready skips that replay.
    //
    // It also skips the one clip that matters most: when Web Clipper saves to a
    // vault that is not open, it launches Obsidian and the note is written
    // during startup, before this listener exists. So once the listener is in
    // place, sweep for notes young enough to be that clip and run them through
    // the same entry point. The seen-set keeps the sweep off any note the live
    // listener already took; it never blocks the listener itself, because
    // deleting a note and clipping it again at the same path is the normal
    // testing loop.
    this.seenThisSession = new Set();
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(
        this.app.vault.on('create', (file) => {
          if (!(file instanceof TFile)) return;
          if (!this.automaticHere()) {
            if (file.extension === 'md') this.log(`left alone, automatic work runs on ${this.settings.automaticOn}:`, file.path);
            return;
          }
          this.onFileCreated(file);
        })
      );
      this.log(
        this.automaticHere()
          ? 'watching for new notes'
          : `not processing new notes here: automatic work runs on ${this.settings.automaticOn}, this is ${this.computer}`
      );
      this.watchLocalDeletions();
      this.checkMediaExtended();
      this.watchDriveLabels();
      this.watchDriveQueue();
      this.watchDeletedDriveNotes();
      this.catchUpStartupClips();
    });

    this.addRibbonIcon('archive', 'Archive this clip', () => this.archiveActiveNote());

    this.addCommand({
      id: 'archive-active-note',
      name: 'Archive this clip (images, transform, media)',
      callback: () => this.archiveActiveNote(),
    });
    this.addCommand({
      id: 'download-images-active-note',
      name: 'Download images for this note',
      callback: () => this.withActiveNote((f) => this.doImages(f)),
    });
    this.addCommand({
      id: 'transform-active-note',
      name: 'Transform this note with its site script',
      callback: () => this.withActiveNote((f) => this.doTransform(f, null, true)),
    });
    // One command per download choice, rather than one that opens the choice
    // dialog: YT Playlists already has a "Download media for this note", and two
    // identical names in the palette could not be told apart. Each command is
    // the choice itself, so it skips the dialog and any choice remembered for
    // the session.
    for (const [mode, id, what] of [
      ['video_and_audio', 'download-video-and-audio-active-note', 'video and audio'],
      ['video_only', 'download-video-active-note', 'video'],
      ['audio_only', 'download-audio-active-note', 'audio'],
      ['subs_only', 'download-subtitles-active-note', 'subtitles'],
    ]) {
      this.addCommand({
        id,
        name: `Download ${what} for this note`,
        callback: () => this.withActiveNote((f) => this.downloadForNote(f, mode)),
      });
    }
    this.addCommand({
      id: 'fill-video-length-active-note',
      name: 'Fill video length for this note',
      callback: () =>
        this.withActiveNote(async (f) => {
          const url =
            this.resolveSourceUrl(this.app.metadataCache.getFileCache(f)?.frontmatter) ||
            this.extractUrlFromRawFrontmatter(await this.app.vault.read(f).catch(() => ''));
          if (!url) return new Notice('This note has no source URL.');
          // YouTube is answered by its page; anything else needs the yt-dlp call.
          const youtube = /(?:youtube\.com|youtu\.be)/i.test(url);
          const meta = youtube ? null : await this.fetchChannelAndTitle(url);
          await this.fillVideoLength(f, url, meta, true);
        }),
    });
    this.addCommand({
      id: 'relink-drive-videos',
      name: 'Relink videos on the outside drive',
      callback: () => this.relinkDriveVideos(),
    });
    this.addCommand({
      id: 'move-waiting-videos-to-drive',
      name: 'Move videos waiting for the drive now',
      callback: () => this.moveQueuedVideos(true),
    });
    this.addCommand({
      id: 'move-note-video-to-drive',
      name: "Move this note's video to the drive",
      callback: () => this.moveActiveNoteVideo(),
    });
    this.addCommand({
      id: 'forget-active-note',
      name: 'Forget this note, so it can be archived again',
      callback: () => this.withActiveNote((f) => this.forgetNote(f)),
    });
    this.addCommand({
      id: 'restore-bundled-transformers',
      name: 'Restore the bundled transformer scripts',
      callback: () => {
        const written = this.ensureTransformers(true);
        new Notice(
          written.length
            ? `Restored ${written.length} transformer script${written.length === 1 ? '' : 's'}.`
            : 'Could not write the transformer scripts. See the console.'
        );
      },
    });
    this.addCommand({
      id: 'diagnose',
      name: 'Set up external tools (yt-dlp, ffmpeg, Python)',
      callback: () => this.diagnose(),
    });
    this.addCommand({
      id: 'embed-local-player',
      name: 'Embed the downloaded media in this note',
      callback: () => this.withActiveNote((f) => this.embedFromFrontmatter(f)),
    });
    this.addCommand({
      id: 'clean-video-blocks',
      name: 'Clean up old video blocks across the vault',
      callback: () => this.cleanVideoBlocks(),
    });
    this.addCommand({
      id: 'diagnose-embed',
      name: 'Diagnose how this note renders media',
      callback: () => this.diagnoseEmbed(),
    });
    this.addCommand({
      id: 'show-guide',
      name: 'How this plugin works',
      callback: () => new GuideModal(this.app, this).open(),
    });
    this.addCommand({
      id: 'inspect-active-note',
      name: 'Inspect this note (what Clip Archiver sees)',
      callback: () => this.withActiveNote((f) => this.inspect(f)),
    });
    this.addCommand({
      id: 'probe-runtimes',
      name: 'Check what yt-dlp can see (JavaScript runtime and solver)',
      callback: () => this.probeRuntimes(),
    });
    this.addCommand({
      id: 'list-formats',
      name: 'List available formats for this note\u2019s URL',
      callback: () =>
        this.withActiveNote(async (f) => {
          const url =
            this.resolveSourceUrl(this.app.metadataCache.getFileCache(f)?.frontmatter) ||
            this.extractUrlFromRawFrontmatter(await this.app.vault.read(f).catch(() => ''));
          if (!url) return new Notice('No source URL in this note.');
          return this.listFormats(url);
        }),
    });
    this.addCommand({
      id: 'update-yt-dlp',
      name: 'Update yt-dlp',
      callback: () => this.updateYtDlp(),
    });

    // First run: find the tools instead of making the user type paths.
    if (!this.settings.setupDone) {
      this.app.workspace.onLayoutReady(async () => {
        const report = await this.detectTools();
        const filled = await this.autoConfigureFromDetection(report);
        this.settings.setupDone = true;
        await this.saveSettings();
        this.log('first-run detection filled:', filled);
        const missing = [];
        if (!report.ytdlp.found) missing.push('yt-dlp');
        if (!report.ffmpeg.found) missing.push('ffmpeg');
        if (missing.length) {
          new Notice(
            `${missing.join(' and ')} not found. Open Settings \u2192 ARCH After Clipping \u2192 ` +
              'Set up external tools and press Install.',
            15000
          );
        } else if (filled.length) {
          new Notice(`Clip Archiver configured itself: ${filled.length} setting(s) filled in.`, 8000);
        }
      });
    }
  }

  // A video outside the vault gets a readable link at the top of the note
  // body, "4T-HDD: <file name>". `media` has to stay a bare file:/// URL,
  // because Media Extended reads nothing else there and a labelled link in a
  // property opens in the web browser, so the properties panel shows a long
  // %-encoded address. A link in the body opens in Media Extended's window.
  // Hoang Anh asked for this on 2026-09-24. The body link encodes ( and ) as
  // well, so a folder like "Dante Seminar (June 2026, Beijing)" cannot end the
  // markdown link early. Added once; a note already linking the file is left alone.
  async addDriveLinks(file, absPaths) {
    const links = absPaths.map((abs) => {
      const url = pathToFileURL(abs).href.replace(/\(/g, '%28').replace(/\)/g, '%29');
      const label = `${path.basename(driveOf(abs))}: ${path.basename(abs)}`.replace(/([\[\]])/g, '\\$1');
      return { url, line: `[${label}](${url})` };
    });
    if (!links.length) return;
    await this.app.vault.process(file, (text) => {
      // Only the body counts: `media` in the frontmatter always holds the address.
      const m = text.match(/^---\n[\s\S]*?\n---\n/);
      const head = m ? m[0] : '';
      const rest = text.slice(head.length).replace(/^\n+/, '');
      const todo = links.filter((l) => !rest.includes(l.url));
      if (!todo.length) return text;
      return head + '\n' + todo.map((l) => l.line).join('\n') + '\n\n' + rest;
    });
    this.log('readable drive link added to the note body:', file.path);
  }

  // ---- Deleting a note whose video is on the drive (1.17.0) ----
  // Obsidian's own "Delete unlinked attachments" only offers vault files the
  // note links. A video on the drive is a file:/// address it cannot see or
  // delete, and the note's .vtt is linked only from its Media Extended library
  // note, if at all. So deleting such a note left the video, its subtitles and
  // its library note behind; he found this on 2026-09-24 ("delete attachment
  // when delete files doesn't work"). Obsidian reports a deleted note with its
  // last metadata, which still holds `media`. Deletions within half a second
  // are gathered, so deleting a folder asks once. Anything another note still
  // links is never offered. The drive video goes to the macOS Trash, the vault
  // files to the vault's trash: both recoverable. Vault files the note linked
  // itself (an .mp3 in media) stay with Obsidian's own popup, so the two never
  // offer the same file.
  watchDeletedDriveNotes() {
    this.deletedDriveNotes = [];
    this.registerEvent(
      this.app.metadataCache.on('deleted', (file, prev) => {
        const fm = prev && prev.frontmatter;
        if (!fm || fm['mx-uid']) return;
        const raw = fm.media;
        const urls = (Array.isArray(raw) ? raw : raw ? [raw] : [])
          .map((v) => String(v).trim())
          .filter((v) => /^file:\/\/\/Volumes\//i.test(v) && /\.(mp4|webm|mkv|mov|avi|m4v)(#.*)?$/i.test(v));
        if (!urls.length) return;
        if (!this.deletedHere(file.path)) {
          this.log('deleted elsewhere (synced or outside Obsidian), not offering its media:', file.path);
          return;
        }
        this.deletedDriveNotes.push({ path: file.path, urls });
        window.clearTimeout(this.deletedDriveTimer);
        this.deletedDriveTimer = window.setTimeout(() => this.offerDriveMediaDelete(), 500);
      })
    );
  }

  // Which deletions were made in this Obsidian (1.18.0). With the vaults
  // mirrored, a note deleted on one computer is deleted on the other a few
  // seconds later, and the popup must show only where he deleted it ("the
  // popup show on whichever machine I delete on"). Every deletion made inside
  // Obsidian (file menu, delete key, commands, other plugins) goes through
  // vault.trash or vault.delete; one arriving by sync or made in Finder goes
  // through neither, so marking the paths these two are called with tells them
  // apart. A folder marks everything under it. Marks expire after a minute.
  watchLocalDeletions() {
    this.localDeletions = new Map();
    const vault = this.app.vault;
    const marks = this.localDeletions;
    for (const name of ['trash', 'delete']) {
      const orig = vault[name];
      if (typeof orig !== 'function') continue;
      let active = true;
      const wrapper = function (file, ...rest) {
        if (active && file && file.path) marks.set(file.path, Date.now());
        return orig.call(this, file, ...rest);
      };
      vault[name] = wrapper;
      // Another plugin may have wrapped it after this one; then only switch
      // this wrapper off rather than cut that plugin's out.
      this.register(() => {
        active = false;
        if (vault[name] === wrapper) vault[name] = orig;
      });
    }
  }

  deletedHere(p) {
    const now = Date.now();
    for (const [marked, t] of this.localDeletions || []) {
      if (now - t > 60 * 1000) {
        this.localDeletions.delete(marked);
        continue;
      }
      if (p === marked || p.startsWith(marked + '/')) return true;
    }
    return false;
  }

  automaticHere() {
    return automaticRunsHere(this.settings, this.computer);
  }

  async offerDriveMediaDelete() {
    const notes = this.deletedDriveNotes.splice(0);
    if (!notes.length) return;
    const stillLinked = new Set();
    for (const md of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(md)?.frontmatter;
      if (!fm || fm['mx-uid']) continue;
      const raw = fm.media;
      for (const v of Array.isArray(raw) ? raw : raw ? [raw] : []) stillLinked.add(String(v).trim().split('#')[0]);
    }
    const groups = [];
    for (const n of notes) {
      const items = [];
      for (const u of n.urls) {
        const url = u.split('#')[0];
        if (stillLinked.has(url)) {
          this.log('another note still links this video, not offered:', url);
          continue;
        }
        let abs;
        try {
          abs = decodeURIComponent(url.replace(/^file:\/\//i, ''));
        } catch (_) {
          continue;
        }
        const drive = path.basename(driveOf(abs) || '/Volumes/drive');
        if (!driveMounted(abs)) items.push({ kind: 'drive', abs, label: `${path.basename(abs)} on ${drive}`, off: `${drive} is not plugged in, so the video stays` });
        else if (fs.existsSync(abs)) {
          const mb = (fs.statSync(abs).size / 1048576).toFixed(1);
          items.push({ kind: 'drive', abs, label: `${path.basename(abs)} on ${drive} (${mb} MB)` });
        }
        const lib = this.app.vault.getMarkdownFiles().find((f) => {
          const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
          return fm && fm['mx-uid'] && String(fm.video || '').split('#')[0] === url;
        });
        const subs = new Set();
        if (lib) {
          for (const l of this.app.metadataCache.getFileCache(lib)?.frontmatterLinks || []) {
            const tf = this.app.metadataCache.getFirstLinkpathDest(l.link.split('#')[0], lib.path);
            if (tf) subs.add(tf);
          }
        }
        const stem = path.basename(abs).replace(/\.[^.]+$/, '');
        for (const tf of this.app.vault.getFiles()) {
          if (/^(vtt|srt|ass)$/i.test(tf.extension) && tf.name.startsWith(stem + '.')) subs.add(tf);
        }
        for (const tf of subs) {
          const others = Object.entries(this.app.metadataCache.resolvedLinks).some(
            ([src, to]) => to[tf.path] && src !== (lib && lib.path)
          );
          if (!others) items.push({ kind: 'vault', file: tf, label: `${tf.name} (subtitles, in the vault)` });
        }
        if (lib) items.push({ kind: 'vault', file: lib, label: `${lib.name} (Media Extended library note)` });
      }
      if (items.length) groups.push({ note: n.path, items });
    }
    if (!groups.length) return;
    new DriveMediaDeleteModal(this.app, groups, async () => {
      let done = 0;
      const failed = [];
      for (const g of groups) {
        for (const it of g.items) {
          if (it.off) continue;
          try {
            if (it.kind === 'drive') await require('electron').shell.trashItem(it.abs);
            else await this.app.fileManager.trashFile(it.file);
            done++;
            this.log('deleted with its note:', it.kind === 'drive' ? it.abs : it.file.path);
          } catch (e) {
            failed.push(it.label);
            console.warn('[ArchAfterClipping] could not delete', it.label, e);
          }
        }
      }
      new Notice(
        failed.length
          ? `Deleted ${done} file(s); ${failed.length} could not be deleted. See the console.`
          : `Deleted ${done} file(s) with the note${groups.length > 1 ? 's' : ''}.`,
        8000
      );
    }).open();
  }

  // ---- Moving a video from the vault to the drive (1.16.0) ----
  // A video that went into the vault only because the drive was not plugged
  // in is queued here, by this plugin or by ARCH YT Playlists (which calls
  // queueDriveMove), and moved once the drive is back, when Move videos to the
  // drive when it is back is on. His words, 2026-09-24: "Should we make auto
  // move video once plugin? I think a toggle on off in setting will do." A
  // video saved in the vault by choice is never queued. The same move backs the
  // command for any note's video, the in-Obsidian form of move-videos-out.py.
  queueDriveMove(notePath, videoAbs) {
    const base = this.app.vault.adapter.getBasePath ? this.app.vault.adapter.getBasePath() : '';
    if (!base || !videoAbs.startsWith(base + path.sep)) return;
    const video = normalizePath(path.relative(base, videoAbs));
    const q = this.settings.driveMoveQueue || (this.settings.driveMoveQueue = []);
    if (q.some((e) => e.video === video)) return;
    q.push({ note: notePath, video });
    this.saveSettings();
    this.log('queued to move to the drive once it is plugged in:', video);
  }

  watchDriveQueue() {
    this.registerInterval(window.setInterval(() => this.moveQueuedVideos(false), 60 * 1000));
    this.moveQueuedVideos(false);
  }

  async moveQueuedVideos(manual) {
    const q = this.settings.driveMoveQueue || [];
    if (this.movingToDrive) return;
    if (!q.length) {
      if (manual) new Notice('No video is waiting for the drive.');
      return;
    }
    if (!manual && !this.settings.moveToDriveWhenBack) return;
    if (!manual && !this.automaticHere()) return;
    const root = String(this.settings.externalVideoFolder || '').trim();
    if (!root || !driveMounted(root)) {
      if (manual) new Notice(`${q.length} video(s) wait for ${root ? path.basename(driveOf(root) || root) : 'the drive'}, which is not plugged in.`);
      return;
    }
    this.movingToDrive = true;
    let moved = 0;
    try {
      for (const e of [...q]) {
        const r = await this.moveVideoToDrive(e.video).catch((err) => ({ ok: false, keep: true, why: err.message }));
        if (r.ok) moved++;
        if (!r.keep) this.settings.driveMoveQueue = this.settings.driveMoveQueue.filter((x) => x.video !== e.video);
        if (!r.ok) this.log(`not moved to the drive: ${e.video}: ${r.why}`);
      }
      await this.saveSettings();
    } finally {
      this.movingToDrive = false;
    }
    if (moved) new Notice(`Moved ${moved} video(s) from the vault to the drive.`);
  }

  // Copies the vault video to <Videos outside the vault>/<vault>/<its vault
  // folder>, checks the size, points every note whose media links it at the
  // file:/// address, removes its embed, adds the readable drive link and the
  // Media Extended library note for its subtitles, then sends the vault copy
  // to the trash. { ok, keep, why }: keep means try again later.
  async moveVideoToDrive(videoPath) {
    const tf = this.app.vault.getAbstractFileByPath(videoPath);
    if (!(tf instanceof TFile)) return { ok: false, keep: false, why: 'no longer in the vault' };
    const root = String(this.settings.externalVideoFolder || '').trim();
    if (!root || !path.isAbsolute(root)) return { ok: false, keep: true, why: 'Videos outside the vault is not set' };
    if (!driveMounted(root)) return { ok: false, keep: true, why: 'the drive is not plugged in' };
    const base = this.app.vault.adapter.getBasePath();
    const src = path.join(base, tf.path);
    const dest = path.join(root, this.app.vault.getName(), tf.path);
    if (fs.existsSync(dest)) return { ok: false, keep: false, why: `a file is already there: ${dest}` };
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
    if (fs.statSync(dest).size !== fs.statSync(src).size) {
      fs.unlinkSync(dest);
      return { ok: false, keep: true, why: 'the copy came out a different size' };
    }
    const url = pathToFileURL(dest).href;
    const linking = this.app.vault.getMarkdownFiles().filter((md) => {
      const raw = this.app.metadataCache.getFileCache(md)?.frontmatter?.media;
      const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
      return list.some((v) => {
        const m = String(v).match(/\[\[([^\]|#]+)/);
        return m && this.app.metadataCache.getFirstLinkpathDest(m[1].trim(), md.path)?.path === tf.path;
      });
    });
    if (!linking.length) {
      fs.unlinkSync(dest);
      return { ok: false, keep: false, why: 'no note links it any more' };
    }
    const esc = tf.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const md of linking) {
      await this.app.fileManager.processFrontMatter(md, (fm) => {
        const list = Array.isArray(fm.media) ? fm.media : [fm.media];
        const out = list.map((v) => {
          const m = String(v).match(/\[\[([^\]|#]+)/);
          return m && this.app.metadataCache.getFirstLinkpathDest(m[1].trim(), md.path)?.path === tf.path ? url : v;
        });
        fm.media = out.length === 1 ? out[0] : out;
      });
      await this.app.vault.process(md, (text) =>
        text.replace(new RegExp(`^!\\[\\[[^\\]]*${esc}(\\|[^\\]]*)?\\]\\][ \\t]*\\n?`, 'gm'), '')
      );
      await this.addDriveLinks(md, [dest]);
    }
    const stem = tf.basename;
    await this.writeLibraryNote(dest, this.subtitlesNamed(path.dirname(src), stem));
    await this.app.fileManager.trashFile(tf);
    this.log(`moved to the drive: ${tf.path} -> ${dest} (${linking.length} note(s) relinked)`);
    return { ok: true };
  }

  async moveActiveNoteVideo() {
    const file = this.app.workspace.getActiveFile();
    if (!file) return new Notice('Open a note first.');
    const raw = this.app.metadataCache.getFileCache(file)?.frontmatter?.media;
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const videos = list
      .map((v) => String(v).match(/\[\[([^\]|#]+)/))
      .filter(Boolean)
      .map((m) => this.app.metadataCache.getFirstLinkpathDest(m[1].trim(), file.path))
      .filter((f) => f && /^(mp4|webm|mkv|mov|avi|m4v)$/i.test(f.extension));
    if (!videos.length) return new Notice('This note has no video in the vault.');
    for (const v of videos) {
      const r = await this.moveVideoToDrive(v.path);
      new Notice(r.ok ? `Moved "${v.name}" to the drive.` : `"${v.name}" was not moved: ${r.why}.`, 10000);
    }
  }

  // ---- Where a downloaded video goes, and its subtitles in Media Extended ----
  // The same code in ARCH After Clipping and ARCH YT Playlists; change both
  // together. His ask, 2026-09-24: a choice in the download popup, a default
  // "based on vaults and materials" that the commands use too, and a way through
  // when 4T-HDD is not plugged in. The default is the drive when Videos outside
  // the vault is set, except in a folder listed in Keep videos in the vault:
  // the sensitive ones, like Psycho-history's Temp Videos, which his table in
  // backup-strategy/Videos Outside the Vault.md keeps on the Mac.
  keepsVideosInVault(notePath) {
    return String(this.settings.keepVideosInVault || '')
      .split(/[\n,]/)
      .map((s) => s.trim().replace(/^\/+|\/+$/g, ''))
      .filter(Boolean)
      .some((f) => notePath === f || notePath.startsWith(f + '/'));
  }

  // { place: 'drive' | 'vault', drive, mounted, fallback }. drive is the
  // drive's name when there is one to choose, null when the video can only go
  // in the vault. fallback marks "the vault only because the drive is not
  // plugged in": that video moves to the drive later, one chosen for the vault
  // never does.
  videoPlace(external, notePath) {
    if (!external) return { place: 'vault', drive: null, mounted: false, fallback: false };
    const drive = path.basename(driveOf(external) || external);
    const mounted = driveMounted(external);
    if (this.keepsVideosInVault(notePath)) return { place: 'vault', drive, mounted, fallback: false };
    if (!mounted) return { place: 'vault', drive, mounted, fallback: true };
    return { place: 'drive', drive, mounted, fallback: false };
  }

  // Media Extended 4.2.1 loads a video's subtitles from its library note: a
  // note with an mx-uid, `video: <file URL>` and `subtitles: ["[[<vault
  // .vtt>#lang=en]]"]`, the form its own Add resources button writes. Written
  // for a video saved on the drive, so its transcript works while the .vtt
  // stays in the vault, where Claude reads it and the backups keep it. Checked
  // by eye on 2026-09-24 ("Both show subtitles!"); a probe of the player's
  // native text tracks stayed empty meanwhile, so never test it that way.
  // backup-strategy/link-subtitles.py writes the same note for videos already
  // on the drive; change them together.
  async writeLibraryNote(videoAbs, subtitleAbs) {
    try {
      const base =
        this.app.vault.adapter && this.app.vault.adapter.getBasePath
          ? this.app.vault.adapter.getBasePath()
          : '';
      const stem = path.basename(videoAbs).replace(/\.[^.]+$/, '');
      const links = subtitleAbs
        .filter((p) => base && p.startsWith(base + path.sep))
        .map((p) => {
          const rel = normalizePath(path.relative(base, p));
          const lang = path.basename(p).slice(stem.length + 1).replace(/\.[^.]+$/, '');
          return `[[${rel}${lang ? '#lang=' + lang : ''}]]`;
        });
      if (!links.length) return;
      const url = pathToFileURL(videoAbs).href;
      const existing = this.app.vault.getMarkdownFiles().find((f) => {
        const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
        return fm && fm['mx-uid'] && fm.video === url;
      });
      if (existing) {
        await this.app.fileManager.processFrontMatter(existing, (fm) => {
          const have = Array.isArray(fm.subtitles) ? fm.subtitles : fm.subtitles ? [fm.subtitles] : [];
          const add = links.filter((l) => !have.includes(l));
          if (add.length) fm.subtitles = [...have, ...add];
        });
        this.log('subtitles listed in the existing Media Extended library note:', existing.path);
        return;
      }
      const abc = 'abcdefghijklmnopqrstuvwxyz';
      const pick = (s) => s[Math.floor(Math.random() * s.length)];
      let uid = pick(abc);
      for (let i = 0; i < 23; i++) uid += pick(abc + '0123456789');
      const folder = 'media-lib';
      if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder).catch(() => {});
      const note = `${folder}/url-${uid.slice(0, 8)}.md`;
      await this.app.vault.create(
        note,
        `---\nmx-uid: ${uid}\nvideo: ${url}\nsubtitles:\n${links.map((l) => `  - "${l}"`).join('\n')}\n---\n`
      );
      this.log('Media Extended library note written, so the subtitles load:', note);
    } catch (e) {
      console.warn('[ARCH] could not write the Media Extended library note:', e);
    }
  }

  // The `media` property of a video outside the vault shows "4T-HDD: <file
  // name>" instead of its long %-encoded file:/// address (1.14.0). His words,
  // 2026-09-24: "what I mean is to have readable name in the property, not in the
  // note's body." The value must stay the bare URL: Media Extended reads nothing
  // else, and a labelled link in a property opens in the web browser. So this only
  // changes what is drawn. Obsidian has no API for the properties panel; it draws a
  // link as .metadata-link-inner[data-href], with a separate pencil for editing.
  // **Its text must stay the address:** Media Extended 4.2.1 opens a click on a
  // `media`/`video`/`audio` property only when the clicked element's textContent
  // is a URL; replacing the text with the label sent the click to the web
  // browser (tested 2026-09-24). So the text is hidden by CSS and the label drawn
  // by a ::before pseudo-element, which textContent does not include and which
  // leaves the element itself as the click target. Editing and the stored value
  // are untouched. If Obsidian renames those classes the raw address simply shows again.
  // Only After Clipping does this, not YT Playlists too, so the two never draw over
  // each other; After Clipping is enabled in every vault.
  watchDriveLabels() {
    const SEL = '.metadata-property[data-property-key="media"] [data-href^="file:///Volumes/"]';
    const label = (el) => {
      const href = el.getAttribute('data-href') || '';
      let p;
      try {
        p = decodeURIComponent(href.replace(/^file:\/\//i, '').split('#')[0]);
      } catch (_) {
        return;
      }
      const parts = p.split('/');
      const text = `${parts[2]}: ${parts[parts.length - 1]}`;
      if (el.getAttribute('data-arch-drive-label') !== text) el.setAttribute('data-arch-drive-label', text);
      if (!el.classList.contains('arch-drive-label')) el.classList.add('arch-drive-label');
    };
    const scan = (root) => {
      if (root.matches && root.matches(SEL)) label(root);
      if (root.querySelectorAll) root.querySelectorAll(SEL).forEach(label);
    };
    // The property's own size is 0.875em of this element, which is set to 0 to
    // hide the address, so the label is sized from the note's text size.
    const style = document.createElement('style');
    style.id = 'arch-after-clipping-drive-labels';
    style.textContent =
      '.metadata-link-inner.arch-drive-label{font-size:0 !important;}' +
      '.metadata-link-inner.arch-drive-label::before{content:attr(data-arch-drive-label) !important;' +
      'font-size:calc(var(--font-text-size, 16px) * 0.875) !important;display:inline !important;}';
    document.head.appendChild(style);
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        // Obsidian redraws a property by swapping the text inside the same
        // element, so a changed element is checked as well as a new one.
        if (m.type === 'attributes') scan(m.target);
        else {
          if (m.target.nodeType === 1 && m.target.matches(SEL)) label(m.target);
          for (const n of m.addedNodes) if (n.nodeType === 1) scan(n);
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-href'] });
    this.register(() => {
      obs.disconnect();
      style.remove();
      document.querySelectorAll('.arch-drive-label').forEach((el) => el.classList.remove('arch-drive-label'));
    });
    scan(document.body);
  }



  // Videos outside the vault are played by Media Extended, which reads the
  // file:/// URL in `media`. That was tested on 4.2.1 only, the version Hoang
  // Anh keeps on purpose ("4.2.5 were bugged from my experience"), so the log
  // says which version is running. Only playback depends on it: the
  // "already downloaded?" check reads the disk, not Media Extended.
  checkMediaExtended() {
    if (!String(this.settings.externalVideoFolder || '').trim()) return;
    const TESTED = '4.2.1';
    const plugins = this.app.plugins || {};
    const mx = plugins.manifests && plugins.manifests['media-extended'];
    const on = !!(plugins.enabledPlugins && plugins.enabledPlugins.has('media-extended'));
    if (!mx) this.log(`Media Extended is not installed: file:/// videos will open outside Obsidian (tested with ${TESTED})`);
    else if (!on) this.log(`Media Extended ${mx.version} is installed but turned off: file:/// videos will open outside Obsidian`);
    else if (mx.version === TESTED) this.log(`Media Extended ${mx.version}, the version videos outside the vault were tested with`);
    else this.log(`Media Extended ${mx.version}, not the tested ${TESTED}: check that file:/// videos still play`);
  }

  // Runs relink-videos.py, which rewrites every note's file:/// video link whose
  // file moved or was renamed on the drive, in every vault, and logs each change
  // in the backup's Folder History.md. It already runs after each backup; this
  // is the button for right after moving videos in Finder. The script is the
  // one copy of that logic, so the plugin only starts it.
  async relinkDriveVideos() {
    let script = String(this.settings.relinkScript || '').trim().replace(/^~(?=\/)/, os.homedir());
    if (!script) {
      const usual = path.join(os.homedir(), 'Documents/backup-strategy/relink-videos.py');
      if (fs.existsSync(usual)) {
        script = this.settings.relinkScript = usual;
        await this.saveSettings();
        this.log(`relink script found at ${usual}, saved in settings`);
      }
    }
    if (!script || !fs.existsSync(script)) {
      this.log(`relink: no script at "${script}"`);
      return new Notice('Relink script not found. Set it under "Relink script" in ARCH After Clipping\'s settings.');
    }
    const notice = new Notice('Relinking videos on the outside drive…', 0);
    this.log(`relink: running ${script}`);
    try {
      const r = await this.runProcess('/usr/bin/python3', [script], { timeoutMs: 10 * 60 * 1000 });
      const last = r.stdout.trim().split('\n').pop() || '';
      this.log(`relink: exit ${r.code}: ${last}${r.stderr ? '\n' + r.stderr : ''}`);
      notice.hide();
      new Notice(r.code === 0 ? `Relink videos: ${last}` : `Relink videos failed (exit ${r.code}). See the console.`, 10000);
    } catch (e) {
      notice.hide();
      this.log(`relink: could not start: ${e.message}`);
      new Notice('Relink videos could not start python3. See the console.');
    }
  }

  log(...args) {
    console.log('[ArchAfterClipping]', ...args);
  }

  // Versions 1.7.0 to 1.10.0 wrote arch-video blocks and thumbnail links. Nothing
  // renders those now, so they would sit in notes as raw text.
  async cleanVideoBlocks() {
    let touched = 0;
    for (const file of this.app.vault.getMarkdownFiles()) {
      let content;
      try {
        content = await this.app.vault.read(file);
      } catch (_) {
        continue;
      }
      if (!/```arch(ive)?-video/.test(content)) continue;

      const { fm, body } = splitFrontmatter(content);
      // A well-formed block names the file; a malformed one from the 1.9.0 bug
      // has an embed inside it instead, which still identifies the video.
      const named = (body.match(/^video:\s*(.+)$/m) || [])[1];
      const embedded = (body.match(/!\[\[([^\]|]+\.(?:mp4|webm|mkv|mov|avi))/i) || [])[1];
      const ref = (named || embedded || '').trim();
      const target =
        (ref &&
          (this.app.vault.getAbstractFileByPath(normalizePath(ref)) ||
            this.app.metadataCache.getFirstLinkpathDest(ref, file.path))) ||
        null;
      if (ref && !target) this.log('could not resolve', ref, 'in', file.path);
      const replacement = target
        ? `![[${this.app.metadataCache.fileToLinktext(target, file.path)}]]`
        : '';

      const cleaned = this.stripMediaEmbeds(body, target || null);
      const next = fm + '\n' + (replacement ? replacement + '\n\n' : '') + cleaned;
      if (next !== content) {
        await this.app.vault.process(file, () => next);
        touched++;
        this.log('cleaned', file.path);
      }
    }
    new Notice(
      touched
        ? `Replaced video blocks in ${touched} note${touched === 1 ? '' : 's'}.`
        : 'No old video blocks found.',
      8000
    );
  }

  // Reports what is actually in the rendered note, because a poster can only be
  // applied to an element this plugin can see. Another plugin swapping the embed
  // for its own player, or rendering into a shadow root, leaves nothing to find.
  diagnoseEmbed() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice('Open a note in a markdown view first.');
      return;
    }
    const root = view.contentEl;
    const lines = [`Note: ${view.file ? view.file.path : '(none)'}`];
    lines.push(`Mode: ${view.getMode ? view.getMode() : 'unknown'}`);

    const count = (sel) => root.querySelectorAll(sel).length;
    lines.push('');
    lines.push(`<video> elements:  ${count('video')}`);
    lines.push(`<audio> elements:  ${count('audio')}`);
    lines.push(`<webview>:         ${count('webview')}`);
    lines.push(`<iframe>:          ${count('iframe')}`);
    lines.push(`<img>:             ${count('img')}`);

    const custom = new Set();
    root.querySelectorAll('*').forEach((el) => {
      const tag = el.tagName.toLowerCase();
      if (tag.includes('-')) custom.add(tag);
      if (el.shadowRoot) custom.add(tag + ' (shadow root)');
    });
    lines.push('');
    lines.push(
      custom.size
        ? `Custom elements present: ${[...custom].join(', ')}`
        : 'No custom elements, so nothing is replacing the native player.'
    );

    const videos = [...root.querySelectorAll('video')];
    if (videos.length) {
      lines.push('');
      for (const v of videos) {
        const src = (v.getAttribute('src') || '').split('/').pop() || '(no src)';
        lines.push(`video: ${decodeURIComponent(src).slice(0, 60)}`);
        lines.push(`  poster: ${v.getAttribute('poster') ? 'set' : 'none'}`);
      }
    } else {
      lines.push('');
      lines.push('No <video> element exists in this view.');
      lines.push('A media player plugin has most likely replaced the embed with its own.');
    }

    console.log('[ArchAfterClipping] embed diagnosis\n' + lines.join('\n'));
    new InspectModal(this.app, lines).open();
  }

  // Every shape this plugin has ever written for a media file, so a re-run
  // replaces the old one instead of leaving a second beside it. This also
  // clears the arch-video blocks written by 1.7.0 to 1.10.0, which no longer render.
  stripMediaEmbeds(body, mediaFile) {
    const name = mediaFile ? mediaFile.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : null;
    let out = body
      // an arch-video block, well-formed or not
      .replace(/```arch(ive)?-video[\s\S]*?```[ \t]*\n?/g, '')
      // a stray fence left by an earlier malformed write
      .replace(/^```arch(ive)?-video[ \t]*\n?/gm, '');

    out = out
      .split('\n')
      .filter((line) => {
        const l = line.trim();
        if (!l) return true;
        // a remote video embed
        if (/^!?\[[^\]]*\]\(https?:\/\/[^)]*(?:youtube\.com|youtu\.be)[^)]*\)$/i.test(l)) return false;
        // this file embedded as a wikilink
        if (name && new RegExp(`^!\\[\\[[^\\]]*${name}(\\|[^\\]]*)?\\]\\]$`, 'i').test(l)) return false;
        // this file behind a thumbnail link; greedy, because these filenames
        // contain parentheses and a lazy match stops inside them
        if (name && new RegExp(`^\\[!\\[.*\\]\\(.*\\)\\]\\(.*${name}.*\\)$`, 'i').test(l)) return false;
        return true;
      })
      .join('\n');

    return out.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
  }

  // Writes a normal embed. Any legacy archive-video block is converted, and a
  // remote YouTube embed is dropped since the local file replaces it.
  async writeMediaEmbed(file, videoPath, audioPath) {
    const target = videoPath || audioPath;
    if (!target) return;

    // yt-dlp wrote this file behind Obsidian's back, so it may not be indexed
    // yet. An embed pointing at an unindexed file renders as an unresolved link,
    // and clicking one asks Obsidian to create it.
    const tf = await this.waitForVaultFile(target);
    if (!tf) {
      console.warn('[ArchAfterClipping] media file never appeared in the vault index:', target);
      return;
    }

    let link = this.app.metadataCache.fileToLinktext(tf, file.path);
    // The short form is ambiguous when two files share a name, so confirm it
    // resolves back to this exact file and fall back to the full path if not.
    const resolved = this.app.metadataCache.getFirstLinkpathDest(link, file.path);
    if (!resolved || resolved.path !== tf.path) {
      this.log('short link was ambiguous, using the full path:', tf.path);
      link = tf.path;
    }
    const embed = `![[${link}]]`;

    const content = await this.app.vault.read(file);
    const { fm, body } = splitFrontmatter(content);

    const cleaned = this.stripMediaEmbeds(body, tf);

    if (embed && cleaned.includes(embed)) {
      if (cleaned !== body) await this.app.vault.process(file, () => fm + '\n' + cleaned);
      return;
    }

    await this.app.vault.process(file, () => fm + '\n' + embed + '\n\n' + cleaned);
    this.log('embedded', link);
  }

  /* ---------------- scope + entry points ---------------- */

  // Notes that arrived while the plugin was not yet listening. Only a note
  // with a source URL qualifies: the live listener takes any new note because
  // it saw it being born, but here the only evidence is a young file, and a
  // young file without a URL is a note the user just made by hand.
  async catchUpStartupClips() {
    if (!this.settings.enabled) return;
    if (!this.automaticHere()) return;
    const cutoff = Date.now() - this.settings.graceSeconds * 1000;
    const young = this.app.vault.getMarkdownFiles().filter((f) => (f.stat?.ctime ?? 0) >= cutoff);
    for (const file of young) {
      // Re-checked per file: the live listener may have taken it during an await.
      if (this.seenThisSession.has(file.path)) continue;
      const content = await this.app.vault.cachedRead(file).catch(() => '');
      const url =
        this.resolveSourceUrl(this.app.metadataCache.getFileCache(file)?.frontmatter) ||
        this.extractUrlFromRawFrontmatter(content);
      if (!url) continue;
      this.log('clipped before the plugin was listening, catching up:', file.path);
      this.onFileCreated(file);
    }
  }

  onFileCreated(file) {
    if (!this.settings.enabled) return;
    if (file.extension !== 'md') return;
    this.seenThisSession.add(file.path);

    // Second guard against a re-index replay: a genuine clip is seconds old.
    const age = (Date.now() - (file.stat?.ctime ?? 0)) / 1000;
    if (age > this.settings.graceSeconds) {
      this.log('skipping, file is', Math.round(age), 's old:', file.path);
      return;
    }

    // "video.webm.md" is what Obsidian leaves behind when an unresolved media
    // embed gets clicked. It is not a clip and must not go through the pipeline.
    if (/\.(mp4|webm|mkv|mov|avi|mp3|m4a|opus|flac|wav|ogg|jpe?g|png|gif|webp|vtt|srt)$/i.test(
        file.basename)) {
      this.log('skipping, this looks like a stray note for a media file:', file.path);
      return;
    }

    if (!this.inScope(file)) {
      this.log('skipping, out of scope:', file.path);
      return;
    }

    this.processNote(file, false);
  }

  inScope(file) {
    const p = file.path;
    const under = (folder) => p === folder || p.startsWith(folder + '/');

    const excluded = this.settings.excludeFolders.map(trimSlashes).filter(Boolean);
    if (excluded.some(under)) return false;

    if (this.settings.watchAllFolders) return true;

    const included = this.settings.clipFolders.map(trimSlashes).filter(Boolean);
    if (included.length === 0) return true;
    return included.some(under);
  }

  // Images are scoped separately from everything else. inScope decides whether
  // the plugin touches the note at all; this decides only whether images are
  // fetched, so media keeps running vault-wide.
  imagesInScope(file) {
    const folders = (this.settings.imageFolders || []).map(trimSlashes).filter(Boolean);
    if (!folders.length) return true; // empty list means every folder
    const p = file.path;
    return folders.some((f) => p === f || p.startsWith(f + '/'));
  }

  // The one entry point for the four Download ... for this note commands.
  // A note owned by ARCH YT Playlists is handed to that plugin with the choice
  // made, so a video lands in its playlist's own media folder beside the rest
  // and dl-all stays right; a playlist note downloads the whole playlist. When
  // YT Playlists is not enabled here, a video note is downloaded by this plugin
  // and a playlist note is refused. A note recognised by tag (a channel note)
  // is always refused: its url is a channel address, and yt-dlp given one
  // downloads the whole channel.
  async downloadForNote(file, mode) {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
    const content = await this.app.vault.read(file).catch(() => '');
    const has = (key) => (fm && fm[key] !== undefined) || this.rawHasKey(content, key);
    const tagged = (this.settings.otherArchTags || []).find(
      (tag) => this.fmHasTag(fm, tag) || this.rawHasTag(content, tag)
    );
    if (tagged) {
      this.log(`not downloading ${file.path}: tagged ${tagged}, another ARCH plugin's note`);
      new Notice(`"${file.basename}" is tagged ${tagged}, so there is nothing here to download.`, 8000);
      return;
    }
    const yt = this.app.plugins?.getPlugin?.('arch-yt-playlists');
    if (has('dl-all')) {
      if (yt && typeof yt.downloadWholePlaylist === 'function') {
        this.log(`handing playlist note ${file.path} to ARCH YT Playlists as ${mode}`);
        return yt.downloadWholePlaylist(file, mode);
      }
      new Notice('This is an ARCH YT Playlists playlist note. Enable that plugin to download it.', 10000);
      return;
    }
    if (has('yt-playlist') && yt && typeof yt.bulkDownload === 'function') {
      this.log(`handing video note ${file.path} to ARCH YT Playlists as ${mode}`);
      return yt.bulkDownload([file], mode);
    }
    return this.doMedia(file, null, true, null, mode);
  }

  withActiveNote(fn) {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== 'md') {
      new Notice('Open a markdown note first.');
      return;
    }
    return Promise.resolve(fn(file)).catch((e) => {
      console.error('[ArchAfterClipping]', e);
      new Notice('Clip Archiver hit an error. Open the developer console for details.');
    });
  }

  archiveActiveNote() {
    return this.withActiveNote((file) => this.processNote(file, true));
  }

  /* ---------------- the pipeline ---------------- */

  async processNote(file, manual) {
    if (this.inFlight.has(file.path)) {
      if (manual) new Notice('This note is already being archived.');
      return;
    }
    this.inFlight.add(file.path);
    const t0 = Date.now();
    const lap = (label) => this.log(`${label}: ${Date.now() - t0}ms`);

    try {
      const content = await this.waitForNoteContent(file);
      lap('note content ready');

      if (!content.trim()) {
        this.log('nothing to archive, the note is empty:', file.path);
        return;
      }
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? null;

      const earlyUrl =
        this.resolveSourceUrl(fm) || this.extractUrlFromRawFrontmatter(content);
      const alreadyDone =
        this.wasProcessed(earlyUrl || file.path) ||
        // The same property the media step writes: a note that says it has been
        // downloaded is not downloaded again.
        (fm && fm[this.settings.markDownloadedKey] === true) ||
        this.rawFlagIsTrue(content, this.settings.markDownloadedKey) ||
        // Notes clipped before 1.0.0 carry 'archived' instead. The setting that
        // named it is gone, but the property is still honoured: re-downloading
        // media for a note that already has its files is the one thing the
        // marker exists to prevent.
        (fm && fm[LEGACY_DONE_KEY] === true) ||
        this.rawFlagIsTrue(content, LEGACY_DONE_KEY);
      // Two sources, because either one can lag behind a note created a moment ago.
      const fromCache = this.resolveSourceUrl(fm);
      const fromRaw = this.extractUrlFromRawFrontmatter(content);
      const sourceUrl = fromCache || fromRaw;

      if (!sourceUrl) {
        const names = this.settings.frontmatterUrlKeys.join(', ');
        console.warn(
          `[ArchAfterClipping] no source URL in ${file.path}. Looked at: ${names}, then every property. ` +
            `Content length ${content.length}, metadata cache ${fm ? 'ready' : 'not ready'}.`
        );
        if (manual) {
          new Notice(
            `No source URL in this note. Run "Inspect this note" to see what Clip Archiver reads.`,
            12000
          );
        }
      }
      this.log('processing', file.path, '->', sourceUrl || '(no url)', fromCache ? '' : '(from raw frontmatter)');

      // A second note for a page you already clipped is worth mentioning, not
      // acting on. This used to trash one of them, justified by "otherwise the
      // video downloads twice" -- but the processed-URL record already prevents
      // that, so trashing was solving a solved problem with the only
      // irreversible action in the plugin. Duplicate notes are visible in the
      // file list and easy to remove by hand; duplicate media is not, and that
      // is handled by image hashing and the record instead.
      if (sourceUrl && this.settings.duplicateAction !== 'ignore') {
        const twin = this.findExistingClip(file, sourceUrl);
        if (twin) {
          new Notice(`This page is already clipped as "${twin.basename}".`, 10000);
          this.log('duplicate of', twin.path, '- both left in place');
        }
      }

      // Several markers, because each plugin's note types carry different ones.
      // ARCH YT Playlists: yt-playlist on a video note, dl-all on a playlist
      // note -- checking only the first meant playlist notes were still being
      // renamed on every sync.
      //
      // ARCH X Archive: x-author and x-name, on both its note types. Without
      // these, every X post note got a full yt-dlp metadata probe -- about three
      // seconds each -- and media downloaded into the profile folder. At that
      // plugin's intended scale, a few hundred profiles, that is tens of
      // thousands of probes nobody asked for.
      //
      // ARCH YT Playlists' channel notes carry no marker property -- their
      // frontmatter is url, icon, banner, tags and nothing else -- so they are
      // recognised by TAG. Left alone, a channel note's url would send yt-dlp
      // after an entire channel.
      const ownedByOtherArch =
        (this.settings.otherArchKeys || []).some(
          (key) => (fm && fm[key] !== undefined) || this.rawHasKey(content, key)
        ) ||
        (this.settings.otherArchTags || []).some(
          (tag) => this.fmHasTag(fm, tag) || this.rawHasTag(content, tag)
        );
      if (!manual && this.settings.skipOtherArchNotes && ownedByOtherArch) {
        this.log('owned by another ARCH plugin, leaving it alone:', file.path);
        return;
      }

      const seenBefore = !manual && alreadyDone;
      if (seenBefore) {
        this.log('already in the archived record - media will be skipped, the rest still runs:', file.path);
      }

      // One metadata lookup answers both questions: what to rename the note to,
      // and whether there is anything here to download. It used to fire the
      // popup immediately, in parallel, which is faster but prompts on any URL
      // whose *host* carries video — an x.com profile, a subreddit, a channel
      // page. Those have no formats, so the popup was noise. YouTube still
      // answers from oEmbed in milliseconds; other hosts pay for a yt-dlp call.
      let meta = null;
      if (sourceUrl && this.looksLikeVideo(sourceUrl)) {
        meta = await this.fetchChannelAndTitle(sourceUrl);
        lap('metadata done');
        if (!meta || !meta.hasFormats) {
          this.log('no downloadable media at', sourceUrl, '- skipping rename and the download prompt');
        }
      }

      if (this.settings.renameNoteFromMedia && meta && meta.hasFormats) {
        const name = this.noteNameFromMeta(meta, file);
        if (name) await this.renameNoteTo(file, name);
        lap('rename done');
      }

      if (this.settings.fillVideoLength && meta && meta.hasFormats) {
        await this.fillVideoLength(file, sourceUrl, meta, false);
        lap('length done');
      }

      let pendingMode = null;
      if (
        this.settings.downloadVideo &&
        this.settings.askDownloadMode &&
        !this.sessionMode &&
        sourceUrl &&
        meta &&
        meta.hasFormats &&
        !this.settings.probeUnknownUrls &&
        this.settings.videoFolder
      ) {
        pendingMode = this.askMode(file, sourceUrl);
      }

      // 1. Images first: they only swap URLs for local links, so anything that
      //    runs later just carries those links along as ordinary text.
      // Running it by hand is already a statement of intent, so the folder
      // list only gates the automatic pass.
      if (this.settings.downloadImages && (manual || this.imagesInScope(file))) {
        await this.doImages(file, sourceUrl, manual);
        lap('images done');
      } else if (this.settings.downloadImages) {
        this.log('images skipped, outside the image folders:', file.path);
      }

      // 2. Transform second: it restructures the whole body, so it must not run
      //    before the image rewrite or it would have to find URLs inside callouts.
      //    It re-resolves the URL itself and does nothing without one.
      if (this.settings.enableTransform) {
        await this.doTransform(file, sourceUrl, manual);
        lap('transform done');
      }

      // 3. Record it as done. This used to write a property into the note, which
      //    meant every clip carried a marker you had to delete by hand. The
      //    record now lives in the plugin's own data instead.
      await this.rememberProcessed(sourceUrl || file.path);

      // 4. Media last: it is the slow, network-bound, interactive part.
      // The metadata lookup already answered this authoritatively. Without
      // passing that down, doMedia falls back to the same host allowlist and
      // prompts anyway — just later, after the images.
      const knownNoMedia = !!(
        sourceUrl && this.looksLikeVideo(sourceUrl) && (!meta || !meta.hasFormats)
      );
      if (this.settings.downloadVideo && knownNoMedia) {
        this.log('media skipped, the metadata lookup found no formats:', sourceUrl);
      } else if (this.settings.downloadVideo && seenBefore) {
        this.log('media skipped, already downloaded once - use "Forget this note" to allow it again:', sourceUrl);
      } else if (this.settings.downloadVideo) {
        await this.doMedia(file, sourceUrl, manual, pendingMode);
      }
    } catch (err) {
      console.error('[ArchAfterClipping] pipeline error on', file.path, err);
      new Notice('Clip Archiver failed on this note. Open the developer console for details.');
    } finally {
      this.inFlight.delete(file.path);
    }
  }

  // Waits for the note to actually be on disk. The "create" event can arrive
  // before the content is flushed, and the metadata cache is parsed later still,
  // so neither one is trustworthy on its own at this moment.
  async waitForNoteContent(file, timeoutMs = 8000) {
    const start = Date.now();
    let content = '';
    while (Date.now() - start < timeoutMs) {
      try {
        content = await this.app.vault.read(file);
      } catch (_) {
        content = '';
      }
      if (content.trim()) {
        // No frontmatter fence at all: nothing further is coming.
        if (!content.startsWith('---')) return content;
        // Frontmatter has opened; wait for the closing fence before trusting it.
        if (splitFrontmatter(content).fm) return content;
      } else if (Date.now() - start > 2000) {
        // Still empty after two seconds means it was created empty, not slowly.
        return content;
      }
      await sleep(100);
    }
    this.log('timed out waiting for content on', file.path);
    return content;
  }

  // Reads the URL straight out of the raw frontmatter block. Used as a backstop
  // when the metadata cache has not caught up with a note created moments ago.
  // Is this property present in the raw frontmatter, cache or no cache?
  // Tags as the metadata cache presents them: a list, a comma string, with or
  // without '#'. Also covers the singular 'tag' key, which Obsidian reads too.
  fmHasTag(fm, tag) {
    if (!fm) return false;
    const want = String(tag || '').replace(/^#/, '').toLowerCase();
    const raw = [].concat(fm.tags ?? [], fm.tag ?? []);
    return raw
      .flatMap((v) => String(v ?? '').split(','))
      .some((v) => v.trim().replace(/^#/, '').toLowerCase() === want);
  }

  // Same question asked of the raw text, for a note the cache has not indexed
  // yet: a "tags:" block with "- tag" items, or an inline "tags: [a, b]".
  rawHasTag(content, tag) {
    const block = String(content || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!block) return false;
    const m = block[1].match(/^tags?\s*:(.*)$((?:\r?\n[ \t]+-.*)*)/m);
    if (!m) return false;
    const want = String(tag || '').replace(/^#/, '').toLowerCase();
    const items = (m[1] + m[2])
      .split(/[\n,[\]]/)
      .map((x) => x.trim().replace(/^-\s*/, '').replace(/^["']|["']$/g, '').replace(/^#/, '').toLowerCase());
    return items.includes(want);
  }

  rawHasKey(content, key) {
    const block = String(content || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!block) return false;
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${esc}\\s*:`, 'm').test(block[1]);
  }

  extractUrlFromRawFrontmatter(content) {
    const { fm } = splitFrontmatter(content || '');
    if (!fm) return null;

    for (const key of this.settings.frontmatterUrlKeys) {
      const re = new RegExp(`^["']?${escapeRegExp(key)}["']?\\s*:\\s*(.+)$`, 'im');
      const m = fm.match(re);
      if (m) {
        const hit = this.extractUrl(m[1]);
        if (hit) return hit;
      }
    }

    const imageKeys = new Set(this.settings.frontmatterImageKeys);
    for (const line of fm.split('\n')) {
      const km = line.match(/^["']?([A-Za-z0-9_\- ]+)["']?\s*:/);
      if (km && imageKeys.has(km[1].trim())) continue;
      const hit = this.extractUrl(line);
      if (hit) return hit;
    }
    return null;
  }

  rawFlagIsTrue(content, key) {
    const { fm } = splitFrontmatter(content || '');
    if (!fm) return false;
    return new RegExp(`^["']?${escapeRegExp(key)}["']?\\s*:\\s*true\\s*$`, 'im').test(fm);
  }

  // Handles a bare URL, a markdown link like [Gemini](https://...), and <https://...>.
  extractUrl(value) {
    if (Array.isArray(value)) {
      for (const v of value) {
        const hit = this.extractUrl(v);
        if (hit) return hit;
      }
      return null;
    }
    if (typeof value !== 'string') return null;
    const m = value.match(BARE_URL_RE);
    return m ? m[0].replace(/[.,;]+$/, '') : null;
  }

  // Web Clipper's default template calls the address "source"; custom templates
  // often rename it. Try the configured names, then fall back to any property
  // that holds a URL, so a template nobody told us about still works.
  resolveSourceUrl(fm) {
    if (!fm) return null;

    for (const key of this.settings.frontmatterUrlKeys) {
      const hit = this.extractUrl(fm[key]);
      if (hit) return hit;
    }

    const imageKeys = new Set(this.settings.frontmatterImageKeys);
    for (const [key, value] of Object.entries(fm)) {
      if (imageKeys.has(key)) continue; // a cover image is not the source page
      const hit = this.extractUrl(value);
      if (hit) {
        this.log(`no configured URL property matched; using "${key}"`);
        return hit;
      }
    }
    return null;
  }

  // Another note already holding this address, ignoring the one we just made.
  findExistingClip(file, url) {
    const normalise = (u) => {
      try {
        const parsed = new URL(u);
        const id = parsed.searchParams.get('v');
        // A YouTube address varies by tracking parameters; the id does not.
        if (id) return `yt:${id}`;
        const short = parsed.hostname.endsWith('youtu.be') ? parsed.pathname.slice(1) : null;
        if (short) return `yt:${short}`;
        return (parsed.hostname + parsed.pathname).replace(/\/$/, '').toLowerCase();
      } catch (_) {
        return String(u).toLowerCase();
      }
    };
    const wanted = normalise(url);
    for (const other of this.app.vault.getMarkdownFiles()) {
      if (other.path === file.path) continue;
      const fm = this.app.metadataCache.getFileCache(other)?.frontmatter;
      if (!fm) continue;
      const otherUrl = this.resolveSourceUrl(fm);
      if (otherUrl && normalise(otherUrl) === wanted) return other;
    }
    return null;
  }

  // A rolling record of what has been archived, kept in the plugin's data so
  // notes stay clean. Capped, because it only needs to outlive a re-index.
  async rememberProcessed(key) {
    if (!key) return;
    const list = this.settings.processedUrls;
    if (list.includes(key)) return;
    list.push(key);
    if (list.length > 2000) list.splice(0, list.length - 2000);
    await this.saveSettings();
  }

  // The record is keyed on the source URL, so a re-clip of the same page is
  // skipped wherever it lands. Without this there is no way back out of that
  // record short of editing data.json by hand.
  async forgetNote(file) {
    const content = await this.app.vault.read(file);
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
    const url = this.resolveSourceUrl(fm) || this.extractUrlFromRawFrontmatter(content);
    const keys = [url, file.path].filter(Boolean);
    const before = this.settings.processedUrls.length;
    this.settings.processedUrls = this.settings.processedUrls.filter((k) => !keys.includes(k));
    const removed = before - this.settings.processedUrls.length;

    // The downloaded marker blocks the note on its own, so clearing the URL
    // without clearing the property would leave it stuck.
    let hadFlag = false;
    const doneKeys = [this.settings.markDownloadedKey, LEGACY_DONE_KEY].filter(Boolean);
    if (fm && doneKeys.some((k) => fm[k] === true)) {
      hadFlag = true;
      await this.setFrontmatter(file, (f) => {
        for (const k of doneKeys) delete f[k];
      });
    }

    await this.saveSettings();
    if (removed || hadFlag) {
      this.log('forgot', keys.join(', '), hadFlag ? '(and cleared the legacy property)' : '');
      new Notice('Forgotten. This page will be archived again next time it is clipped.');
    } else {
      new Notice('This note was not in the archived record.');
    }
  }

  wasProcessed(key) {
    return !!key && this.settings.processedUrls.includes(key);
  }

  async setFrontmatter(file, mutate) {
    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        const before = Object.keys(fm);
        mutate(fm);
        this.applyOrder(fm, before);
      });
    } catch (e) {
      this.log('could not write frontmatter on', file.path, e);
    }
  }

  // Key order is insertion order and that is what gets serialised, so the
  // object is rebuilt with each key this write ADDED slotted in by the
  // configured order -- after the nearest listed key above it that the note
  // has, else before the nearest listed key below it, else at the end. Keys
  // the note already had are never moved: this plugin clips every kind of
  // page, and the list is a video note's shape, so applying it to a clipped
  // article dragged url, published and tags to the top of a template that
  // had them elsewhere. The same default as YT Playlists, so media and dl-ed
  // land in the same place whichever plugin downloaded a video.
  applyOrder(fm, before) {
    const wanted = splitList(this.settings.frontmatterOrder);
    if (!wanted.length) return fm;
    const had = new Set(before || Object.keys(fm));
    const keys = Object.keys(fm).filter((k) => had.has(k));
    const added = Object.keys(fm).filter((k) => !had.has(k));
    for (const key of added) {
      const rank = wanted.indexOf(key);
      let at = keys.length;
      if (rank >= 0) {
        const above = wanted.slice(0, rank).reverse().find((k) => keys.includes(k));
        const below = wanted.slice(rank + 1).find((k) => keys.includes(k));
        if (above !== undefined) at = keys.indexOf(above) + 1;
        else if (below !== undefined) at = keys.indexOf(below);
      }
      keys.splice(at, 0, key);
    }
    const ordered = {};
    for (const key of keys) ordered[key] = fm[key];
    for (const key of Object.keys(fm)) delete fm[key];
    Object.assign(fm, ordered);
    return fm;
  }

  /* ---------------- images ---------------- */

  async doImages(file, sourceUrl, notify = false) {
    const content = await this.app.vault.read(file);
    const { fm, body } = splitFrontmatter(content);

    const cachedFm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const referer = sourceUrl || this.resolveSourceUrl(cachedFm);

    // Collect candidate URLs from the body. A markdown image pointing at a video
    // page is a thumbnail placeholder, not a picture, so don't waste a request.
    const urls = new Set();
    const addCandidate = (u) => {
      if (u && !this.looksLikeVideo(u)) urls.add(u);
    };
    for (const m of body.matchAll(MD_IMAGE_RE)) addCandidate(m[2]);
    for (const m of body.matchAll(HTML_IMG_RE)) addCandidate(m[1] || m[2]);

    // ...and from the frontmatter image-ish properties.
    const fmTargets = [];
    if (this.settings.rewriteFrontmatterImages) {
      for (const key of this.settings.frontmatterImageKeys) {
        const raw = cachedFm[key];
        if (typeof raw !== 'string') continue;
        const u = this.extractUrl(raw);
        if (!u || u === referer) continue;
        if (this.settings.frontmatterUrlKeys.includes(key)) continue;
        // A video page address is not a cover image, and fetching it wastes a request.
        if (this.looksLikeVideo(u)) continue;
        // Many cover images have no file extension, so don't judge by the address.
        // fetchImage rejects anything the server doesn't serve as an image.
        urls.add(u);
        fmTargets.push({ key, url: u });
      }
    }

    if (urls.size === 0) {
      if (notify) new Notice('No external images found in this note.');
      return;
    }

    const list = [...urls];
    const results = await runWithConcurrency(
      list.map((url) => async () => ({ url, ...(await this.fetchImage(url, referer)) })),
      IMAGE_CONCURRENCY
    );

    const urlToFile = new Map();
    const byHash = new Map(); // same picture behind two addresses saves once
    const crypto = require('crypto');
    let index = 0;
    let failed = 0;

    for (const r of results) {
      if (!r.buffer) {
        failed++;
        // "not an image" is an expected outcome, not something to shout about.
        if (/not an image|no content type/.test(r.reason || '')) {
          this.log('skipped, not an image:', r.url, r.reason);
        } else {
          console.warn('[ArchAfterClipping] leaving original URL in place:', r.url, r.reason);
        }
        continue;
      }
      const hash = crypto
        .createHash('sha1')
        .update(Buffer.from(r.buffer))
        .digest('hex');
      const alreadySaved = byHash.get(hash);
      if (alreadySaved) {
        urlToFile.set(r.url, alreadySaved);
        this.log('same image already saved, reusing:', alreadySaved.path);
        continue;
      }

      // A lone image needs no number; only a set of them does.
      index++;
      const counter = results.length > 1 ? String(index).padStart(2, '0') : '';
      const stem = this.settings.imageNameTemplate
        .replace(/\{\{notename\}\}/g, sanitizeName(file.basename))
        .replace(/\{\{index\}\}/g, counter)
        .replace(/\s+/g, ' ')
        .trim();
      const dest = await this.attachmentPathFor(file, stem, r.ext);
      const twin = await this.findIdenticalImage(dest, stem, r.ext, hash);
      if (twin) {
        urlToFile.set(r.url, twin);
        byHash.set(hash, twin);
        this.log('identical image already in the vault, reusing:', twin.path);
        continue;
      }
      await this.ensureFolder(dest.split('/').slice(0, -1).join('/'));
      try {
        const tf = await this.app.vault.createBinary(dest, r.buffer);
        urlToFile.set(r.url, tf);
        byHash.set(hash, tf);
      } catch (e) {
        failed++;
        console.warn('[ArchAfterClipping] could not save image to', dest, e);
      }
    }

    if (urlToFile.size === 0) {
      if (notify) new Notice('No images could be downloaded. See the developer console.');
      return;
    }

    // Rewrite the body.
    const linkFor = (tf) => this.buildEmbed(tf, file.path);
    let newBody = body.replace(MD_IMAGE_RE, (whole, alt, url) => {
      const tf = urlToFile.get(url);
      return tf ? this.buildEmbed(tf, file.path, alt) : whole;
    });
    newBody = newBody.replace(HTML_IMG_RE, (whole, a, b) => {
      const tf = urlToFile.get(a || b);
      return tf ? linkFor(tf) : whole;
    });
    newBody = newBody.replace(MD_LINK_RE, (whole, lead, label, url) => {
      const tf = urlToFile.get(url);
      return tf ? lead + this.buildLink(tf, file.path, label) : whole;
    });

    if (newBody !== body) {
      await this.app.vault.process(file, () => fm + newBody);
    }

    // Rewrite the frontmatter properties.
    if (fmTargets.length) {
      await this.setFrontmatter(file, (f) => {
        for (const t of fmTargets) {
          const tf = urlToFile.get(t.url);
          if (!tf) continue;
          const link = this.app.metadataCache.fileToLinktext(tf, file.path);
          // Keep the shape the template used: [Thumbnail](...) stays a markdown
          // link so Bases can render it; anything else becomes a wikilink.
          f[t.key] = this.rewriteImageValue(String(f[t.key] || ''), tf, file.path, t.key);
        }
      });
    }

    const msg =
      `Saved ${urlToFile.size} image${urlToFile.size === 1 ? '' : 's'}` +
      (failed ? `, ${failed} failed` : '');
    new Notice(msg);
    this.log(msg);
  }

  // [[file.png|Label]] where a label can be found, else a bare [[file.png]].
  // The label the template put on the value wins -- "[Thumbnail](url)" on a
  // video clip stays Thumbnail -- because the template author chose that word
  // knowing what the picture is, and the setting cannot. frontmatterImageLabels
  // fills in when the value carried none (a bare address, or "![](url)").
  // Aliases render correctly in Pretty Properties; that was tested. They were
  // absent for a while because this plugin clips any site and no SINGLE label
  // fits every property; a label per property, and per template, answers that.
  rewriteImageValue(original, tfile, sourcePath, key) {
    let link = tfile.path;
    try {
      link = this.app.metadataCache.fileToLinktext(tfile, sourcePath || '');
    } catch (_) {
      /* older builds: fall back to the full vault path */
    }
    const label = existingLabel(original) || (key ? (this.settings.frontmatterImageLabels || {})[key] : '') || '';
    return label ? `[[${link}|${label}]]` : `[[${link}]]`;
  }

  // Deleting a note and clipping the page again leaves the old attachment in
  // place, so the new copy lands beside it as "name-1.jpg". Only files this
  // image could have been named are hashed, so this stays cheap.
  async findIdenticalImage(dest, stem, ext, hash) {
    const crypto = require('crypto');
    const folder = dest.split('/').slice(0, -1).join('/');
    const parent = this.app.vault.getAbstractFileByPath(folder || '/');
    const siblings = parent && parent.children ? parent.children : [];
    const safe = sanitizeName(stem).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Obsidian numbers duplicates with a space, uniquePath with a dash.
    const shape = new RegExp(`^${safe}(?:[-\\s]\\d+)?$`, 'i');

    for (const child of siblings) {
      if (!(child instanceof TFile)) continue;
      if ('.' + child.extension.toLowerCase() !== ext.toLowerCase()) continue;
      if (!shape.test(child.basename)) continue;
      try {
        const buf = await this.app.vault.readBinary(child);
        const h = crypto.createHash('sha1').update(Buffer.from(buf)).digest('hex');
        if (h === hash) return child;
      } catch (e) {
        this.log('could not read', child.path, 'while looking for a duplicate');
      }
    }
    return null;
  }

  // The link form of buildEmbed: a [label](url) stays a link to the file,
  // in whichever syntax the vault uses, rather than becoming an embed.
  buildLink(tfile, sourcePath, label) {
    const link = this.app.metadataCache.fileToLinktext(tfile, sourcePath);
    let useMarkdown = false;
    try {
      useMarkdown = !!this.app.vault.getConfig('useMarkdownLinks');
    } catch (_) {
      /* older builds: fall back to wikilinks */
    }
    const text = (label || '').replace(/[[\]|]/g, '').trim();
    if (useMarkdown) return `[${text}](<${link}>)`;
    return text ? `[[${link}|${text}]]` : `[[${link}]]`;
  }

  buildEmbed(tfile, sourcePath, alt) {
    const link = this.app.metadataCache.fileToLinktext(tfile, sourcePath);
    let useMarkdown = false;
    try {
      useMarkdown = !!this.app.vault.getConfig('useMarkdownLinks');
    } catch (_) {
      /* older builds: fall back to wikilinks */
    }
    const label = (alt || '').replace(/[[\]|]/g, '').trim();
    if (useMarkdown) return `![${label}](<${link}>)`;
    return label ? `![[${link}|${label}]]` : `![[${link}]]`;
  }

  // Blank means "wherever Obsidian puts attachments", which respects the vault's
  // own setting instead of a folder this plugin invented.
  // getAvailablePathForAttachments is the API the Thumbnails plugin uses for
  // this (MIT, Meikul/obsidian-thumbnails).
  async attachmentPathFor(file, stem, ext) {
    if ((this.settings.imageLocationMode || 'obsidian') === 'obsidian') {
      try {
        const p = await this.app.vault.getAvailablePathForAttachments(stem, ext.replace(/^\./, ''), file);
        if (p) return normalizePath(p);
      } catch (e) {
        this.log('attachment API unavailable, using the folder setting:', String(e.message));
      }
    }
    const folder = this.resolveImageFolder(file);
    await this.ensureFolder(folder);
    return this.uniquePath(folder, sanitizeName(stem) + ext);
  }

  expandFolderTokens(raw, file) {
    const parentPath = file && file.parent ? file.parent.path : '';
    return String(raw || '')
      .replace(/\\/g, '/')
      .replace(/\{\{notename\}\}/g, sanitizeName(file ? file.basename : ''))
      .replace(/\{\{notepath\}\}/g, parentPath)
      .replace(/\{\{date\}\}/g, window.moment ? window.moment().format('YYYY-MM-DD') : '')
      .split('/')
      .map((seg) => (seg === '.' || seg === '' ? '' : sanitizeName(seg)))
      .filter(Boolean)
      .join('/');
  }

  // The modes mirror Obsidian's own "Default location for new attachments", so
  // the choice reads the same way it does in Obsidian's settings. Returns a
  // vault-relative folder; '' is the vault root.
  resolveLocationFolder(file, mode, subfolder, specified, fallback) {
    const parentPath = file && file.parent ? file.parent.path : '';
    if (mode === 'vault') return '';
    if (mode === 'same') return parentPath;
    if (mode === 'subfolder') {
      const sub = this.expandFolderTokens(subfolder || fallback, file);
      if (!sub) return parentPath;
      return parentPath ? `${parentPath}/${sub}` : sub;
    }
    return this.expandFolderTokens(specified || fallback, file) || fallback;
  }

  resolveImageFolder(file) {
    const mode = this.settings.imageLocationMode || 'obsidian';
    // 'obsidian' normally never reaches here: attachmentPathFor uses the vault
    // API for it and only falls through when that API is unavailable.
    return this.resolveLocationFolder(
      file,
      mode === 'obsidian' ? 'specified' : mode,
      this.settings.imageSubfolder,
      this.settings.imageFolder,
      'attachments'
    );
  }

  async ensureFolder(folderPath) {
    const parts = folderPath.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing instanceof TFolder) continue;
      if (existing) throw new Error(`"${current}" exists but is a file, not a folder.`);
      try {
        await this.app.vault.createFolder(current);
      } catch (e) {
        if (!/exists/i.test(String(e && e.message))) throw e;
      }
    }
  }

  async uniquePath(folder, filename) {
    const ext = path.extname(filename);
    const stem = filename.slice(0, filename.length - ext.length);
    let candidate = normalizePath(`${folder}/${stem}${ext}`);
    let n = 1;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = normalizePath(`${folder}/${stem}-${n++}${ext}`);
    }
    return candidate;
  }

  // Obsidian's requestUrl goes through Chromium's network stack, which a content
  // blocker can intercept (ERR_BLOCKED_BY_CLIENT). Node's https module does not,
  // so it is the fallback whenever the first attempt is blocked rather than refused.
  fetchViaNode(url, headers, hops = 0) {
    return new Promise((resolve, reject) => {
      if (hops > 6) return reject(new Error('too many redirects'));
      const https = require('https');
      const http = require('http');
      const mod = url.startsWith('http://') ? http : https;
      const req = mod.get(url, { headers }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(
            this.fetchViaNode(new URL(res.headers.location, url).toString(), headers, hops + 1)
          );
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          resolve({
            status: res.statusCode,
            arrayBuffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
            headers: res.headers,
          });
        });
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(HTTP_TIMEOUT_MS, () => req.destroy(new Error('timed out')));
    });
  }

  async fetchImage(url, referer) {
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    };
    if (referer) {
      headers.Referer = referer;
      try {
        headers.Origin = new URL(referer).origin;
      } catch (_) {
        /* ignore */
      }
    }

    // attempt 0 and 1 use Obsidian's fetcher; attempt 2 goes around any blocker.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const viaNode = attempt === 2;
        const res = viaNode
          ? await this.fetchViaNode(url, headers)
          : await Promise.race([
              requestUrl({ url, method: 'GET', headers, throw: false }),
              sleep(HTTP_TIMEOUT_MS).then(() => ({ status: 0, __timeout: true })),
            ]);
        if (res.__timeout) return { buffer: null, ext: '.jpg', reason: 'timed out' };
        if (viaNode) this.log('fetched around the blocker via Node:', url);
        if (res.status < 200 || res.status >= 300) {
          if (attempt < 2) {
            await sleep(600);
            continue;
          }
          return { buffer: null, ext: '.jpg', reason: `HTTP ${res.status}` };
        }
        const ct = String(
          (res.headers && (res.headers['content-type'] || res.headers['Content-Type'])) || ''
        ).toLowerCase();
        if (ct && !ct.startsWith('image/')) {
          return { buffer: null, ext: '.jpg', reason: `served as ${ct.split(';')[0]}, not an image` };
        }
        if (!ct && !urlLooksLikeImage(url)) {
          return { buffer: null, ext: '.jpg', reason: 'no content type and no image extension' };
        }
        const buf = res.arrayBuffer;
        if (!buf || buf.byteLength < MIN_IMAGE_BYTES) {
          return { buffer: null, ext: '.jpg', reason: 'too small, probably a tracking pixel' };
        }
        return { buffer: buf, ext: extFromResponse(url, ct) };
      } catch (e) {
        const msg = String((e && e.message) || e);
        // A blocked request will never succeed through the same stack, so skip
        // straight to the Node fallback instead of burning a retry.
        if (/BLOCKED_BY_CLIENT|ERR_FAILED|ERR_NETWORK/i.test(msg) && attempt < 2) {
          attempt = 1;
          continue;
        }
        if (attempt < 2) {
          await sleep(600);
          continue;
        }
        return { buffer: null, ext: '.jpg', reason: msg };
      }
    }
    return { buffer: null, ext: '.jpg', reason: 'unknown' };
  }

  /* ---------------- transform ---------------- */

  // A release delivers only main.js and manifest.json, so a freshly installed
  // vault has no transformers/ folder at all and every transform rule fails on
  // a missing file. Write the bundled copies out on load. Never overwrite a
  // file that already exists unless asked: it may be one the user edited, or
  // one of their own scripts that happens to share a name.
  ensureTransformers(overwrite = false) {
    const dir = path.join(this.pluginDir(), 'transformers');
    const written = [];
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      this.log('could not create the transformers folder:', e.message);
      return written;
    }
    for (const [name, source] of Object.entries(BUNDLED_TRANSFORMERS)) {
      const dest = path.join(dir, name);
      try {
        if (!overwrite && fs.existsSync(dest)) continue;
        fs.writeFileSync(dest, source, 'utf8');
        written.push(name);
      } catch (e) {
        this.log('could not write transformer', name + ':', e.message);
      }
    }
    if (written.length) this.log('wrote bundled transformers:', written.join(', '));
    return written;
  }

  pluginDir() {
    const base =
      this.app.vault.adapter && this.app.vault.adapter.getBasePath
        ? this.app.vault.adapter.getBasePath()
        : '';
    return path.join(base, this.manifest.dir || '');
  }

  async doTransform(file, sourceUrl, notify = false) {
    const url =
      sourceUrl ||
      this.resolveSourceUrl(this.app.metadataCache.getFileCache(file)?.frontmatter) ||
      this.extractUrlFromRawFrontmatter(await this.app.vault.read(file).catch(() => ''));
    if (!url) {
      if (notify) new Notice('This note has no source URL, so there is no site rule to match.');
      return;
    }

    const rule = this.settings.transformRules.find((r) => matchesPattern(url, r.pattern));
    if (!rule) {
      if (notify) new Notice('No transformer rule matches this URL.');
      this.log('no transformer for', url);
      return;
    }

    const scriptPath = path.join(this.pluginDir(), 'transformers', rule.script);
    if (!fs.existsSync(scriptPath)) {
      new Notice(`Transformer script not found: transformers/${rule.script}`);
      return;
    }

    const python = await this.resolvePython();
    if (!python) {
      new Notice('Python was not found. Set its full path in Clip Archiver settings.');
      return;
    }

    const content = await this.app.vault.read(file);
    const { fm, body } = splitFrontmatter(content);

    let result;
    try {
      result = await this.runProcess(python, [scriptPath], { stdin: body, timeoutMs: 60000 });
    } catch (e) {
      new Notice(`Transformer "${rule.name}" could not start. See the developer console.`);
      console.error('[ArchAfterClipping] transformer spawn failed:', e);
      return;
    }

    if (result.code !== 0) {
      new Notice(`Transformer "${rule.name}" exited with an error. Note left unchanged.`);
      console.error('[ArchAfterClipping] transformer stderr:\n' + result.stderr);
      return;
    }

    const out = String(result.stdout || '');
    if (!out.trim()) {
      new Notice(`Transformer "${rule.name}" returned nothing. Note left unchanged.`);
      console.warn('[ArchAfterClipping] transformer stderr:\n' + result.stderr);
      return;
    }
    if (out.trim() === body.trim()) {
      this.log('transformer made no changes:', rule.name);
      if (notify) new Notice(`"${rule.name}" found nothing to change.`);
      return;
    }
    if (result.stderr && result.stderr.trim()) {
      this.log('transformer notes:\n' + result.stderr.trim());
    }

    if (this.settings.backupBeforeTransform) {
      await this.writeBackup(file, content);
    }

    await this.app.vault.process(file, () => fm + out.replace(/\s+$/, '') + '\n');
    new Notice(`Transformed with "${rule.name}".`);
  }

  async writeBackup(file, content) {
    try {
      const folder = normalizePath(trimSlashes(this.settings.backupFolder) || '_raw');
      await this.ensureFolder(folder);
      const stamp = window.moment ? window.moment().format('YYYYMMDD-HHmmss') : Date.now();
      const dest = await this.uniquePath(folder, `${sanitizeName(file.basename)} (${stamp}).md`);
      await this.app.vault.create(dest, content);
      this.log('backup written to', dest);
    } catch (e) {
      console.warn('[ArchAfterClipping] backup failed:', e);
    }
  }

  async resolvePython() {
    if (this.resolvedPython) return this.resolvedPython;
    const candidates = [
      this.settings.pythonPath,
      'python3',
      'python',
      '/opt/homebrew/bin/python3',
      '/usr/local/bin/python3',
      '/usr/bin/python3',
    ].filter(Boolean);
    for (const c of candidates) {
      try {
        const r = await this.runProcess(c, ['-c', 'import sys; print(sys.version_info[0])'], {
          timeoutMs: 8000,
        });
        // The Windows Store stub exits 9009/1 and prints nothing useful.
        if (r.code === 0 && r.stdout.trim().startsWith('3')) {
          this.resolvedPython = c;
          this.log('using python:', c);
          return c;
        }
      } catch (_) {
        /* try the next one */
      }
    }
    return null;
  }

  /* ---------------- media ---------------- */

  looksLikeVideo(url) {
    const hosts = splitList(this.settings.videoHosts);
    if (hosts.some((h) => matchesPattern(url, h))) return true;
    return this.settings.probeUnknownUrls;
  }

  async doMedia(file, sourceUrl, manual = false, pendingMode = null, chosenMode = null) {
    const url =
      sourceUrl ||
      this.resolveSourceUrl(this.app.metadataCache.getFileCache(file)?.frontmatter) ||
      this.extractUrlFromRawFrontmatter(await this.app.vault.read(file).catch(() => ''));
    if (!url) {
      if (manual) new Notice('This note has no source URL.');
      return;
    }

    if (!manual && !this.looksLikeVideo(url)) {
      this.log('not a known media host, skipping:', url);
      return;
    }

    const tool = await this.findBinary('yt-dlp');
    if (!tool.found) {
      new Notice(
        'yt-dlp is not installed, so nothing can be downloaded. Open "Set up external tools" ' +
          'and press Install.',
        14000
      );
      return;
    }
    if (tool.path !== this.settings.ytDlpPath && path.isAbsolute(tool.path)) {
      this.settings.ytDlpPath = tool.path;
      await this.saveSettings();
      this.log('yt-dlp path corrected to', tool.path);
    }

    if (!this.settings.videoFolder) {
      // Silence here is what makes downloading look broken, so always speak up.
      new Notice(
        'Clip Archiver found media but no download folder is set. Open settings \u2192 Video and audio \u2192 Media folder.',
        12000
      );
      return;
    }

    // Ask yt-dlp whether it recognises the page at all, without downloading.
    // A known media host needs no probe. Asking yt-dlp costs a full extraction —
    // browser-cookie decryption plus a JS challenge — which is seconds of delay
    // before the popup can appear, to confirm something the address already says.
    const known = this.looksLikeVideo(url) && !this.settings.probeUnknownUrls;
    const probe = known
      ? { code: 0, stdout: '', stderr: '' }
      : await this.runYtDlp(
          ['--simulate', '--ignore-no-formats-error', '--quiet', '--no-warnings', url],
          45000
        );
    if (known) this.log('known media host, skipping the probe:', url);
    if (probe.code !== 0) {
      const err = (probe.stderr || '').trim();
      this.log('yt-dlp declined this URL:', url, err);
      if (this.isExtractionBroken(err)) {
        new Notice(
          'yt-dlp recognised the page but could not get any video or audio from it. ' +
            'Open "Set up external tools" — the YouTube challenge solver is most likely missing.',
          14000
        );
      } else if (manual) {
        new Notice('yt-dlp does not recognise this page as media.');
      }
      return;
    }

    let mode = chosenMode || this.sessionMode;
    if (!mode && pendingMode) mode = await pendingMode;
    if (!mode) {
      mode = this.settings.askDownloadMode
        ? await this.askMode(file, url)
        : this.settings.defaultDownloadMode;
    }
    if (!mode || mode === 'skip') {
      this.log('download skipped by user:', url);
      return;
    }

    // One download at a time, so five clips don't saturate the connection.
    const run = () => this.runDownloads(file, url, mode);
    const mine = this.downloadQueue.then(run, run);
    this.downloadQueue = mine.catch(() => {});
    return mine;
  }

  askMode(file, url) {
    const run = () =>
      new Promise((resolve) => {
        if (this.sessionMode) return resolve(this.sessionMode);
        new DownloadModeModal(
          this.app,
          file.basename,
          url,
          (mode, remember, place) => {
            if (remember && mode) {
              this.sessionMode = mode;
              this.sessionPlace = place;
            }
            if (place) this.chosenPlace.set(file.path, place);
            resolve(mode);
          },
          this.videoPlace(this.externalVideoFolder(file), file.path)
        ).open();
      });
    this.askQueue = this.askQueue.then(run, run);
    return this.askQueue;
  }

  outputFolder(file) {
    const mode = this.settings.videoLocationMode || 'specified';
    // 'specified' is kept verbatim so an absolute path outside the vault works.
    const configured =
      mode === 'specified'
        ? this.settings.videoFolder || 'media'
        : this.resolveLocationFolder(
            file, mode, this.settings.videoSubfolder, this.settings.videoFolder, 'media'
          );
    if (path.isAbsolute(configured)) return configured;
    const base =
      this.app.vault.adapter && this.app.vault.adapter.getBasePath
        ? this.app.vault.adapter.getBasePath()
        : '';
    return path.join(base, configured);
  }

  // Where the video file goes when Videos outside the vault is set: the folder
  // outputFolder would give, moved under <externalVideoFolder>/<vault name>, so
  // the drive mirrors the vault and a video's place there follows from its
  // place here. Null when the setting is empty, or when the media folder is
  // itself an absolute path outside the vault, which already is somewhere else.
  externalVideoFolder(file) {
    const root = String(this.settings.externalVideoFolder || '').trim();
    if (!root || !path.isAbsolute(root)) return null;
    const inVault = this.outputFolder(file);
    const base =
      this.app.vault.adapter && this.app.vault.adapter.getBasePath
        ? this.app.vault.adapter.getBasePath()
        : '';
    if (!base || (inVault !== base && !inVault.startsWith(base + path.sep))) return null;
    return path.join(root, this.app.vault.getName(), path.relative(base, inVault));
  }

  // yt-dlp treats % as a template marker, so a literal name has to double them.
  mediaOutputTemplate(file) {
    const stem = sanitizeName(file.basename).replace(/%/g, '%%');
    return `${stem}.%(ext)s`;
  }

  async runDownloads(file, url, mode) {
    // folder is in the vault and takes everything but the video: subtitles
    // and audio stay there. videoFolder is on the other drive when Videos
    // outside the vault is set, and the same folder when it is not.
    const folder = this.outputFolder(file);
    const wantsVideo = mode === 'video_only' || mode === 'video_and_audio';
    // Where the video goes (1.16.0): the popup's choice, else the one
    // remembered for the session, else the default. An unplugged drive is never
    // written to (a folder under /Volumes would be on the Mac's own disk), so
    // the video goes in the vault and, being there only for that reason, is
    // queued to move once the drive is back.
    const driveFolder = this.externalVideoFolder(file);
    const info = this.videoPlace(driveFolder, file.path);
    let place = this.chosenPlace.get(file.path) || this.sessionPlace || info.place;
    this.chosenPlace.delete(file.path);
    if (place === 'drive' && !info.mounted) place = 'vault';
    const fallback = !!(driveFolder && wantsVideo && place === 'vault' && !info.mounted && !this.keepsVideosInVault(file.path));
    const external = place === 'drive' ? driveFolder : null;
    const videoFolder = external || folder;
    if (fallback) {
      this.log('drive not plugged in, the video goes in the vault for now:', driveFolder);
      new Notice(
        `${info.drive} is not plugged in, so the video of "${file.basename}" is saved in the vault` +
          (this.settings.moveToDriveWhenBack ? '. It moves to the drive once it is back.' : '.'),
        12000
      );
    }
    try {
      fs.mkdirSync(folder, { recursive: true });
      if (external && wantsVideo) fs.mkdirSync(external, { recursive: true });
    } catch (e) {
      new Notice(`Could not create the download folder: ${e.path || folder}`);
      return;
    }

    const notice = new Notice(`Downloading media for "${file.basename}"...`, 0);
    const saved = [];
    const failures = [];
    let stagedAudio = null;

    const runVideo = async () => {
      const out = path.join(videoFolder, this.mediaOutputTemplate(file));
      const args = ['-f', this.settings.quality, '-o', out];
      if (this.settings.downloadSubtitles) {
        args.push(
          '--write-auto-subs', '--write-subs',
          '--sub-langs', this.settings.subtitleLangs || 'en.*',
          '--sub-format', 'vtt/best'
        );
        // yt-dlp takes a separate output template per file type, so the
        // subtitles land in the vault, beside the note, while the video goes
        // to the drive. They are the part Claude reads.
        if (external) args.push('-o', `subtitle:${path.join(folder, this.mediaOutputTemplate(file))}`);
      }
      const r = await this.ytDlpWithFallback(args, url, 'video', notice);
      if (r.ok) {
        saved.push(...r.files);
        if (this.settings.downloadSubtitles && this.settings.keepOneSubtitle) {
          // The stem yt-dlp actually wrote: mediaOutputTemplate doubles % for
          // yt-dlp's own templating, and yt-dlp writes it back as a single %.
          this.pruneSubtitles(folder, sanitizeName(file.basename));
        }
      }
      return r;
    };

    const runAudio = async () => {
      // Staged in a temp folder: YouTube's best audio stream is itself a webm,
      // so writing it beside the video under the same stem would land on the
      // video, which yt-dlp then deletes after converting it to mp3.
      stagedAudio = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-archiver-audio-'));
      const out = path.join(stagedAudio, this.mediaOutputTemplate(file));
      const args = [
        '-f', 'bestaudio/best', '-x',
        '--audio-format', this.settings.audioFormat,
        '-o', out,
      ];
      const r = await this.ytDlpWithFallback(args, url, 'audio', notice);
      if (r.ok) {
        for (const staged of r.files) {
          const moved = this.moveIntoFolder(staged, folder);
          if (moved) saved.push(moved);
        }
      }
      return r;
    };

    // Subtitles only: the files land where the video would, under its stem,
    // so a later video download finds them and yt-dlp does not fetch them
    // again. The print file stays empty with --skip-download, so the files
    // are matched on disk. Nothing is linked or embedded -- a subtitle is a
    // sidecar, never the media.
    const runSubtitles = async () => {
      const stem = sanitizeName(file.basename);
      const have = this.subtitlesNamed(folder, stem);
      if (have.length) {
        this.log('subtitles already on disk:', have.join(', '));
        return { ok: true, files: have, attempts: 0 };
      }
      const out = path.join(folder, this.mediaOutputTemplate(file));
      const args = [
        '--skip-download', '--write-auto-subs', '--write-subs',
        '--sub-langs', this.settings.subtitleLangs || 'en.*',
        '--sub-format', 'vtt/best',
        '-o', out,
      ];
      const r = await this.ytDlpWithFallback(args, url, 'subtitles', notice);
      if (!r.ok) return r;
      let files = this.subtitlesNamed(folder, stem);
      if (!files.length) return { ok: false, stderr: 'no subtitle file appeared', attempts: r.attempts };
      if (this.settings.keepOneSubtitle) {
        const kept = this.pruneSubtitles(folder, stem);
        files = kept ? [kept] : files;
      }
      this.log('subtitles saved:', files.join(', '));
      return { ok: true, files, attempts: r.attempts };
    };

    // The merged video already contains the audio, so it is extracted locally
    // rather than fetched a second time. Audio-only has no video to work from.
    const extractInstead = mode === 'video_and_audio';
    const subsOnly = mode === 'subs_only';

    const tasks = [];
    if (mode === 'video_only' || mode === 'video_and_audio') tasks.push(['video', runVideo]);
    if (mode === 'audio_only') tasks.push(['audio', runAudio]);
    if (subsOnly) tasks.push(['subtitles', runSubtitles]);

    const guard = (kind, fn) =>
      fn().then(
        (r) => [kind, r],
        (e) => [kind, { ok: false, stderr: String((e && e.message) || e), attempts: 1 }]
      );

    try {
      const results = [];
      for (const [kind, fn] of tasks) results.push(await guard(kind, fn));

      for (const [kind, r] of results) if (!r.ok) failures.push([kind, r]);

      if (subsOnly) {
        notice.hide();
        for (const [kind, r] of failures) this.reportFailure(kind, r);
        if (!failures.length) new Notice(`Subtitles saved for "${file.basename}".`);
        return;
      }

      if (extractInstead && saved.length) {
        const video = saved.find((f) => /\.(mp4|webm|mkv|mov|avi)$/i.test(f));
        if (video) {
          notice.setMessage('Extracting audio from the downloaded video...');
          const audio = await this.extractAudioFrom(video, folder);
          if (audio) {
            saved.push(audio);
          } else {
            // Extraction is the fast path, not the only one. If ffmpeg cannot
            // do it, fall back to fetching the audio rather than giving up.
            this.log('extraction failed, downloading the audio instead');
            notice.setMessage('Could not extract the audio, downloading it instead...');
            const [, r] = await guard('audio', runAudio);
            if (!r.ok) failures.push(['audio', r]);
          }
        }
      }

      notice.hide();

      // A failure in one no longer discards the other. Whatever arrived is kept.
      for (const [kind, r] of failures) this.reportFailure(kind, r);
      if (!saved.length) return;

      new Notice(
        failures.length
          ? `Saved the ${failures.length === tasks.length ? 'partial' : 'other'} file for "${file.basename}".`
          : `Media saved for "${file.basename}".`
      );

      if (this.settings.linkDownloadedMedia) {
        await this.linkMediaIntoNote(file, saved);
        const base =
          this.app.vault.adapter && this.app.vault.adapter.getBasePath
            ? this.app.vault.adapter.getBasePath()
            : '';
        const onDrive = saved.filter((p) => (!base || !p.startsWith(base + path.sep)) && /\.(mp4|webm|mkv|mov|avi|m4v)$/i.test(p));
        await this.addDriveLinks(file, onDrive);
        for (const v of onDrive) await this.writeLibraryNote(v, this.subtitlesNamed(folder, sanitizeName(file.basename)));
      }
      if (fallback) {
        for (const v of saved.filter((p) => /\.(mp4|webm|mkv|mov|avi|m4v)$/i.test(p))) this.queueDriveMove(file.path, v);
      }
      if (this.settings.embedLocalMedia) {
        await this.embedSavedMedia(file, saved);
      }
    } catch (e) {
      notice.hide();
      console.error('[ArchAfterClipping] download error:', e);
      new Notice('Media download failed. See the developer console.');
    } finally {
      if (stagedAudio) {
        try {
          fs.rmSync(stagedAudio, { recursive: true, force: true });
        } catch (_) {
          /* temp folder, not worth reporting */
        }
      }
    }
  }

  ffmpegBinary() {
    const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    return this.settings.ffmpegLocation ? path.join(this.settings.ffmpegLocation, name) : 'ffmpeg';
  }

  // Encoder settings per target format. Where the container already holds the
  // codec we want, the stream is copied instead, which is close to instant.
  audioEncodeArgs(sourcePath, format) {
    const src = path.extname(sourcePath).toLowerCase();
    const copyable =
      (format === 'opus' && (src === '.webm' || src === '.mkv')) ||
      (format === 'm4a' && (src === '.mp4' || src === '.m4v'));
    if (copyable) return { args: ['-c:a', 'copy'], copied: true };

    const map = {
      mp3: ['-c:a', 'libmp3lame', '-q:a', '2'],
      m4a: ['-c:a', 'aac', '-b:a', '192k'],
      opus: ['-c:a', 'libopus', '-b:a', '160k'],
      flac: ['-c:a', 'flac'],
      wav: ['-c:a', 'pcm_s16le'],
    };
    return { args: map[format] || map.mp3, copied: false };
  }

  // The audio is already inside the file we just downloaded, so pulling it out
  // locally beats fetching the same stream from YouTube a second time.
  // yt-dlp writes one subtitle file per matched language tag, so a --sub-langs
  // of 'en.*' leaves en.vtt, en-US.vtt, en-GB.vtt and en-orig.vtt side by side
  // for a single video. Ported from ARCH YT Playlists, which hit this first.
  // Only files matching the video's own stem are considered, so a subtitle a
  // user put in the folder by hand is never touched.
  pruneSubtitles(folder, stem) {
    let entries = [];
    try {
      entries = fs.readdirSync(folder);
    } catch (_) {
      return null;
    }
    const esc = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const shape = new RegExp(`^${esc}\\.([A-Za-z0-9_-]+)\\.(vtt|srt|ass)$`, 'i');

    const found = [];
    for (const name of entries) {
      const m = name.match(shape);
      if (m) found.push({ name, lang: m[1], ext: m[2].toLowerCase() });
    }
    if (found.length < 2) return found[0] ? path.join(folder, found[0].name) : null;

    found.sort((a, b) => this.subtitleRank(a) - this.subtitleRank(b) || a.lang.localeCompare(b.lang));
    const keep = found[0];
    let removed = 0;
    for (const f of found.slice(1)) {
      try {
        fs.unlinkSync(path.join(folder, f.name));
        removed++;
      } catch (_) {
        /* leave it rather than fail the download over a subtitle */
      }
    }
    this.log(`subtitles: kept ${keep.lang}, removed ${removed} other track(s)`);
    return path.join(folder, keep.name);
  }

  // Lower sorts first. A plain language code beats a regional variant, and the
  // original-language track beats an auto-translation of it.
  subtitleRank(f) {
    const lang = f.lang.toLowerCase();
    const base = (this.settings.subtitleLangs || 'en').replace(/[.*].*$/, '').toLowerCase() || 'en';
    if (lang === base) return 0;
    if (lang === `${base}-orig`) return 1;
    if (lang.startsWith(`${base}-`)) return 2;
    return 3;
  }

  async extractAudioFrom(videoPath, folder) {
    const format = this.settings.audioFormat || 'mp3';
    const stem = path.basename(videoPath, path.extname(videoPath));
    let dest = path.join(folder, `${stem}.${format}`);
    if (dest === videoPath) return null;

    let n = 1;
    while (fs.existsSync(dest)) dest = path.join(folder, `${stem}-${n++}.${format}`);

    const { args: codec, copied } = this.audioEncodeArgs(videoPath, format);
    const args = ['-y', '-loglevel', 'error', '-i', videoPath, '-vn', ...codec, dest];

    const started = Date.now();
    const r = await this.runProcess(this.ffmpegBinary(), args, { timeoutMs: 600000 }).catch((e) => ({
      code: 1,
      stdout: '',
      stderr: String(e.message),
    }));

    if (r.code !== 0) {
      console.error('[ArchAfterClipping] audio extraction failed:\n' + (r.stderr || '').trim());
      try {
        fs.unlinkSync(dest);
      } catch (_) {
        /* nothing was written */
      }
      return null;
    }
    this.log(
      `extracted ${format} in ${Date.now() - started}ms${copied ? ' (stream copy, no re-encode)' : ''}`
    );
    return dest;
  }

  // Moves a finished file into the media folder, falling back to copy when the
  // temp folder is on a different volume, where rename cannot work.
  // The subtitle sidecars written for a stem: name.<lang>.vtt and the like.
  subtitlesNamed(folder, stem) {
    let entries = [];
    try {
      entries = fs.readdirSync(folder);
    } catch (_) {
      return [];
    }
    const esc = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const shape = new RegExp(`^${esc}\\.[A-Za-z0-9_-]+\\.(vtt|srt|ass)$`, 'i');
    return entries.filter((n) => shape.test(n)).map((n) => path.join(folder, n));
  }

  moveIntoFolder(from, folder) {
    try {
      if (!fs.existsSync(from)) return null;
      let dest = path.join(folder, path.basename(from));
      if (dest === from) return from; // already where it belongs
      let n = 1;
      while (fs.existsSync(dest) && dest !== from) {
        const ext = path.extname(from);
        dest = path.join(folder, path.basename(from, ext) + `-${n++}` + ext);
      }
      try {
        fs.renameSync(from, dest);
      } catch (_) {
        fs.copyFileSync(from, dest);
        fs.unlinkSync(from);
      }
      this.log('moved audio into place:', dest);
      return dest;
    } catch (e) {
      console.warn('[ArchAfterClipping] could not move', from, e);
      return null;
    }
  }

  reportFailure(kind, result) {
    const stderr = (result.stderr || '').trim();
    if (/ENOENT/.test(stderr)) {
      const which = /ffmpeg/i.test(stderr) ? 'ffmpeg' : 'yt-dlp';
      console.error(`[ArchAfterClipping] ${which} could not be run: ${stderr}`);
      new Notice(
        `${which} was not found at "${which === 'ffmpeg' ? this.settings.ffmpegLocation : this.settings.ytDlpPath}". ` +
          'Open "Set up external tools" and install it.',
        14000
      );
      return;
    }
    console.error(
      `[ArchAfterClipping] ${kind} download failed after ${result.attempts} attempt(s):\n${stderr}`
    );
    if (/403|Forbidden/i.test(stderr)) {
      new Notice(
        `yt-dlp got 403 on the ${kind} stream through ${result.attempts} different attempts. ` +
          'Open "Set up external tools" — a stale yt-dlp, expired cookies, or a missing JavaScript ' +
          'runtime cause almost all of these.',
        14000
      );
    } else if (/Sign in to confirm|not a bot/i.test(stderr)) {
      new Notice(
        'YouTube asked yt-dlp to prove it is not a bot. Refresh your cookies, then try again.',
        12000
      );
    } else if (this.isExtractionBroken(stderr)) {
      new Notice(
        'YouTube could not solve its JavaScript challenge, so no usable formats came back. ' +
          'Check that Remote components is set to ejs:github in settings, and that a JavaScript ' +
          'runtime shows up under "Set up external tools".',
        16000
      );
    } else if (/ffmpeg|ffprobe/i.test(stderr)) {
      new Notice(
        'yt-dlp could not find ffmpeg. Open "Set up external tools" to install it.',
        12000
      );
    } else {
      new Notice(`The ${kind} download failed. See the developer console for yt-dlp's output.`, 10000);
    }
  }

  // Strips a flag and its value from an argument list.
  static stripFlag(args, flag) {
    const out = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === flag) {
        i++; // skip the value too
        continue;
      }
      out.push(args[i]);
    }
    return out;
  }

  // Ladder of retries, ordered by how often each one actually resolves a 403.
  // Derived from the open yt-dlp reports rather than guesswork: the failure is
  // frequently intermittent, so a plain retry comes before any flag changes.
  ladderSteps() {
    return [
      { label: 'your settings', extra: [] },
      { label: 'plain retry', extra: [], waitMs: 4000 },
      { label: 'fresh cache over IPv4', extra: ['--rm-cache-dir', '-4'], waitMs: 2000 },
      {
        label: 'mweb client',
        extra: this.settings.fallbackExtractorArgs
          ? ['--extractor-args', this.settings.fallbackExtractorArgs]
          : [],
      },
      // A forced format string fails far more often than letting yt-dlp choose.
      { label: 'automatic format choice', extra: [], dropFormat: true },
      { label: 'without cookies', extra: [], cookies: false },
    ];
  }

  async ytDlpWithFallback(baseArgs, url, kind, notice) {
    const ladder = this.ladderSteps();
    let last = { code: 1, stderr: '', stdout: '' };

    for (let i = 0; i < ladder.length; i++) {
      const step = ladder[i];

      if (i > 0) {
        // Only a 403-shaped failure is worth retrying; anything else is a real error.
        if (!this.isRetryable(last.stderr)) break;
        if (step.waitMs) await sleep(step.waitMs);
        this.log(`${kind}: attempt ${i + 1}, ${step.label}`);
        if (notice) notice.setMessage(`Retrying ${kind} (${step.label})...`);
      }

      let args = [...baseArgs];
      if (step.dropFormat) args = ClipArchiver.stripFlag(args, '-f');

      const printFile = path.join(
        os.tmpdir(),
        `clip-archiver-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
      );
      args = [
        ...args,
        ...step.extra,
        // --print-to-file can imply a dry run on some yt-dlp builds; this pins it down.
        '--no-simulate',
        '--print-to-file',
        'after_move:filepath',
        printFile,
        url,
      ];

      const r = await this.runYtDlp(args, 0, { cookies: step.cookies !== false });
      last = r;

      if (r.code === 0) {
        let files = [];
        try {
          files = fs
            .readFileSync(printFile, 'utf8')
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);
        } catch (_) {
          /* not fatal, we just won't be able to link the file */
        }
        this.safeUnlink(printFile);
        return { ok: true, files, attempts: i + 1, usedStep: step.label };
      }
      this.safeUnlink(printFile);
    }

    return { ok: false, stderr: last.stderr, attempts: ladder.length };
  }

  // Distinguishes "YouTube gave us nothing usable" from an ordinary format miss.
  isExtractionBroken(stderr) {
    const t = String(stderr || '');
    return (
      /Only images are available/i.test(t) ||
      /challenge solver/i.test(t) ||
      /wiki\/EJS/i.test(t) ||
      /challenge solv/i.test(t) ||
      /page needs to be reloaded/i.test(t) ||
      /remote component/i.test(t) ||
      /Requested format is not available/i.test(t)
    );
  }

  isRetryable(stderr) {
    return /403|Forbidden|Sign in to confirm|unable to download video data|fragment.*not found|Unable to download API page/i.test(
      String(stderr || '')
    );
  }

  safeUnlink(p) {
    try {
      fs.unlinkSync(p);
    } catch (_) {
      /* ignore */
    }
  }

  buildYtDlpFlags({ cookies = true } = {}) {
    const flags = [];
    if (cookies && this.settings.cookiesFile) {
      flags.push('--cookies', this.settings.cookiesFile);
    } else if (cookies && this.settings.cookiesFromBrowser) {
      flags.push('--cookies-from-browser', this.settings.cookiesFromBrowser);
    }
    if (this.settings.ffmpegLocation) {
      flags.push('--ffmpeg-location', this.settings.ffmpegLocation);
    }
    if (this.settings.noPlaylist) flags.push('--no-playlist');
    // YouTube's signature and n-challenge solving needs the EJS solver script.
    // The library ships inside the standalone build, but the script itself is
    // fetched at run time and that fetch is off by default, so challenge solving
    // fails with "The page needs to be reloaded" until this is passed.
    if (this.settings.remoteComponents) {
      flags.push('--remote-components', this.settings.remoteComponents);
    }
    if (this.settings.jsRuntime) flags.push('--js-runtime', this.settings.jsRuntime);
    const extra = String(this.settings.ytDlpExtraArgs || '').trim();
    if (extra) flags.push(...this.tokenize(extra));
    return flags;
  }

  // Splits a settings string into argv, respecting quoted segments.
  tokenize(str) {
    const out = [];
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let m;
    while ((m = re.exec(str))) out.push(m[1] ?? m[2] ?? m[3]);
    return out;
  }

  runYtDlp(args, timeoutMs = 0, opts = {}) {
    const full = [...this.buildYtDlpFlags(opts), ...args];
    this.log('yt-dlp', full.join(' '));
    return this.runProcess(this.settings.ytDlpPath || 'yt-dlp', full, {
      timeoutMs,
      maxBuffer: 1024 * 1024 * 32,
    });
  }

  applyNameTemplate(channel, title) {
    const template = this.settings.noteNameTemplate || '%(channel)s \u2014 %(title)s';
    if (!channel) return title || null;
    if (!title) return channel;
    return template
      .replace(/%\(channel\)s/g, channel)
      .replace(/%\(uploader\)s/g, channel)
      .replace(/%\(title\)s/g, title);
  }

  // Strips a channel prefix this plugin added on an earlier run, so re-running
  // never stacks "Channel — Channel — Title".
  stripChannelPrefix(title, channel) {
    if (!channel) return title;
    const sep = ['\u2014', '\u2013', '-'].map((d) => `${channel} ${d} `);
    for (const prefix of sep) {
      if (title.startsWith(prefix)) return title.slice(prefix.length);
    }
    return title;
  }

  // A title and a channel name are public data. yt-dlp answers this by decrypting
  // browser cookies and running a full extraction, which measured ten seconds;
  // YouTube's oEmbed endpoint answers the same question in one unauthenticated
  // request. yt-dlp stays as the fallback for everything else.
  async fetchChannelAndTitleViaOEmbed(url) {
    if (!/(?:youtube\.com|youtu\.be)/i.test(url)) return null;
    try {
      const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const res = await this.fetchViaNode(endpoint, { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' });
      if (res.status !== 200) return null;
      const json = JSON.parse(Buffer.from(res.arrayBuffer).toString('utf8'));
      const channel = String(json.author_name || '').trim();
      const title = String(json.title || '').trim();
      if (!channel && !title) return null;
      this.log('metadata via oEmbed:', channel, '/', title);
      // oEmbed 404s on channel and profile pages, so a hit means a real video.
      return { channel, title, hasFormats: true };
    } catch (e) {
      this.log('oEmbed lookup failed, falling back to yt-dlp:', String(e.message));
      return null;
    }
  }

  async fetchChannelAndTitle(url) {
    const fast = await this.fetchChannelAndTitleViaOEmbed(url);
    if (fast) return fast;

    // format_id rides along on the call we were already making. With
    // --ignore-no-formats-error a page with nothing downloadable still prints,
    // as NA, which is the signal that there is no media behind this URL.
    const base = [
      '--skip-download', '--ignore-no-formats-error', '--no-warnings',
      '--print', '%(channel)s', '--print', '%(title)s', '--print', '%(format_id)s',
      '--print', '%(duration)s', url,
    ];
    for (const withCookies of [false, true]) {
      try {
        const r = await this.runYtDlp(base, 45000, { cookies: withCookies });
        if (r.code === 0) {
          const lines = (r.stdout || '').split('\n').map((x) => x.trim());
          const channel = lines[0] && lines[0] !== 'NA' ? lines[0] : '';
          const title = lines[1] && lines[1] !== 'NA' ? lines[1] : '';
          const hasFormats = !!(lines[2] && lines[2] !== 'NA');
          const duration = Number(lines[3]) > 0 ? Number(lines[3]) : null;
          if (channel || title) return { channel, title, hasFormats, duration };
        }
      } catch (e) {
        this.log('metadata lookup failed:', String(e.message));
      }
      if (!this.settings.cookiesFile && !this.settings.cookiesFromBrowser) break;
    }
    return null;
  }

  // The video's length in seconds. The yt-dlp metadata call prints it on the way
  // (meta.duration); a YouTube title comes from oEmbed instead, which has no
  // length, so the watch page is read for its "lengthSeconds": one request with
  // no cookies, about a second, where yt-dlp takes seven to ten.
  async fetchVideoSeconds(url, meta) {
    if (meta && meta.duration) return meta.duration;
    if (!/(?:youtube\.com|youtu\.be)/i.test(url)) return null;
    try {
      const res = await this.fetchViaNode(url, { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en' });
      if (res.status === 200) {
        const m = Buffer.from(res.arrayBuffer).toString('utf8').match(/"lengthSeconds":"(\d+)"/);
        if (m && Number(m[1]) > 0) return Number(m[1]);
      }
      this.log('no length found on the YouTube page:', url, res.status);
    } catch (e) {
      this.log('YouTube page lookup failed:', String(e.message));
    }
    return null;
  }

  // Fills `duration` when the note has none (absent, or empty as a Web Clipper
  // template leaves it). A value already there is a person's or an earlier run's
  // and is kept.
  async fillVideoLength(file, url, meta, manual) {
    const filled = (v) => v !== undefined && v !== null && String(v).trim() !== '';
    const cached = this.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
    if (cached && filled(cached.duration)) {
      this.log('duration already set, left alone:', file.path, cached.duration);
      if (manual) new Notice(`"${file.basename}" already has a duration: ${cached.duration}.`);
      return;
    }
    const seconds = await this.fetchVideoSeconds(url, meta);
    if (!seconds) {
      this.log('video length not found for', url);
      if (manual) new Notice('Could not find the length of this video.');
      return;
    }
    const minutes = Math.ceil(seconds / 60);
    let wrote = false;
    await this.setFrontmatter(file, (f) => {
      if (filled(f.duration)) return;
      f.duration = minutes;
      wrote = true;
    });
    this.log(wrote ? `duration ${minutes} min (${seconds}s) written:` : 'duration already set, left alone:', file.path);
    if (manual && wrote) new Notice(`Duration: ${minutes} min.`);
  }

  // The note's own name wins by default: if you tidied the title by hand, that
  // edit is the thing worth keeping, and all this needs to add is the channel.
  async fetchNoteName(url, file) {
    const meta = await this.fetchChannelAndTitle(url);
    return meta ? this.noteNameFromMeta(meta, file) : null;
  }

  noteNameFromMeta(meta, file) {
    if (!meta) return null;
    const title =
      this.settings.noteTitleSource === 'metadata' || !file
        ? meta.title
        : this.stripChannelPrefix(file.basename, meta.channel);
    return this.applyNameTemplate(meta.channel, title);
  }

  async renameNoteTo(file, rawName) {
    try {
      const stem = sanitizeName(rawName);
      if (!stem || stem === file.basename) return;
      const folder = file.parent ? file.parent.path : '';
      const dest = await this.uniquePath(folder, stem + '.md');
      // fileManager.renameFile updates every link pointing at this note;
      // vault.rename would leave them dangling.
      await this.app.fileManager.renameFile(file, dest);
      this.log('renamed note to', dest);
    } catch (e) {
      console.warn('[ArchAfterClipping] could not rename note:', e);
    }
  }

  async embedFromFrontmatter(file) {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const raw = fm.media;
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const paths = list
      .map((v) => {
        const m = String(v).match(/^\[\[([^\]|]+)/);
        const name = m ? m[1].trim() : String(v).trim();
        const tf =
          this.app.metadataCache.getFirstLinkpathDest(name, file.path) ||
          this.app.vault.getAbstractFileByPath(normalizePath(name));
        return tf ? tf.path : null;
      })
      .filter(Boolean);

    if (!paths.length) {
      new Notice('This note has no media property pointing at a local file.');
      return;
    }
    const video = paths.find((p) => /\.(mp4|webm|mkv|mov|avi)$/i.test(p));
    const audio = paths.find((p) => /\.(mp3|m4a|opus|flac|wav|ogg)$/i.test(p));
    await this.writeMediaEmbed(file, video, audio);
    new Notice('Local media embedded.');
  }

  async waitForVaultFile(vaultPath, timeoutMs = 10000) {
    const p = normalizePath(vaultPath);
    const start = Date.now();
    let tf = this.app.vault.getAbstractFileByPath(p);
    while (!tf && Date.now() - start < timeoutMs) {
      await sleep(200);
      tf = this.app.vault.getAbstractFileByPath(p);
    }
    return tf;
  }

  // Turns absolute download paths into vault paths.
  async embedSavedMedia(file, absPaths) {
    try {
      const base =
        this.app.vault.adapter && this.app.vault.adapter.getBasePath
          ? this.app.vault.adapter.getBasePath()
          : '';
      const toVault = (p) =>
        base && p.startsWith(base) ? normalizePath(path.relative(base, p)) : null;

      const inVault = absPaths.map(toVault).filter(Boolean);
      if (absPaths.some((p) => !toVault(p) && /\.(mp4|webm|mkv|mov|avi)$/i.test(p))) {
        // An embed of a file:/// video plays but prints its whole encoded
        // address under the player, so a video outside the vault is left to
        // the media property.
        this.log('video is outside the vault, not embedded; the media property links it');
      }
      const video = inVault.find((p) => /\.(mp4|webm|mkv|mov|avi)$/i.test(p));
      const audio = inVault.find((p) => /\.(mp3|m4a|opus|flac|wav|ogg)$/i.test(p));
      if (!video && !audio) return;

      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
      await this.writeMediaEmbed(file, video, audio);
    } catch (e) {
      console.warn('[ArchAfterClipping] could not embed the local player:', e);
    }
  }

  async linkMediaIntoNote(file, absPaths) {
    const base =
      this.app.vault.adapter && this.app.vault.adapter.getBasePath
        ? this.app.vault.adapter.getBasePath()
        : '';

    // If the file landed inside the vault, give Obsidian a moment to notice it,
    // otherwise fileToLinktext has nothing to resolve against.
    const inVault = absPaths.filter((p) => base && p.startsWith(base));
    for (let i = 0; i < 20 && inVault.length; i++) {
      const missing = inVault.filter(
        (p) => !this.app.vault.getAbstractFileByPath(normalizePath(path.relative(base, p)))
      );
      if (missing.length === 0) break;
      await sleep(250);
    }

    await this.setFrontmatter(file, (fm) => {
      const values = absPaths.map((p) => {
        const rel = base && p.startsWith(base) ? normalizePath(path.relative(base, p)) : null;
        // Outside the vault: a bare file:/// URL, the form Media Extended reads
        // from `media` and plays in its own window (tested 2026-09-24). A
        // markdown [Video](file:///…) link opened in the web browser instead.
        if (!rel) return pathToFileURL(p).href;
        const tf = this.app.vault.getAbstractFileByPath(rel);
        const link = tf ? this.app.metadataCache.fileToLinktext(tf, file.path) : rel;
        return `[[${link}]]`;
      });
      fm.media = values.length === 1 ? values[0] : values;

      // A note clipped from the YouTube template carries dl-ed: false and
      // nothing was ever flipping it: this plugin never wrote the property and
      // ARCH YT Playlists only writes it on notes it owns, which a Web Clipper
      // note is not. Set it here, where the files are already on disk, so the
      // flag cannot claim a download that failed.
      // Where it and media end up is the property order setting's business;
      // setFrontmatter applies it after this.
      const doneKey = String(this.settings.markDownloadedKey || '').trim();
      if (doneKey) fm[doneKey] = true;
    });
  }

  /* ---------------- process runner ---------------- */

  buildEnv() {
    const env = Object.assign({}, process.env, {
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    });
    if (process.platform !== 'win32') {
      // Electron launched from Finder/Dock inherits a very short PATH.
      const extras = [
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
        '/bin',
        path.join(os.homedir(), '.local', 'bin'),
      ];
      env.PATH = [...extras, env.PATH || ''].filter(Boolean).join(path.delimiter);
    }
    return env;
  }

  runProcess(command, args, { stdin = null, timeoutMs = 0, maxBuffer = 1024 * 1024 * 8 } = {}) {
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = execFile(
          command,
          args,
          {
            env: this.buildEnv(),
            encoding: 'utf8',
            maxBuffer,
            timeout: timeoutMs || 0,
            windowsHide: true,
          },
          (err, stdout, stderr) => {
            if (err && err.code === 'ENOENT') return reject(err);
            resolve({
              code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
              stdout: stdout || '',
              stderr: stderr || (err ? String(err.message) : ''),
            });
          }
        );
      } catch (e) {
        return reject(e);
      }
      if (stdin !== null && child.stdin) {
        child.stdin.on('error', () => {});
        child.stdin.end(stdin, 'utf8');
      }
    });
  }

  async inspect(file) {
    const content = await this.app.vault.read(file).catch(() => '');
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
    const fromCache = this.resolveSourceUrl(fm);
    const fromRaw = this.extractUrlFromRawFrontmatter(content);
    const url = fromCache || fromRaw;

    const lines = [`Note: ${file.path}`, `Content length: ${content.length}`];
    lines.push(`Metadata cache: ${fm ? 'ready' : 'NOT READY'}`);
    if (fm) lines.push(`Properties: ${Object.keys(fm).join(', ') || '(empty)'}`);
    lines.push(`URL via metadata cache: ${fromCache || 'none'}`);
    lines.push(`URL via raw frontmatter: ${fromRaw || 'none'}`);

    if (url) {
      const matchedKey = fm ? Object.keys(fm).find((k) => this.extractUrl(fm[k]) === url) : null;
      lines.push(`Source URL: ${url}`);
      lines.push(`Found in property: ${matchedKey || '(read from the raw block)'}`);
      lines.push(
        `Media host: ${this.looksLikeVideo(url) ? 'yes, yt-dlp will be asked' : 'no, media download skipped'}`
      );
      const rule = this.settings.transformRules.find((r) => matchesPattern(url, r.pattern));
      lines.push(`Transformer: ${rule ? rule.name + ' (' + rule.script + ')' : 'no rule matches'}`);
    } else {
      lines.push('Source URL: NONE FOUND');
      lines.push(`Looked for: ${this.settings.frontmatterUrlKeys.join(', ')}`);
      lines.push('Then checked every other property for a web address, and found none.');
    }

    lines.push(
      `Already downloaded: ${
        (fm && fm[this.settings.markDownloadedKey] === true) ||
        this.rawFlagIsTrue(content, this.settings.markDownloadedKey)
          ? 'yes'
          : 'no'
      }`
    );
    lines.push(`In watched scope: ${this.inScope(file) ? 'yes' : 'no'}`);
    lines.push(`Media folder: ${this.settings.videoFolder || 'NOT SET'}`);
    lines.push(`yt-dlp: ${this.settings.ytDlpPath || 'not set'}`);

    console.log('[ArchAfterClipping] inspect\n' + lines.join('\n'));
    new InspectModal(this.app, lines).open();
  }

  /* ---------------- tool detection and setup ---------------- */

  // Outside the plugin folder on purpose: replacing the folder to update the
  // plugin would otherwise delete the yt-dlp installed into it.
  binDir() {
    const base =
      this.app.vault.adapter && this.app.vault.adapter.getBasePath
        ? this.app.vault.adapter.getBasePath()
        : '';
    return path.join(base, this.app.vault.configDir || '.obsidian', 'arch-tools');
  }

  legacyBinDir() {
    return path.join(this.pluginDir(), 'bin');
  }

  exeName(base) {
    return process.platform === 'win32' ? `${base}.exe` : base;
  }

  // Where a binary might reasonably live. Absolute paths come first so detection
  // learns a real location; the bare name is only a fallback, and even then we
  // resolve it, because "ffmpeg" tells the settings nothing.
  candidatePaths(base) {
    const name = this.exeName(base);
    // the old in-plugin location is still checked, for an install made before the move
    const list = [path.join(this.binDir(), name), path.join(this.legacyBinDir(), name)];
    if (process.platform === 'win32') {
      list.push(
        path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', name),
        path.join(process.env.PROGRAMFILES || '', base, 'bin', name),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', base, name),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Scripts', name),
        name
      );
    } else {
      list.push(
        `/opt/homebrew/bin/${name}`,
        `/usr/local/bin/${name}`,
        `/usr/bin/${name}`,
        `/snap/bin/${name}`,
        path.join(os.homedir(), '.local', 'bin', name),
        name
      );
    }
    return list.filter(Boolean);
  }

  // Turns a bare command name into the absolute path the shell would run.
  async resolveAbsolutePath(name) {
    if (path.isAbsolute(name)) return name;
    const finder = process.platform === 'win32' ? 'where' : 'which';
    try {
      const r = await this.runProcess(finder, [name], { timeoutMs: 8000 });
      if (r.code === 0) {
        const first = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean)[0];
        if (first && path.isAbsolute(first)) return first;
      }
    } catch (_) {
      /* fall through */
    }
    return name;
  }

  async findBinary(base, versionArgs = ['--version']) {
    for (const candidate of this.candidatePaths(base)) {
      try {
        const r = await this.runProcess(candidate, versionArgs, { timeoutMs: 10000 });
        if (r.code === 0) {
          return {
            found: true,
            path: await this.resolveAbsolutePath(candidate),
            version: (r.stdout || r.stderr).trim().split('\n')[0],
          };
        }
      } catch (_) {
        /* not here, try the next */
      }
    }
    return { found: false, path: null, version: null };
  }

  // yt-dlp versions are dated, e.g. 2026.08.19. Anything stale is a 403 waiting to happen.
  ytDlpAgeDays(version) {
    const m = String(version || '').match(/(\d{4})\.(\d{2})\.(\d{2})/);
    if (!m) return null;
    const released = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Math.floor((Date.now() - released) / 86400000);
  }

  // Builds with a known YouTube-breaking regression, worth calling out by name.
  knownBadYtDlp(version) {
    const m = String(version || '').match(/(\d{4})\.(\d{2})\.(\d{2})/);
    if (!m) return null;
    const stamp = `${m[1]}.${m[2]}.${m[3]}`;
    if (stamp >= '2026.07.04' && stamp < '2026.08.19') {
      return 'This build is inside the android_vr regression window that returned 403 on downloads. Fixed in 2026.08.19.';
    }
    return null;
  }

  // Browser profile locations, so cookie settings can fill themselves in.
  browserProfiles() {
    const home = os.homedir();
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');

    if (process.platform === 'darwin') {
      const support = path.join(home, 'Library', 'Application Support');
      return [
        { name: 'chrome', dir: path.join(support, 'Google', 'Chrome') },
        { name: 'brave', dir: path.join(support, 'BraveSoftware', 'Brave-Browser') },
        { name: 'edge', dir: path.join(support, 'Microsoft Edge') },
        { name: 'vivaldi', dir: path.join(support, 'Vivaldi') },
        { name: 'chromium', dir: path.join(support, 'Chromium') },
        { name: 'firefox', dir: path.join(support, 'Firefox') },
        { name: 'safari', dir: path.join(home, 'Library', 'Safari') },
      ];
    }
    if (process.platform === 'win32') {
      return [
        { name: 'chrome', dir: path.join(localAppData, 'Google', 'Chrome', 'User Data') },
        { name: 'edge', dir: path.join(localAppData, 'Microsoft', 'Edge', 'User Data') },
        { name: 'brave', dir: path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data') },
        { name: 'vivaldi', dir: path.join(localAppData, 'Vivaldi', 'User Data') },
        { name: 'chromium', dir: path.join(localAppData, 'Chromium', 'User Data') },
        { name: 'firefox', dir: path.join(appData, 'Mozilla', 'Firefox') },
      ];
    }
    return [
      { name: 'chrome', dir: path.join(home, '.config', 'google-chrome') },
      { name: 'brave', dir: path.join(home, '.config', 'BraveSoftware', 'Brave-Browser') },
      { name: 'chromium', dir: path.join(home, '.config', 'chromium') },
      { name: 'vivaldi', dir: path.join(home, '.config', 'vivaldi') },
      { name: 'firefox', dir: path.join(home, '.mozilla', 'firefox') },
    ];
  }

  // The browser you actually use is the one whose profile changed most recently.
  detectBrowsers() {
    const found = [];
    for (const b of this.browserProfiles()) {
      try {
        const st = fs.statSync(b.dir);
        if (st.isDirectory()) found.push({ ...b, mtime: st.mtimeMs });
      } catch (_) {
        /* not installed */
      }
    }
    return found.sort((a, b) => b.mtime - a.mtime);
  }

  async testCookies(browser) {
    // yt-dlp's own long-standing test video, used only to confirm cookie extraction.
    const args = [
      '--cookies-from-browser',
      browser,
      '--simulate',
      '--quiet',
      '--no-warnings',
      'https://www.youtube.com/watch?v=BaW_jenozKc',
    ];
    try {
      const r = await this.runProcess(this.settings.ytDlpPath || 'yt-dlp', args, {
        timeoutMs: 60000,
      });
      return { ok: r.code === 0, detail: (r.stderr || '').trim().split('\n')[0] };
    } catch (e) {
      return { ok: false, detail: String(e.message) };
    }
  }

  async detectTools() {
    const report = {};

    report.ytdlp = await this.findBinary('yt-dlp');
    if (report.ytdlp.found) {
      report.ytdlp.ageDays = this.ytDlpAgeDays(report.ytdlp.version);
      report.ytdlp.knownBad = this.knownBadYtDlp(report.ytdlp.version);
      report.ytdlp.installMethod = this.guessInstallMethod(report.ytdlp.path);
    }

    const ffmpegFromSetting = this.settings.ffmpegLocation
      ? path.join(this.settings.ffmpegLocation, this.exeName('ffmpeg'))
      : null;
    if (ffmpegFromSetting) {
      try {
        const r = await this.runProcess(ffmpegFromSetting, ['-version'], { timeoutMs: 10000 });
        report.ffmpeg =
          r.code === 0
            ? { found: true, path: ffmpegFromSetting, version: r.stdout.trim().split('\n')[0] }
            : await this.findBinary('ffmpeg', ['-version']);
      } catch (_) {
        report.ffmpeg = await this.findBinary('ffmpeg', ['-version']);
      }
    } else {
      report.ffmpeg = await this.findBinary('ffmpeg', ['-version']);
    }

    const py = await this.resolvePython();
    report.python = py
      ? { found: true, path: py, version: (await this.runProcess(py, ['--version'], { timeoutMs: 8000 })).stdout.trim() || 'python 3' }
      : { found: false, path: null, version: null };

    // yt-dlp now needs an external JavaScript runtime to solve YouTube's challenges.
    report.jsRuntime = { found: false, path: null, version: null };
    for (const rt of ['deno', 'node', 'bun', 'qjs']) {
      const hit = await this.findBinary(rt);
      if (hit.found) {
        report.jsRuntime = { ...hit, name: rt };
        break;
      }
    }

    report.browsers = this.detectBrowsers();
    report.ejs = await this.detectEjs(report);

    return report;
  }

  // YouTube extraction needs a JS runtime *and* the challenge solver scripts.
  // Without the scripts only storyboard images come back, and yt-dlp reports that
  // as "Requested format is not available", which points at the wrong thing.
  async detectEjs(report) {
    if (report.ytdlp.installMethod === 'standalone') {
      // The library is bundled, but the solver script is fetched at run time and
      // that fetch is disabled unless --remote-components is passed.
      return this.settings.remoteComponents
        ? { found: true, how: `bundled, solver script enabled via --remote-components ${this.settings.remoteComponents}`, installable: false }
        : { found: false, how: 'bundled, but the solver script fetch is disabled - set Remote components to ejs:github', installable: false };
    }
    const py = report.python.found ? report.python.path : await this.resolvePython();
    if (!py) return { found: false, how: 'cannot check without Python', installable: false };
    try {
      const r = await this.runProcess(
        py,
        ['-c', 'import yt_dlp_ejs, sys; sys.stdout.write(getattr(yt_dlp_ejs, "__version__", "installed"))'],
        { timeoutMs: 10000 }
      );
      if (r.code === 0) return { found: true, how: `yt-dlp-ejs ${r.stdout.trim()}`, installable: false };
    } catch (_) {
      /* fall through */
    }
    return { found: false, how: 'yt-dlp-ejs is not installed', installable: true };
  }

  async installEjs() {
    const py = (await this.resolvePython()) || 'python3';
    const notice = new Notice('Installing yt-dlp-ejs...', 0);
    const run = (args) =>
      this.runProcess(py, args, { timeoutMs: 300000 }).catch((e) => ({
        code: 1,
        stdout: '',
        stderr: String(e.message),
      }));

    let r = await run(['-m', 'pip', 'install', '-U', 'yt-dlp-ejs']);
    if (r.code !== 0 && /externally-managed|--break-system-packages/i.test(r.stdout + r.stderr)) {
      notice.setMessage('Retrying with --break-system-packages...');
      r = await run(['-m', 'pip', 'install', '-U', '--break-system-packages', 'yt-dlp-ejs']);
    }
    notice.hide();

    if (r.code === 0) {
      new Notice('yt-dlp-ejs installed. YouTube downloads should work now.', 10000);
      return true;
    }
    console.error('[ArchAfterClipping] yt-dlp-ejs install failed:\n' + (r.stderr || r.stdout));
    new Notice(
      'Could not install yt-dlp-ejs. Run this yourself: pip install -U yt-dlp-ejs',
      14000
    );
    return false;
  }

  // yt-dlp prints what it actually found under -v. Two lines decide whether
  // YouTube challenge solving can work at all: the optional libraries list must
  // contain yt_dlp_ejs, and the JS runtimes list must not be empty.
  async probeRuntimes(url = 'https://www.youtube.com/watch?v=BaW_jenozKc') {
    const notice = new Notice('Asking yt-dlp what it can see...', 0);
    const r = await this.runYtDlp(['-v', '--simulate', '--ignore-no-formats-error', url], 90000).catch(
      (e) => ({ code: 1, stdout: '', stderr: String(e.message) })
    );
    notice.hide();

    const text = `${r.stdout}\n${r.stderr}`;
    const grab = (re) => (text.match(re) || [])[0] || null;
    const runtimes = grab(/^\[debug\] JS runtimes:.*$/m);
    const libs = grab(/^\[debug\] Optional libraries:.*$/m);
    const version = grab(/^\[debug\] yt-dlp version.*$/m);

    const lines = [version || 'yt-dlp version: not reported', ''];
    lines.push(runtimes || '[debug] JS runtimes: NONE REPORTED');
    lines.push('');
    lines.push(libs ? libs.slice(0, 300) : '[debug] Optional libraries: none reported');
    lines.push('');

    const hasEjs = /yt_dlp_ejs/i.test(libs || '');
    const hasRuntime = !!runtimes && !/JS runtimes:\s*$/.test(runtimes);
    lines.push(`challenge solver library: ${hasEjs ? 'present' : 'MISSING'}`);
    lines.push(`JavaScript runtime seen by yt-dlp: ${hasRuntime ? 'yes' : 'NO'}`);
    lines.push('');
    if (!hasRuntime) {
      lines.push('yt-dlp cannot see a JavaScript runtime, so it cannot solve YouTube\u2019s');
      lines.push('challenges. Set the JavaScript runtime setting to a name and full path,');
      lines.push('for example: node:/usr/local/bin/node');
    } else if (!hasEjs) {
      lines.push('The runtime is there but the solver library is not. Reinstall yt-dlp from');
      lines.push('the setup screen, which fetches a build that bundles it.');
    } else {
      lines.push('Both are present. A failure now is something other than challenge solving.');
    }

    const warnings = text.split('\n').filter((l) => /^WARNING|^ERROR/.test(l)).slice(0, 6);
    if (warnings.length) lines.push('', ...warnings);

    console.log('[ArchAfterClipping] runtime probe\n' + text);
    new InspectModal(this.app, lines).open();
  }

  // Runs yt-dlp -F so you can see whether real formats exist or only storyboards.
  async listFormats(url) {
    const notice = new Notice('Asking yt-dlp what formats exist...', 0);
    const r = await this.runYtDlp(['-F', '--ignore-no-formats-error', url], 90000).catch((e) => ({
      code: 1,
      stdout: '',
      stderr: String(e.message),
    }));
    notice.hide();

    const text = (r.stdout || '') + '\n' + (r.stderr || '');
    const lines = [`URL: ${url}`, ''];
    const onlyImages = /Only images are available/i.test(text);
    const needsEjs = /challenge solver|EJS|JavaScript runtime/i.test(text);

    if (onlyImages || needsEjs) {
      lines.push('DIAGNOSIS: YouTube returned no real video or audio formats.');
      lines.push('This is the challenge solver problem, not a format string problem.');
      lines.push('Fix: install yt-dlp-ejs from the setup screen, or run:');
      lines.push('  pip install -U yt-dlp-ejs');
      lines.push('');
    }
    lines.push(text.trim().split('\n').slice(0, 60).join('\n'));

    console.log('[ArchAfterClipping] format list\n' + text);
    new InspectModal(this.app, lines).open();
  }

  // A pip wheel and a Homebrew formula each refuse to self-update, in their own way.
  guessInstallMethod(binPath) {
    if (!binPath) return 'unknown';
    if (binPath.startsWith(this.binDir())) return 'standalone';
    if (/Cellar|linuxbrew|homebrew/i.test(binPath)) return 'brew';
    try {
      const head = fs.readFileSync(binPath).subarray(0, 200).toString('utf8');
      if (head.startsWith('#!') && /python/i.test(head.split('\n')[0])) return 'pip';
    } catch (_) {
      /* binary or unreadable, which means it's standalone */
    }
    return 'unknown';
  }

  ytDlpAssetName() {
    if (process.platform === 'win32') return 'yt-dlp.exe';
    if (process.platform === 'darwin') return 'yt-dlp_macos';
    return process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
  }

  // Streams a URL to disk, following redirects. requestUrl would buffer 40 MB in memory.
  downloadToFile(url, destPath, onProgress, hops = 0) {
    return new Promise((resolve, reject) => {
      if (hops > 6) return reject(new Error('too many redirects'));
      const https = require('https');
      const req = https.get(
        url,
        { headers: { 'User-Agent': 'obsidian-clip-archiver' } },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            return resolve(
              this.downloadToFile(
                new URL(res.headers.location, url).toString(),
                destPath,
                onProgress,
                hops + 1
              )
            );
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
          }
          const total = Number(res.headers['content-length'] || 0);
          let done = 0;
          const out = fs.createWriteStream(destPath);
          res.on('data', (chunk) => {
            done += chunk.length;
            if (onProgress && total) onProgress(done, total);
          });
          res.pipe(out);
          out.on('finish', () => out.close(() => resolve(destPath)));
          out.on('error', reject);
        }
      );
      req.on('error', reject);
      req.setTimeout(120000, () => {
        req.destroy(new Error('download timed out'));
      });
    });
  }

  async installYtDlp() {
    const notice = new Notice('Fetching yt-dlp...', 0);
    try {
      fs.mkdirSync(this.binDir(), { recursive: true });
      const dest = path.join(this.binDir(), this.exeName('yt-dlp'));
      const tmp = dest + '.part';
      const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${this.ytDlpAssetName()}`;

      await this.downloadToFile(url, tmp, (done, total) => {
        notice.setMessage(`Fetching yt-dlp... ${Math.round((done / total) * 100)}%`);
      });

      fs.renameSync(tmp, dest);
      if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
      if (process.platform === 'darwin') {
        // An unsigned binary written by a quarantining app is blocked by Gatekeeper.
        try {
          await this.runProcess('xattr', ['-d', 'com.apple.quarantine', dest], { timeoutMs: 8000 });
        } catch (_) {
          /* usually not present, which is fine */
        }
      }

      const check = await this.runProcess(dest, ['--version'], { timeoutMs: 20000 });
      notice.hide();
      if (check.code !== 0) {
        new Notice('yt-dlp downloaded but would not run. See the developer console.', 10000);
        console.error('[ArchAfterClipping] yt-dlp check failed:', check.stderr);
        return false;
      }

      this.settings.ytDlpPath = dest;
      await this.saveSettings();
      new Notice(`yt-dlp ${check.stdout.trim()} installed.`);
      return true;
    } catch (e) {
      notice.hide();
      console.error('[ArchAfterClipping] yt-dlp install failed:', e);
      new Notice(`Could not install yt-dlp: ${e.message}`, 10000);
      return false;
    }
  }

  async updateYtDlp() {
    const bin = this.settings.ytDlpPath || 'yt-dlp';
    const notice = new Notice('Updating yt-dlp...', 0);

    const run = (cmd, args, timeoutMs = 300000) =>
      this.runProcess(cmd, args, { timeoutMs }).catch((e) => ({
        code: 1,
        stdout: '',
        stderr: String(e.message),
      }));

    // 1. The standalone binary can update itself.
    let r = await run(bin, ['-U'], 180000);
    if (r.code === 0 && !/ERROR/i.test(r.stdout + r.stderr)) {
      notice.hide();
      new Notice((r.stdout || '').trim().split('\n').slice(-1)[0] || 'yt-dlp is up to date.', 8000);
      return true;
    }

    const combined = `${r.stdout}\n${r.stderr}`;
    this.log('yt-dlp -U refused:', combined.trim());

    // 2. It told us how it was installed, so use that channel instead.
    if (/pip|PyPi|wheel/i.test(combined)) {
      notice.setMessage('Updating yt-dlp through pip...');
      const py = (await this.resolvePython()) || 'python3';
      let p = await run(py, ['-m', 'pip', 'install', '-U', 'yt-dlp']);
      // Newer distributions refuse to touch a managed environment without this.
      if (p.code !== 0 && /externally-managed|--break-system-packages/i.test(p.stdout + p.stderr)) {
        notice.setMessage('Retrying pip with --break-system-packages...');
        p = await run(py, ['-m', 'pip', 'install', '-U', '--break-system-packages', 'yt-dlp']);
      }
      notice.hide();
      if (p.code === 0) {
        const check = await run(bin, ['--version'], 20000);
        new Notice(`yt-dlp updated through pip to ${check.stdout.trim()}.`, 8000);
        return true;
      }
      console.error('[ArchAfterClipping] pip update failed:\n' + (p.stderr || p.stdout));
      new Notice(
        'pip could not update yt-dlp. Use "Install yt-dlp" in the setup screen to switch to a ' +
          'self-updating copy instead \u2014 it leaves your pip install alone.',
        14000
      );
      return false;
    }

    if (/brew|Homebrew/i.test(combined)) {
      notice.setMessage('Updating yt-dlp through Homebrew...');
      const b = await run('brew', ['upgrade', 'yt-dlp']);
      notice.hide();
      if (b.code === 0 || /already installed|up-to-date/i.test(b.stdout + b.stderr)) {
        const check = await run(bin, ['--version'], 20000);
        new Notice(`yt-dlp is at ${check.stdout.trim()}.`, 8000);
        return true;
      }
      console.error('[ArchAfterClipping] brew update failed:\n' + (b.stderr || b.stdout));
      new Notice(
        'Homebrew could not update yt-dlp. Note that the formula often lags the real release by ' +
          'weeks; "Install yt-dlp" gives you a copy that tracks it directly.',
        14000
      );
      return false;
    }

    notice.hide();
    console.error('[ArchAfterClipping] yt-dlp -U:', combined.trim());
    new Notice(
      'yt-dlp could not update itself and the install method was not recognised. ' +
        'Use "Install yt-dlp" in the setup screen.',
      12000
    );
    return false;
  }

  ffmpegAsset() {
    if (process.platform === 'win32') {
      return { name: 'ffmpeg-master-latest-win64-gpl.zip', kind: 'zip' };
    }
    if (process.platform === 'linux') {
      return process.arch === 'arm64'
        ? { name: 'ffmpeg-master-latest-linuxarm64-gpl.tar.xz', kind: 'tarxz' }
        : { name: 'ffmpeg-master-latest-linux64-gpl.tar.xz', kind: 'tarxz' };
    }
    return null; // no macOS build is published; Homebrew is the sane route there
  }

  async installFfmpeg() {
    const asset = this.ffmpegAsset();
    if (!asset) {
      new Notice(
        'There is no prebuilt ffmpeg to fetch for macOS. Install it with: brew install ffmpeg',
        12000
      );
      return false;
    }

    const notice = new Notice('Fetching ffmpeg...', 0);
    try {
      fs.mkdirSync(this.binDir(), { recursive: true });
      const archive = path.join(this.binDir(), asset.name);
      const url = `https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/${asset.name}`;

      await this.downloadToFile(url, archive, (done, total) => {
        notice.setMessage(`Fetching ffmpeg... ${Math.round((done / total) * 100)}%`);
      });

      notice.setMessage('Unpacking ffmpeg...');
      const extractDir = path.join(this.binDir(), 'ffmpeg-tmp');
      fs.mkdirSync(extractDir, { recursive: true });

      // bsdtar ships with Windows 10 1803+ and handles zip; GNU tar handles .tar.xz.
      const tarArgs =
        asset.kind === 'zip' ? ['-xf', archive, '-C', extractDir] : ['-xJf', archive, '-C', extractDir];
      const untar = await this.runProcess('tar', tarArgs, { timeoutMs: 180000 });
      if (untar.code !== 0) throw new Error(`could not unpack the archive: ${untar.stderr}`);

      const wanted = [this.exeName('ffmpeg'), this.exeName('ffprobe')];
      const found = this.findFilesNamed(extractDir, wanted);
      if (!found.length) throw new Error('no ffmpeg binary inside the archive');

      for (const src of found) {
        const dest = path.join(this.binDir(), path.basename(src));
        fs.copyFileSync(src, dest);
        if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
      }

      fs.rmSync(extractDir, { recursive: true, force: true });
      this.safeUnlink(archive);

      const check = await this.runProcess(path.join(this.binDir(), this.exeName('ffmpeg')), ['-version'], {
        timeoutMs: 20000,
      });
      notice.hide();
      if (check.code !== 0) {
        new Notice('ffmpeg downloaded but would not run. See the developer console.', 10000);
        return false;
      }

      this.settings.ffmpegLocation = this.binDir();
      await this.saveSettings();
      new Notice('ffmpeg installed.');
      return true;
    } catch (e) {
      notice.hide();
      console.error('[ArchAfterClipping] ffmpeg install failed:', e);
      new Notice(`Could not install ffmpeg: ${e.message}`, 10000);
      return false;
    }
  }

  findFilesNamed(root, names, depth = 0) {
    if (depth > 6) return [];
    let hits = [];
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch (_) {
      return [];
    }
    for (const e of entries) {
      const full = path.join(root, e.name);
      if (e.isDirectory()) hits = hits.concat(this.findFilesNamed(full, names, depth + 1));
      else if (names.includes(e.name)) hits.push(full);
    }
    return hits;
  }

  // Fills in every path setting that is still empty or pointing at something missing.
  // Returns a list of what it changed, so the setup screen can say so out loud.
  async autoConfigureFromDetection(report) {
    const filled = [];

    if (report.ytdlp.found && path.isAbsolute(report.ytdlp.path)) {
      if (report.ytdlp.path !== this.settings.ytDlpPath) {
        this.settings.ytDlpPath = report.ytdlp.path;
        filled.push(`yt-dlp path \u2192 ${report.ytdlp.path}`);
      }
    }

    if (report.ffmpeg.found && path.isAbsolute(report.ffmpeg.path)) {
      const dir = path.dirname(report.ffmpeg.path);
      if (dir !== this.settings.ffmpegLocation) {
        this.settings.ffmpegLocation = dir;
        filled.push(`ffmpeg folder \u2192 ${dir}`);
      }
    }

    if (report.python.found && !this.settings.pythonPath) {
      this.settings.pythonPath = report.python.path;
      filled.push(`Python command \u2192 ${report.python.path}`);
    }

    // Nothing downloads while the media folder is empty, so give it one.
    const tool = await this.findBinary('yt-dlp');
    if (!tool.found) {
      new Notice(
        'yt-dlp is not installed, so nothing can be downloaded. Open "Set up external tools" ' +
          'and press Install.',
        14000
      );
      return;
    }
    if (tool.path !== this.settings.ytDlpPath && path.isAbsolute(tool.path)) {
      this.settings.ytDlpPath = tool.path;
      await this.saveSettings();
      this.log('yt-dlp path corrected to', tool.path);
    }

    if (!this.settings.videoFolder) {
      this.settings.videoFolder = 'media';
      filled.push('Media folder \u2192 media (vault-relative)');
    }

    // Pick the browser whose profile was touched most recently.
    // A bare runtime name relies on yt-dlp finding it on PATH, which Electron's
    // short PATH often defeats. Naming the exact binary removes the guesswork.
    if (!this.settings.jsRuntime && report.jsRuntime && report.jsRuntime.found &&
        path.isAbsolute(report.jsRuntime.path || '')) {
      this.settings.jsRuntime = `${report.jsRuntime.name}:${report.jsRuntime.path}`;
      filled.push(`JavaScript runtime \u2192 ${this.settings.jsRuntime}`);
    }

    if (!this.settings.cookiesFile && !this.settings.cookiesFromBrowser) {
      const browsers = report.browsers || this.detectBrowsers();
      if (browsers.length) {
        this.settings.cookiesFromBrowser = browsers[0].name;
        filled.push(`Cookies from browser \u2192 ${browsers[0].name}`);
      }
    }

    if (filled.length) await this.saveSettings();
    return filled;
  }

  /* ---------------- diagnostics ---------------- */

  async diagnose(onDone = null) {
    const notice = new Notice('Looking for yt-dlp, ffmpeg, Python, browsers...', 0);
    const report = await this.detectTools();
    const filled = await this.autoConfigureFromDetection(report);
    notice.hide();
    console.log('[ArchAfterClipping] tool report', report, 'filled:', filled);
    new SetupModal(this.app, this, report, filled, onDone).open();
  }

  /* ---------------- settings ---------------- */

  // The plugin folder was renamed from clip-archiver to archive-clippings-plus,
  // which changes where Obsidian keeps data.json. Pull the old file across once.
  migrateFromOldFolder() {
    try {
      const base =
        this.app.vault.adapter && this.app.vault.adapter.getBasePath
          ? this.app.vault.adapter.getBasePath()
          : '';
      if (!base) return null;
      // Every folder this plugin has been installed under, newest first.
      const previous = ['arch-web-clipper', 'arch-clipping', 'archive-clippings-plus', 'clip-archiver'];
      for (const dir of previous) {
        const old = path.join(base, this.app.vault.configDir || '.obsidian', 'plugins', dir, 'data.json');
        if (!fs.existsSync(old)) continue;
        const parsed = JSON.parse(fs.readFileSync(old, 'utf8'));
        console.log(`[ArchAfterClipping] imported settings from the old ${dir} folder`);
        return parsed;
      }
      return null;
    } catch (e) {
      console.warn('[ArchAfterClipping] could not migrate old settings:', e);
      return null;
    }
  }

  async loadSettings() {
    let saved = (await this.loadData()) || {};
    if (!Object.keys(saved).length) {
      const migrated = this.migrateFromOldFolder();
      if (migrated) {
        saved = migrated;
        await this.saveData(saved);
      }
    }

    // The order named v-rank until YT Playlists 1.4.4 renamed it rank. Only
    // the exact old default moves; anything else was typed and stays.
    if (saved.frontmatterOrder === 'media, channel, yt-playlist, banner, url, dl-ed, v-rank, duration, status, published, tags') {
      saved.frontmatterOrder = DEFAULT_SETTINGS.frontmatterOrder;
    }
    // Migrate from Auto Download Video After Web Clipping 1.x
    if (saved.downloadFolder && !saved.videoFolder) saved.videoFolder = saved.downloadFolder;
    if (Array.isArray(saved.clipFolders) && saved.watchAllFolders === undefined) {
      saved.watchAllFolders = false;
    }
    // A saved otherArchKeys list shadows the default entirely, so a vault that
    // configured this before ARCH X Archive existed would keep probing every X
    // note with yt-dlp. Missing markers are appended rather than the list being
    // replaced, so a hand-added key of the user's own survives.
    if (Array.isArray(saved.otherArchKeys)) {
      for (const key of DEFAULT_SETTINGS.otherArchKeys) {
        if (!saved.otherArchKeys.includes(key)) saved.otherArchKeys.push(key);
      }
    }
    if (Array.isArray(saved.otherArchTags)) {
      for (const tag of DEFAULT_SETTINGS.otherArchTags) {
        if (!saved.otherArchTags.includes(tag)) saved.otherArchTags.push(tag);
      }
    }
    // Migrate the single URL property name into the candidate list, keeping it first.
    if (saved.frontmatterUrlKey && !saved.frontmatterUrlKeys) {
      const rest = DEFAULT_SETTINGS.frontmatterUrlKeys.filter((k) => k !== saved.frontmatterUrlKey);
      saved.frontmatterUrlKeys = [saved.frontmatterUrlKey, ...rest];
      delete saved.frontmatterUrlKey;
    }

    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    // Guard against half-migrated arrays.
    // A vault upgrading from an older build has no location mode. Derive one
    // that reproduces exactly what it was doing before, rather than defaulting
    // it and silently moving where files land.
    // 'trash' no longer exists. Anyone carrying it gets the non-destructive
    // behaviour rather than silently keeping a setting that does nothing.
    if (saved.duplicateAction === 'trash') this.settings.duplicateAction = 'warn';

    if (saved.imageLocationMode === undefined) {
      saved.imageLocationMode = saved.imageFolder ? 'specified' : 'obsidian';
    }
    if (saved.videoLocationMode === undefined) saved.videoLocationMode = 'specified';

    for (const key of ['clipFolders', 'excludeFolders', 'imageFolders', 'otherArchKeys', 'otherArchTags', 'frontmatterImageKeys', 'frontmatterUrlKeys', 'processedUrls']) {
      if (!Array.isArray(this.settings[key])) this.settings[key] = DEFAULT_SETTINGS[key].slice();
    }
    if (!this.settings.frontmatterImageLabels || typeof this.settings.frontmatterImageLabels !== 'object') {
      this.settings.frontmatterImageLabels = {};
    }
    if (!Array.isArray(this.settings.transformRules)) {
      this.settings.transformRules = DEFAULT_SETTINGS.transformRules.map((r) => ({ ...r }));
    }
    // An unclaimed vault is claimed by the first computer to load this version,
    // so a vault never runs its automatic work on two computers by default.
    if (!this.computer) this.computer = computerName();
    if (!this.settings.automaticOn) {
      this.settings.automaticOn = this.computer;
      await this.saveData(this.settings);
      this.log('automatic work claimed for this computer:', this.computer);
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // The settings file changed on disk under a running Obsidian: with the vaults
  // mirrored, an edit made on the other computer. Without reloading, the next
  // save here would write the old settings back over it.
  async onExternalSettingsChange() {
    await this.loadSettings();
    this.log('settings changed on disk (the other computer?), reloaded; automatic work runs on', this.settings.automaticOn);
  }
};

/* ------------------------------------------------------------------ *
 * Modals
 * ------------------------------------------------------------------ */

// The "Save the video" dropdown in the download popup (1.16.0). Shown only
// when Videos outside the vault is set. Preselects the default place; the
// drive's entry is disabled while it is not plugged in, so the vault is what
// is left. The same function is in ARCH YT Playlists; change both together.
function renderPlaceChoice(el, info, onPick) {
  if (!info || !info.drive) return;
  const row = el.createDiv({
    attr: { style: 'display:flex; align-items:center; gap:8px; margin-top:10px;' },
  });
  row.createEl('label', { text: 'Save the video:', attr: { style: 'font-size:var(--font-ui-smaller);' } });
  const sel = row.createEl('select', { cls: 'dropdown' });
  const drive = sel.createEl('option', {
    text: info.mounted ? `On ${info.drive}` : `On ${info.drive} (not plugged in)`,
    attr: { value: 'drive' },
  });
  if (!info.mounted) drive.disabled = true;
  sel.createEl('option', { text: 'In the vault', attr: { value: 'vault' } });
  sel.value = info.place;
  sel.onchange = () => onPick(sel.value);
  if (info.fallback) {
    el.createEl('p', {
      text: `${info.drive} is not plugged in, so the video goes in the vault for now and moves to the drive once it is back (if that setting is on).`,
      attr: { style: 'font-size:var(--font-ui-smaller); opacity:.7; margin-top:4px;' },
    });
  }
}

class DownloadModeModal extends Modal {
  constructor(app, noteName, url, onChoice, placeInfo) {
    super(app);
    this.noteName = noteName;
    this.url = url;
    this.onChoice = onChoice;
    this.answered = false;
    this.remember = false;
    this.placeInfo = placeInfo || null;
    this.place = placeInfo ? placeInfo.place : 'vault';
  }

  onOpen() {
    const { contentEl, titleEl } = this;
    titleEl.setText('Download this media?');

    contentEl.createEl('p', { text: this.noteName });
    contentEl.createEl('p', {
      text: this.url,
      cls: 'mod-muted',
      attr: { style: 'font-size:var(--font-ui-smaller); word-break:break-all; opacity:.7;' },
    });

    const choose = (mode) => {
      this.answered = true;
      this.onChoice(mode, this.remember, this.place);
      this.close();
    };

    const row = contentEl.createDiv({
      attr: { style: 'display:flex; flex-wrap:wrap; gap:8px; margin-top:14px;' },
    });

    const b1 = row.createEl('button', { text: 'Video + Audio', cls: 'mod-cta' });
    b1.onclick = () => choose('video_and_audio');

    const b2 = row.createEl('button', { text: 'Video' });
    b2.onclick = () => choose('video_only');

    const b3 = row.createEl('button', { text: 'Audio' });
    b3.onclick = () => choose('audio_only');

    const b5 = row.createEl('button', { text: 'Subtitles' });
    b5.onclick = () => choose('subs_only');

    const b4 = row.createEl('button', { text: 'Skip' });
    b4.onclick = () => choose('skip');

    contentEl.createEl('p', {
      text: 'Video + Audio saves the video file and a separate audio file. Video saves one file with sound. Audio saves the soundtrack only. Subtitles saves only the subtitle file, where the video would go.',
      attr: { style: 'font-size:var(--font-ui-smaller); opacity:.7; margin-top:12px;' },
    });

    renderPlaceChoice(contentEl, this.placeInfo, (p) => {
      this.place = p;
    });

    const rememberRow = contentEl.createDiv({
      attr: { style: 'display:flex; align-items:center; gap:8px; margin-top:8px;' },
    });
    const cb = rememberRow.createEl('input', { type: 'checkbox' });
    cb.id = 'clip-archiver-remember';
    cb.onchange = () => {
      this.remember = cb.checked;
    };
    rememberRow.createEl('label', {
      text: 'Use this choice for the rest of this session',
      attr: { for: 'clip-archiver-remember', style: 'font-size:var(--font-ui-smaller);' },
    });

    b1.focus();
  }

  onClose() {
    this.contentEl.empty();
    if (!this.answered) this.onChoice('skip', false);
  }
}

const GUIDE = [
  ['What it does',
   'When Web Clipper saves a page, this plugin finishes the job: it pulls the ' +
   'images into the vault, repoints the links at them, runs a site script over ' +
   'the body if one matches, and offers to download any video or audio.\n\n' +
   'Nothing needs to be run by hand. Saving the clip is the whole workflow.'],

  ['The one thing to set up',
   'Open Set up external tools. It finds yt-dlp, ffmpeg, Python and your ' +
   'browser cookies, fills the paths in, and installs anything missing.\n\n' +
   'Then set the media folder. That is the entire setup.'],

  ['What happens to a clip',
   '1. The note is renamed to "Channel \u2014 Title", if the page is a video.\n' +
   '2. Images are downloaded; the img property and body links point at the local copies.\n' +
   '3. A matching site script rewrites the body.\n' +
   '4. You are asked what to download: Video + Audio, Video, Audio, or Skip.\n' +
   '5. Files land in the media folder, named after the note, and get embedded.'],

  ['Why the video and the note share a name',
   'The note, the video and the audio all carry the same name, so they sort ' +
   'together and stay findable. Editing the note name by hand is respected: the ' +
   'channel is added to what you wrote rather than replacing it with YouTube\u2019s title.'],

  ['Video + Audio is one download',
   'The video already contains the audio, so the mp3 is extracted from it locally ' +
   'instead of downloading the same stream twice. If that fails, the audio is ' +
   'downloaded as a fallback, so you always end up with both files.'],

  ['Thumbnails',
   'Every clip\u2019s thumbnail is downloaded into the vault and recorded in the ' +
   'img property, which is what Bases reads to show a gallery.\n\n' +
   'It is not shown on the video player. Several approaches were tried and none ' +
   'held up, so the image lives on disk and in the note rather than on the player.'],

  ['The video embed',
   'Notes get a plain embed of the downloaded file and nothing plugin-specific, ' +
   'so the video still plays if this plugin is ever disabled or missing, and any ' +
   'media player plugin you use handles it normally.'],

  ['Clipping the same page twice',
   'The duplicate is spotted, the original is opened instead, and the copy goes ' +
   'to trash. Without this the whole pipeline runs again and the video downloads twice.'],

  ['Site scripts',
   'A rule is a name, a URL pattern and a Python file in the transformers folder. ' +
   'The note body arrives on stdin and the rewritten body is expected on stdout, ' +
   'so adding a site means dropping in a script and adding a rule.\n\n' +
   'A script that does not recognise its input returns it unchanged, and empty ' +
   'output is refused, so a script can never blank a note.'],

  ['When something looks wrong',
   'Inspect this note shows exactly what the plugin can see: the source URL and ' +
   'which property it came from, whether the address counts as media, which script ' +
   'matches, and whether the media folder is set.\n\n' +
   'Set up external tools reports tool versions and flags a yt-dlp build old ' +
   'enough to cause 403 errors, which is the usual reason a download fails.'],
];

// The popup for deleting a note whose video is on the drive (1.17.0).
class DriveMediaDeleteModal extends Modal {
  constructor(app, groups, onDelete) {
    super(app);
    this.groups = groups;
    this.onDelete = onDelete;
  }

  onOpen() {
    const { contentEl, titleEl } = this;
    titleEl.setText(this.groups.length > 1 ? "Delete these notes' media too?" : "Delete this note's media too?");
    for (const g of this.groups) {
      contentEl.createEl('p', { text: g.note.replace(/\.md$/, ''), attr: { style: 'font-weight:600; margin-bottom:4px;' } });
      const ul = contentEl.createEl('ul', { attr: { style: 'margin-top:0;' } });
      for (const it of g.items) {
        const li = ul.createEl('li', { text: it.label });
        if (it.off) li.createEl('div', { text: it.off, attr: { style: 'font-size:var(--font-ui-smaller); opacity:.7;' } });
      }
    }
    contentEl.createEl('p', {
      text: 'The video goes to the macOS Trash and the rest to the vault trash, so nothing is lost until the trash is emptied.',
      attr: { style: 'font-size:var(--font-ui-smaller); opacity:.7;' },
    });
    const row = contentEl.createDiv({ cls: 'modal-button-container' });
    const del = row.createEl('button', { text: 'Delete', cls: 'mod-warning' });
    del.onclick = () => {
      this.close();
      this.onDelete();
    };
    const keep = row.createEl('button', { text: 'Keep' });
    keep.onclick = () => this.close();
    keep.focus();
  }

  onClose() {
    this.contentEl.empty();
  }
}

class GuideModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    this.titleEl.setText('ARCH After Clipping');
    contentEl.createEl('p', {
      text: `Version ${this.plugin.manifest.version}`,
      attr: { style: 'font-size:var(--font-ui-smaller); opacity:.6; margin:0 0 16px;' },
    });
    for (const [heading, body] of GUIDE) {
      contentEl.createEl('h3', { text: heading, attr: { style: 'margin:18px 0 6px;' } });
      for (const para of body.split('\n\n')) {
        contentEl.createEl('p', {
          text: para,
          attr: { style: 'margin:0 0 8px; line-height:1.5;' },
        });
      }
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

class InspectModal extends Modal {
  constructor(app, lines) {
    super(app);
    this.lines = lines;
  }

  onOpen() {
    this.titleEl.setText('What Clip Archiver sees');
    const pre = this.contentEl.createEl('pre', {
      attr: {
        style:
          'white-space:pre-wrap; word-break:break-all; user-select:text; ' +
          'font-size:var(--font-ui-smaller); line-height:1.6;',
      },
    });
    pre.setText(this.lines.join('\n'));
  }

  onClose() {
    this.contentEl.empty();
  }
}

class SetupModal extends Modal {
  constructor(app, plugin, report, filled = [], onDone = null) {
    super(app);
    this.plugin = plugin;
    this.report = report;
    this.filled = filled;
    this.onDone = onDone;
  }

  onOpen() {
    this.titleEl.setText('External tools');
    this.render();
  }

  async refresh() {
    this.report = await this.plugin.detectTools();
    this.filled = await this.plugin.autoConfigureFromDetection(this.report);
    this.render();
  }

  row(label, state, detail, action) {
    const s = new Setting(this.contentEl).setName(label);
    s.setDesc(detail);
    s.nameEl.prepend(
      createSpan({
        text: state === 'ok' ? '\u25CF ' : state === 'warn' ? '\u25CF ' : '\u25CB ',
        attr: {
          style: `color: var(--color-${state === 'ok' ? 'green' : state === 'warn' ? 'yellow' : 'red'});`,
        },
      })
    );
    if (action) s.addButton((b) => b.setButtonText(action.label).onClick(action.onClick));
    return s;
  }

  render() {
    const { contentEl } = this;
    const r = this.report;
    const s = this.plugin.settings;
    contentEl.empty();

    contentEl.createEl('p', {
      text: `${process.platform} ${process.arch}`,
      attr: { style: 'font-size:var(--font-ui-smaller); opacity:.6; margin:0 0 12px;' },
    });

    if (this.filled.length) {
      const box = contentEl.createDiv({
        attr: {
          style:
            'border-left:3px solid var(--color-green); padding:8px 12px; margin-bottom:14px; ' +
            'background:var(--background-secondary); border-radius:4px;',
        },
      });
      box.createEl('div', {
        text: 'Filled in for you',
        attr: { style: 'font-weight:600; margin-bottom:4px;' },
      });
      for (const line of this.filled) {
        box.createEl('div', {
          text: line,
          attr: { style: 'font-size:var(--font-ui-smaller); opacity:.85; word-break:break-all;' },
        });
      }
    }

    // yt-dlp
    const stale = r.ytdlp.found && r.ytdlp.ageDays !== null && r.ytdlp.ageDays > 30;
    let ytDetail;
    if (r.ytdlp.found) {
      ytDetail = `${r.ytdlp.version}, ${r.ytdlp.ageDays} days old, installed with ${r.ytdlp.installMethod}\n${r.ytdlp.path}`;
      if (r.ytdlp.knownBad) ytDetail += `\n${r.ytdlp.knownBad}`;
      else if (stale) ytDetail += '\nOld builds are the most common cause of 403 errors.';
    } else {
      ytDetail = 'Required for video and audio. A self-updating copy can be installed into this plugin\u2019s folder.';
    }
    const ytRow = this.row(
      'yt-dlp',
      r.ytdlp.found ? (r.ytdlp.knownBad ? 'missing' : stale ? 'warn' : 'ok') : 'missing',
      ytDetail,
      r.ytdlp.found
        ? { label: 'Update', onClick: async () => { await this.plugin.updateYtDlp(); this.refresh(); } }
        : { label: 'Install', onClick: async () => { await this.plugin.installYtDlp(); this.refresh(); } }
    );
    if (r.ytdlp.found && r.ytdlp.installMethod !== 'standalone') {
      ytRow.addButton((b) =>
        b
          .setButtonText('Install standalone')
          .setTooltip('Downloads a self-updating copy into the plugin folder. Your existing install is left untouched.')
          .onClick(async () => {
            await this.plugin.installYtDlp();
            this.refresh();
          })
      );
    }

    // ffmpeg
    const macNoBuild = process.platform === 'darwin' && !r.ffmpeg.found;
    this.row(
      'ffmpeg',
      r.ffmpeg.found ? 'ok' : 'missing',
      r.ffmpeg.found
        ? `${r.ffmpeg.version}\n${r.ffmpeg.path}`
        : macNoBuild
          ? 'Needed to merge video with audio and to make mp3 files. No prebuilt macOS copy is published, so install it with: brew install ffmpeg'
          : 'Needed to merge video with audio and to make mp3 files.',
      r.ffmpeg.found || macNoBuild
        ? null
        : { label: 'Install', onClick: async () => { await this.plugin.installFfmpeg(); this.refresh(); } }
    );

    // JavaScript runtime
    this.row(
      'JavaScript runtime',
      r.jsRuntime.found ? 'ok' : 'warn',
      r.jsRuntime.found
        ? `${r.jsRuntime.name} ${r.jsRuntime.version}`
        : 'yt-dlp uses one to solve YouTube\u2019s challenges. Without it some formats fail with 403. ' +
          'Install Deno or Node and it will be picked up automatically.',
      null
    );

    // YouTube challenge solver
    const ejs = r.ejs || { found: false, how: 'unknown', installable: false };
    this.row(
      'YouTube challenge solver',
      ejs.found ? 'ok' : 'missing',
      ejs.found
        ? ejs.how
        : `${ejs.how}. Without it YouTube returns only storyboard images and yt-dlp reports ` +
          '"Requested format is not available", which points at the wrong thing.',
      ejs.installable
        ? { label: 'Install', onClick: async () => { await this.plugin.installEjs(); this.refresh(); } }
        : null
    );

    // Python
    this.row(
      'Python',
      r.python.found ? 'ok' : 'warn',
      r.python.found
        ? `${r.python.version}\n${r.python.path}`
        : 'Only needed for the site transformers. Video and image downloading work without it.',
      null
    );

    // Cookies, with a picker over whatever browsers are actually installed.
    let cookieState = 'warn';
    let cookieDetail = 'None configured. YouTube will refuse some downloads without them.';
    if (s.cookiesFile) {
      if (fs.existsSync(s.cookiesFile)) {
        const days = Math.floor((Date.now() - fs.statSync(s.cookiesFile).mtimeMs) / 86400000);
        cookieState = days > 21 ? 'warn' : 'ok';
        cookieDetail = `File exported ${days} days ago.${days > 21 ? ' Exported cookies go stale; re-export or switch to reading them from the browser.' : ''}`;
      } else {
        cookieState = 'missing';
        cookieDetail = `No file at ${s.cookiesFile}`;
      }
    } else if (s.cookiesFromBrowser) {
      cookieState = 'ok';
      cookieDetail = `Read from ${s.cookiesFromBrowser} on each run.`;
    }

    const cookieRow = this.row('Cookies', cookieState, cookieDetail, null);
    if ((r.browsers || []).length && !s.cookiesFile) {
      cookieRow.addDropdown((d) => {
        d.addOption('', 'None');
        for (const b of r.browsers) d.addOption(b.name, b.name);
        d.setValue(s.cookiesFromBrowser || '');
        d.onChange(async (v) => {
          s.cookiesFromBrowser = v;
          await this.plugin.saveSettings();
          this.render();
        });
      });
      if (s.cookiesFromBrowser) {
        cookieRow.addButton((b) =>
          b.setButtonText('Test').onClick(async () => {
            const n = new Notice(`Testing ${s.cookiesFromBrowser} cookies...`, 0);
            const res = await this.plugin.testCookies(s.cookiesFromBrowser);
            n.hide();
            new Notice(
              res.ok
                ? `${s.cookiesFromBrowser} cookies work.`
                : `${s.cookiesFromBrowser} cookies failed: ${res.detail || 'see console'}`,
              10000
            );
          })
        );
      }
    }

    // transformers
    const dir = path.join(this.plugin.pluginDir(), 'transformers');
    let scripts = [];
    try {
      scripts = fs.readdirSync(dir).filter((f) => f.endsWith('.py'));
    } catch (_) {
      /* folder missing */
    }
    this.row(
      'Transformer scripts',
      scripts.length ? 'ok' : 'missing',
      scripts.length ? scripts.join(', ') : `No .py files in ${dir}`,
      null
    );

    new Setting(contentEl)
      .addButton((b) => b.setButtonText('Check again').onClick(() => this.refresh()))
      .addButton((b) => b.setButtonText('Close').setCta().onClick(() => this.close()));
  }

  onClose() {
    this.contentEl.empty();
    if (this.onDone) this.onDone();
  }
}

/* ------------------------------------------------------------------ *
 * Settings tab
 * ------------------------------------------------------------------ */

class ClipArchiverSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  save() {
    return this.plugin.saveSettings();
  }

  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();

    new Setting(containerEl)
      .setName('How this plugin works')
      .setDesc('A short guide to what happens to a clip and where to look when something goes wrong.')
      .addButton((b) =>
        b.setButtonText('Read the guide').onClick(() => new GuideModal(this.app, this.plugin).open())
      );

    new Setting(containerEl)
      .setName('Archive new notes automatically')
      .setDesc('Turn this off to keep the ribbon button and commands but stop the automatic run.')
      .addToggle((t) =>
        t.setValue(s.enabled).onChange(async (v) => {
          s.enabled = v;
          await this.save();
        })
      );

    /* ---- scope ---- */
    new Setting(containerEl).setName('What to watch').setHeading();

    new Setting(containerEl)
      .setName('Watch every folder')
      .setDesc('Any new markdown note gets archived, wherever it lands. Turn off to name specific folders.')
      .addToggle((t) =>
        t.setValue(s.watchAllFolders).onChange(async (v) => {
          s.watchAllFolders = v;
          await this.save();
          this.display();
        })
      );

    if (!s.watchAllFolders) {
      new Setting(containerEl)
        .setName('Folders to watch')
        .setDesc('Comma-separated, vault-relative. Example: +, Clippings, Inbox/Web')
        .addText((t) =>
          t.setValue(s.clipFolders.join(', ')).onChange(async (v) => {
            s.clipFolders = splitList(v);
            await this.save();
          })
        );
    }

    new Setting(containerEl)
      .setName('Folders to ignore')
      .setDesc('Checked before everything else. Useful for a music or archive folder you never clip into.')
      .addText((t) =>
        t.setValue(s.excludeFolders.join(', ')).onChange(async (v) => {
          s.excludeFolders = splitList(v);
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('Source URL properties')
      .setDesc(
        'Comma-separated, tried in order. Web Clipper\u2019s default template uses "source"; ' +
          'custom templates often use "url". If none match, any property holding a web address is used.'
      )
      .addText((t) =>
        t.setValue(s.frontmatterUrlKeys.join(', ')).onChange(async (v) => {
          s.frontmatterUrlKeys = splitList(v);
          if (!s.frontmatterUrlKeys.length) {
            s.frontmatterUrlKeys = DEFAULT_SETTINGS.frontmatterUrlKeys.slice();
          }
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('When a page is already clipped')
      .setDesc('Matched on the url property. Both notes are always kept \u2014 nothing is ever deleted.')
      .addDropdown((d) =>
        d
          .addOption('warn', 'Tell me')
          .addOption('ignore', 'Do nothing')
          .setValue(s.duplicateAction === 'ignore' ? 'ignore' : 'warn')
          .onChange(async (v) => {
            s.duplicateAction = v;
            await this.save();
          })
      );

    /* ---- images ---- */
    new Setting(containerEl).setName('Images').setHeading();

    new Setting(containerEl)
      .setName('Download images into the vault')
      .addToggle((t) =>
        t.setValue(s.downloadImages).onChange(async (v) => {
          s.downloadImages = v;
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('Leave notes owned by another ARCH plugin alone')
      .setDesc(
        'Comma-separated property names. A note carrying any of them is skipped by the automatic pass. ' +
          'ARCH YT Playlists writes yt-playlist on video notes and dl-all on playlist notes; ' +
          'ARCH X Archive writes x-author and x-name on both of its note types. ' +
          'Commands run by hand still work on those notes.'
      )
      .addText((t) =>
        t.setValue((s.otherArchKeys || []).join(', ')).onChange(async (v) => {
          s.otherArchKeys = splitList(v);
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('Leave notes carrying these tags alone')
      .setDesc(
        'Comma-separated tags, the same skip by tag rather than by property. ' +
          'ARCH YT Playlists tags its channel notes yt-channel and writes no marker property on them; ' +
          'without this, a channel note\'s url would send yt-dlp after the whole channel.'
      )
      .addText((t) =>
        t.setValue((s.otherArchTags || []).join(', ')).onChange(async (v) => {
          s.otherArchTags = splitList(v).map((x) => x.replace(/^#/, ''));
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('Download images only in these folders')
      .setDesc(
        'Comma-separated, subfolders included. Leave blank for every folder. ' +
          'Media is not affected: videos still download anywhere the plugin runs. ' +
          'Running "Download images for this note" by hand ignores this list.'
      )
      .addText((t) =>
        t.setValue((s.imageFolders || []).join(', ')).onChange(async (v) => {
          s.imageFolders = splitList(v);
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('Image location')
      .setDesc('Where downloaded images are saved, using the same choices as Obsidian\'s own attachment setting.')
      .addDropdown((d) =>
        d
          .addOption('obsidian', 'Follow Obsidian\'s attachment setting')
          .addOption('vault', 'Vault folder')
          .addOption('same', 'Same folder as the note')
          .addOption('subfolder', 'In subfolder under the note')
          .addOption('specified', 'In the folder specified below')
          .setValue(s.imageLocationMode || 'obsidian')
          .onChange(async (v) => {
            s.imageLocationMode = v;
            await this.save();
            this.display();
          })
      );

    if (s.imageLocationMode === 'subfolder') {
      new Setting(containerEl)
        .setName('Image subfolder name')
        .setDesc('Created inside the note\'s own folder. Supports {{notename}} and {{date}}.')
        .addText((t) =>
          t.setValue(s.imageSubfolder).onChange(async (v) => {
            s.imageSubfolder = v.trim() || DEFAULT_SETTINGS.imageSubfolder;
            await this.save();
          })
        );
    }

    if (s.imageLocationMode === 'specified') {
      new Setting(containerEl)
        .setName('Image folder')
        .setDesc('Path from the vault root. Supports {{notename}}, {{notepath}} and {{date}}.')
        .addText((t) =>
          t.setValue(s.imageFolder).onChange(async (v) => {
            s.imageFolder = v.trim();
            await this.save();
          })
        );
    }

    new Setting(containerEl)
      .setName('Image file name')
      .setDesc('Supports {{notename}} and {{index}}.')
      .addText((t) =>
        t.setValue(s.imageNameTemplate).onChange(async (v) => {
          s.imageNameTemplate = v.trim() || DEFAULT_SETTINGS.imageNameTemplate;
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('Repoint image properties too')
      .setDesc('Rewrites frontmatter properties that hold a picture address into a [[wikilink]] to the saved file, keeping any label the value carried.')
      .addToggle((t) =>
        t.setValue(s.rewriteFrontmatterImages).onChange(async (v) => {
          s.rewriteFrontmatterImages = v;
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('Image properties')
      .setDesc('Comma-separated property names to check.')
      .addText((t) =>
        t.setValue(s.frontmatterImageKeys.join(', ')).onChange(async (v) => {
          s.frontmatterImageKeys = splitList(v);
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('Labels for image properties')
      .setDesc('Comma-separated property=Label pairs, used when the value has no label of its own. A label the template already gave, as in [Thumbnail](url), is kept. A property listed here is written as [[file.webp|Label]]; any other stays a bare [[file.webp]]. Example: banner=Banner, icon=Icon')
      .addText((t) =>
        t.setPlaceholder('banner=Banner, icon=Icon')
          .setValue(joinLabels(s.frontmatterImageLabels)).onChange(async (v) => {
            s.frontmatterImageLabels = parseLabels(v);
            await this.save();
          })
      );

    /* ---- transform ---- */
    new Setting(containerEl).setName('Transform').setHeading();

    new Setting(containerEl)
      .setName('Run a site script on the body')
      .setDesc('Matches the source URL against the rules below and pipes the note body through that script.')
      .addToggle((t) =>
        t.setValue(s.enableTransform).onChange(async (v) => {
          s.enableTransform = v;
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('Python command')
      .setDesc('Leave blank to look for python3, then python. Set a full path if that fails.')
      .addText((t) =>
        t.setValue(s.pythonPath).setPlaceholder('python3').onChange(async (v) => {
          s.pythonPath = v.trim();
          this.plugin.resolvedPython = null;
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('Keep a copy before transforming')
      .setDesc('Writes the untouched note into the backup folder first. Off means the transform is final.')
      .addToggle((t) =>
        t.setValue(s.backupBeforeTransform).onChange(async (v) => {
          s.backupBeforeTransform = v;
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('Backup folder')
      .addText((t) =>
        t.setValue(s.backupFolder).onChange(async (v) => {
          s.backupFolder = v.trim() || '_raw';
          await this.save();
        })
      );

    const rulesBox = containerEl.createDiv();
    const renderRules = () => {
      rulesBox.empty();
      rulesBox.createEl('p', {
        text:
          'Rules run top to bottom; the first URL match wins. A pattern is plain text matched anywhere ' +
          'in the address, or a regular expression wrapped in slashes. Scripts live in the plugin\u2019s ' +
          'transformers folder.',
        attr: { style: 'font-size:var(--font-ui-smaller); opacity:.75;' },
      });

      s.transformRules.forEach((rule, i) => {
        const row = new Setting(rulesBox).setName(`Rule ${i + 1}`);
        row.addText((t) =>
          t
            .setPlaceholder('Name')
            .setValue(rule.name)
            .onChange(async (v) => {
              rule.name = v;
              await this.save();
            })
        );
        row.addText((t) =>
          t
            .setPlaceholder('reddit.com')
            .setValue(rule.pattern)
            .onChange(async (v) => {
              rule.pattern = v.trim();
              await this.save();
            })
        );
        row.addText((t) =>
          t
            .setPlaceholder('reddit_thread.py')
            .setValue(rule.script)
            .onChange(async (v) => {
              rule.script = v.trim();
              await this.save();
            })
        );
        row.addExtraButton((b) =>
          b
            .setIcon('trash')
            .setTooltip('Remove this rule')
            .onClick(async () => {
              s.transformRules.splice(i, 1);
              await this.save();
              renderRules();
            })
        );
      });

      new Setting(rulesBox).addButton((b) =>
        b.setButtonText('Add rule').onClick(async () => {
          s.transformRules.push({ name: 'New site', pattern: '', script: '' });
          await this.save();
          renderRules();
        })
      );
    };
    renderRules();

    /* ---- media ---- */
    new Setting(containerEl).setName('Video and audio').setHeading();

    new Setting(containerEl)
      .setName('Download media with yt-dlp')
      .addToggle((t) =>
        t.setValue(s.downloadVideo).onChange(async (v) => {
          s.downloadVideo = v;
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('Mark the note as downloaded')
      .setDesc(
        'A property set to true alongside media, once the files are on disk — so it never claims a download that failed. ' +
          'Leave this empty to write nothing.'
      )
      .addText((t) =>
        t
          .setPlaceholder('dl-ed')
          .setValue(s.markDownloadedKey)
          .onChange(async (v) => {
            s.markDownloadedKey = v.trim();
            await this.save();
          })
      );

    new Setting(containerEl)
      .setName('Property order')
      .setDesc(
        'Comma-separated. Decides where a property this plugin adds (media, dl-ed) goes: after the nearest listed property ' +
          'the note already has. Properties already on the note are never moved. The default matches ARCH YT Playlists, so ' +
          'a video note reads the same whichever plugin downloaded its media. Leave empty to append new properties at the end.'
      )
      .addText((t) =>
        t
          .setPlaceholder(DEFAULT_SETTINGS.frontmatterOrder)
          .setValue(s.frontmatterOrder)
          .onChange(async (v) => {
            s.frontmatterOrder = v.trim();
            await this.save();
          })
      );

    new Setting(containerEl)
      .setName('Media location')
      .setDesc('Where downloaded video and audio are saved. Applies in every folder the plugin watches, not just the image folders.')
      .addDropdown((d) =>
        d
          .addOption('vault', 'Vault folder')
          .addOption('same', 'Same folder as the note')
          .addOption('subfolder', 'In subfolder under the note')
          .addOption('specified', 'In the folder specified below')
          .setValue(s.videoLocationMode || 'specified')
          .onChange(async (v) => {
            s.videoLocationMode = v;
            await this.save();
            this.display();
          })
      );

    if (s.videoLocationMode === 'subfolder') {
      new Setting(containerEl)
        .setName('Media subfolder name')
        .setDesc('Created inside the note\'s own folder. Supports {{notename}} and {{date}}.')
        .addText((t) =>
          t.setValue(s.videoSubfolder).onChange(async (v) => {
            s.videoSubfolder = v.trim() || DEFAULT_SETTINGS.videoSubfolder;
            await this.save();
          })
        );
    }

    if ((s.videoLocationMode || 'specified') === 'specified') {
      new Setting(containerEl)
        .setName('Media folder')
        .setDesc('Absolute path, or vault-relative. Required before anything will download.')
        .addText((t) =>
          t.setValue(s.videoFolder).onChange(async (v) => {
            s.videoFolder = v.trim();
            await this.save();
          })
        );
    }

    new Setting(containerEl)
      .setName('Videos outside the vault')
      .setDesc(
        'An absolute folder on another drive, e.g. /Volumes/4T-HDD/Media. When set, a downloaded video goes there instead, ' +
          'under this vault\'s name and the same folders it would have had in the vault; subtitles and audio stay in the vault. ' +
          'The note\'s media property links it as file:///…, which Media Extended plays. Nothing is downloaded while that drive ' +
          'is unplugged. Leave empty to keep videos in the vault.'
      )
      .addText((t) =>
        t
          .setPlaceholder('/Volumes/4T-HDD/Media')
          .setValue(s.externalVideoFolder || '')
          .onChange(async (v) => {
            s.externalVideoFolder = v.trim();
            await this.save();
          })
      );

    new Setting(containerEl)
      .setName('Keep videos in the vault in these folders')
      .setDesc(
        'Vault folders, one per line, whose videos stay in the vault even when Videos outside the vault is set: ' +
          'the sensitive ones, like Temp Videos. Their default in the download popup and for the commands is the vault. ' +
          'ARCH YT Playlists has the same setting; keep the two the same.'
      )
      .addTextArea((t) =>
        t
          .setPlaceholder('Temp Videos')
          .setValue(s.keepVideosInVault || '')
          .onChange(async (v) => {
            s.keepVideosInVault = v;
            await this.save();
          })
      );

    new Setting(containerEl)
      .setName('Move videos to the drive when it is back')
      .setDesc(
        'A video saved in the vault only because the drive was not plugged in waits in a queue, and moves to the drive ' +
          'within a minute of it being plugged in. A video you chose to keep in the vault never moves. ' +
          `Waiting now: ${(s.driveMoveQueue || []).length}.`
      )
      .addToggle((t) =>
        t.setValue(s.moveToDriveWhenBack !== false).onChange(async (v) => {
          s.moveToDriveWhenBack = v;
          await this.save();
        })
      );

    {
      const here = this.plugin.computer;
      const cur = s.automaticOn || here;
      new Setting(containerEl)
        .setName('Automatic work runs on')
        .setDesc(
          'The one computer that processes new notes, catches up clips at startup and moves waiting videos to the drive. ' +
            'The vaults are mirrored between computers, so a note clipped on one arrives on the other as new; with Obsidian open ' +
            'on both, both would process it. Commands, menus and the delete popup work on every computer. ' +
            `This computer is ${here}.`
        )
        .addDropdown((d) => {
          d.addOption(here, `${here} (this computer)`);
          if (cur !== here && cur !== '*') d.addOption(cur, cur);
          d.addOption('*', 'Every computer');
          d.setValue(cur).onChange(async (v) => {
            s.automaticOn = v;
            await this.save();
          });
        });
    }

    new Setting(containerEl)
      .setName('Relink script')
      .setDesc(
        'relink-videos.py, which makes notes\' file:/// links follow a video moved or renamed on the drive. ' +
          'Run it with the command "Relink videos on the outside drive". Filled in when found in ~/Documents/backup-strategy.'
      )
      .addText((t) =>
        t
          .setPlaceholder('~/Documents/backup-strategy/relink-videos.py')
          .setValue(s.relinkScript || '')
          .onChange(async (v) => {
            s.relinkScript = v.trim();
            await this.save();
          })
      );

    new Setting(containerEl)
      .setName('Ask what to download')
      .setDesc('Shows the video / audio choice for each clip. Turn off to use the default below silently.')
      .addToggle((t) =>
        t.setValue(s.askDownloadMode).onChange(async (v) => {
          s.askDownloadMode = v;
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('Default choice')
      .addDropdown((d) =>
        d
          .addOption('video_and_audio', 'Video + Audio')
          .addOption('video_only', 'Video')
          .addOption('audio_only', 'Audio')
          .addOption('subs_only', 'Subtitles')
          .setValue(s.defaultDownloadMode)
          .onChange(async (v) => {
            s.defaultDownloadMode = v;
            await this.save();
          })
      );

    new Setting(containerEl)
      .setName('Media sites')
      .setDesc('Comma-separated. Only these addresses are handed to yt-dlp, so ordinary articles cost nothing.')
      .addTextArea((t) => {
        t.inputEl.rows = 3;
        t.inputEl.style.width = '100%';
        t.setValue(s.videoHosts).onChange(async (v) => {
          s.videoHosts = v;
          await this.save();
        });
      });

    new Setting(containerEl)
      .setName('Try every address')
      .setDesc('Asks yt-dlp about any clipped page, not just the sites above. Slower, catches more.')
      .addToggle((t) =>
        t.setValue(s.probeUnknownUrls).onChange(async (v) => {
          s.probeUnknownUrls = v;
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('yt-dlp path')
      .addText((t) =>
        t.setValue(s.ytDlpPath).onChange(async (v) => {
          s.ytDlpPath = v.trim() || 'yt-dlp';
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('ffmpeg folder')
      .setDesc('The folder holding the ffmpeg binary. Needed to merge video with audio.')
      .addText((t) =>
        t.setValue(s.ffmpegLocation).onChange(async (v) => {
          s.ffmpegLocation = v.trim();
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('Format')
      .setDesc('yt-dlp format string. Cap the size with something like bestvideo[height<=1080]+bestaudio/best')
      .addText((t) =>
        t.setValue(s.quality).onChange(async (v) => {
          s.quality = v.trim() || DEFAULT_SETTINGS.quality;
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('Where the title comes from')
      .setDesc('Keep the note name means an edit you made by hand survives and only the channel is added. Use the video title always takes YouTube\u2019s wording.')
      .addDropdown((d) =>
        d
          .addOption('filename', 'Keep the note name')
          .addOption('metadata', 'Use the video title')
          .setValue(s.noteTitleSource)
          .onChange(async (v) => {
            s.noteTitleSource = v;
            await this.save();
          })
      );

    new Setting(containerEl)
      .setName('Note name template')
      .setDesc('yt-dlp print template used when renaming, e.g. %(channel)s \u2014 %(title)s')
      .addText((t) =>
        t.setValue(s.noteNameTemplate).onChange(async (v) => {
          s.noteNameTemplate = v.trim() || DEFAULT_SETTINGS.noteNameTemplate;
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('Audio format')
      .addDropdown((d) =>
        d
          .addOption('mp3', 'mp3')
          .addOption('m4a', 'm4a')
          .addOption('opus', 'opus')
          .addOption('flac', 'flac')
          .addOption('wav', 'wav')
          .setValue(s.audioFormat)
          .onChange(async (v) => {
            s.audioFormat = v;
            await this.save();
          })
      );

    new Setting(containerEl)
      .setName('Skip playlists')
      .setDesc('A YouTube address carrying a list parameter downloads one video, not the whole list.')
      .addToggle((t) =>
        t.setValue(s.noPlaylist).onChange(async (v) => {
          s.noPlaylist = v;
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('Remote components')
      .setDesc(
        'Lets yt-dlp fetch YouTube\u2019s challenge solver script at run time. Required for most ' +
          'YouTube downloads: without it, signature solving fails and the download stops with ' +
          '"The page needs to be reloaded". Clear it to stop yt-dlp fetching anything.'
      )
      .addText((t) =>
        t.setValue(s.remoteComponents).setPlaceholder('ejs:github').onChange(async (v) => {
          s.remoteComponents = v.trim();
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('Cookies from browser')
      .setDesc('chrome, safari, firefox, edge or brave. Ignored when a cookies file is set below.')
      .addText((t) =>
        t.setValue(s.cookiesFromBrowser).onChange(async (v) => {
          s.cookiesFromBrowser = v.trim();
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('Cookies file')
      .setDesc('Path to an exported cookies.txt. Avoids repeated keychain prompts, but goes stale after a few weeks.')
      .addText((t) =>
        t.setValue(s.cookiesFile).onChange(async (v) => {
          s.cookiesFile = v.trim();
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('JavaScript runtime')
      .setDesc('Needed for YouTube. A bare name relies on PATH; a name and full path does not, e.g. node:/usr/local/bin/node')
      .addText((t) =>
        t.setValue(s.jsRuntime).setPlaceholder('auto').onChange(async (v) => {
          s.jsRuntime = v.trim();
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('Retry arguments')
      .setDesc('Added on a second attempt when the first one hits a 403. Blank disables the retry.')
      .addText((t) =>
        t.setValue(s.fallbackExtractorArgs).onChange(async (v) => {
          s.fallbackExtractorArgs = v.trim();
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('Extra yt-dlp arguments')
      .setDesc('Added to every call. Example: --embed-metadata --embed-thumbnail --write-subs')
      .addText((t) =>
        t.setValue(s.ytDlpExtraArgs).onChange(async (v) => {
          s.ytDlpExtraArgs = v.trim();
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('Rename the note')
      .setDesc('Renames to "Channel \u2014 Title" whether or not you download anything. Links to the note are updated, and the attachment folder picks up the new name too.')
      .addToggle((t) =>
        t.setValue(s.renameNoteFromMedia).onChange(async (v) => {
          s.renameNoteFromMedia = v;
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('Fill the video length')
      .setDesc('Writes the length into "duration", in whole minutes rounded up, the way ARCH YT Playlists does. Only when the note has no duration yet; a value already there is kept. On YouTube it reads the video page, about a second.')
      .addToggle((t) =>
        t.setValue(s.fillVideoLength).onChange(async (v) => {
          s.fillVideoLength = v;
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('Embed the downloaded file')
      .setDesc('Adds a plain ![[file]] embed after downloading and removes the remote video embed. Nothing plugin-specific is written, so the note still works without this plugin.')
      .addToggle((t) =>
        t.setValue(s.embedLocalMedia).onChange(async (v) => {
          s.embedLocalMedia = v;
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('Link saved media in the note')
      .setDesc('Adds a media property pointing at the downloaded file.')
      .addToggle((t) =>
        t.setValue(s.linkDownloadedMedia).onChange(async (v) => {
          s.linkDownloadedMedia = v;
          await this.save();
        })
      );


    new Setting(containerEl)
      .setName('Save subtitles with single downloads')
      .setDesc('Writes a subtitle file alongside the downloaded video.')
      .addToggle((t) =>
        t.setValue(s.downloadSubtitles).onChange(async (v) => {
          s.downloadSubtitles = v;
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('Subtitle languages')
      .setDesc('Comma-separated yt-dlp language codes. "en.*" covers English including auto-generated; "en.*,vi.*" adds Vietnamese. Use "all" for every language offered.')
      .addText((t) =>
        t.setValue(s.subtitleLangs).onChange(async (v) => {
          s.subtitleLangs = v.trim() || 'en.*';
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName('Keep only one subtitle file')
      .setDesc(
        'A language pattern like "en.*" matches en, en-US, en-GB and en-orig, so yt-dlp writes a separate file for each. ' +
          'This keeps the closest match to the language you asked for and deletes the rest, considering only files named after the video itself. ' +
          'Turn it off to keep every track.'
      )
      .addToggle((t) =>
        t.setValue(s.keepOneSubtitle).onChange(async (v) => {
          s.keepOneSubtitle = v;
          await this.save();
        })
      );

    new Setting(containerEl).setName('Troubleshooting').setHeading();

    new Setting(containerEl)
      .setName('Set up external tools')
      .setDesc('Finds yt-dlp, ffmpeg, Python and a JavaScript runtime, fills in the paths, and offers to install what is missing.')
      .addButton((b) =>
        b
          .setButtonText('Open setup')
          .setCta()
          .onClick(() => this.plugin.diagnose(() => this.display()))
      );

    new Setting(containerEl)
      .setName('Update yt-dlp')
      .setDesc('Works on standalone builds. A pip or Homebrew install has to be updated the same way it was installed.')
      .addButton((b) => b.setButtonText('Update now').onClick(() => this.plugin.updateYtDlp()));

  }
}


/* ------------------------------------------------------------------ *
 * Bundled transformer scripts
 *
 * A release ships only main.js, manifest.json and styles.css, so the
 * transformers/ folder never reaches an installed vault. The scripts are
 * embedded here and written to disk on first run by ensureTransformers().
 *
 * These are verbatim copies of transformers/*.py in the repository, and
 * nothing keeps them in sync automatically: edit the .py file, then update
 * the copy below.
 * ------------------------------------------------------------------ */

const BUNDLED_TRANSFORMERS = {
  'gemini_chat.py': `#!/usr/bin/env python3
"""
Gemini chat transformer for Clip Archiver.

Contract
--------
stdin  : the note body, with frontmatter already stripped by the plugin
stdout : the rewritten body
stderr : warnings; anything here is logged but does not stop the plugin

Safety
------
If nothing recognisable is found, the input is echoed back unchanged and a note
is written to stderr. The plugin also refuses to write empty output, so a bad
match can never blank a note.
"""

import re
import sys

# Speaker label styles, tried in order. Each entry is (regex, description).
# Group 1 must capture the speaker, group 2 the message body.
SPEAKER_PATTERNS = [
    (
        re.compile(
            r"\\*\\*(You|Gemini)\\*\\*(.*?)(?=\\*\\*(?:You|Gemini)\\*\\*|\\Z)",
            re.DOTALL,
        ),
        "**You** / **Gemini**",
    ),
    (
        re.compile(
            r"\\*\\*(You|Gemini)\\s+said:?\\*\\*(.*?)(?=\\*\\*(?:You|Gemini)\\s+said:?\\*\\*|\\Z)",
            re.DOTALL,
        ),
        "**You said:** / **Gemini said:**",
    ),
    (
        re.compile(
            r"^#{1,6}\\s+(You|Gemini)\\s*:?\\s*$(.*?)(?=^#{1,6}\\s+(?:You|Gemini)\\s*:?\\s*$|\\Z)",
            re.DOTALL | re.MULTILINE,
        ),
        "## You / ## Gemini headings",
    ),
]

USER_SPEAKER = "You"
CALLOUT_PROMPT = "[!Question] Prompt"
CALLOUT_ANSWER = "[!Answer] Output"


def strip_dividers(text):
    """Drop leading and trailing horizontal rules left behind by the split."""
    text = text.strip()
    while text.startswith("---"):
        text = text[3:].lstrip()
    while text.endswith("---"):
        text = text[:-3].rstrip()
    return text.strip()


def quote_block(tag, text):
    """Render one Obsidian callout containing text, preserving blank lines."""
    lines = [f"> {tag}"]
    for line in text.split("\\n"):
        lines.append(f"> {line}" if line.strip() else ">")
    return "\\n".join(lines)


def find_turns(text):
    """Return a list of (speaker, message) using whichever label style matches."""
    best = []
    best_desc = None
    for pattern, desc in SPEAKER_PATTERNS:
        matches = pattern.findall(text)
        if len(matches) > len(best):
            best, best_desc = matches, desc
    if best_desc:
        print(f"matched speaker style: {best_desc}", file=sys.stderr)
    return [(speaker, strip_dividers(body)) for speaker, body in best]


def pair_turns(turns):
    """Fold a flat list of turns into (prompt, answer) pairs."""
    pairs = []
    pending = None
    for speaker, body in turns:
        if speaker == USER_SPEAKER:
            # Two prompts in a row: keep the later one, the earlier got no reply.
            pending = body
        else:
            if pending is not None:
                pairs.append((pending, body))
                pending = None
            elif pairs:
                # A continuation of the previous answer.
                prompt, answer = pairs[-1]
                pairs[-1] = (prompt, answer + "\\n\\n" + body)
    if pending is not None:
        pairs.append((pending, "_(no reply captured)_"))
    return pairs


def transform(raw):
    turns = find_turns(raw)
    if not turns:
        print("no Gemini speaker labels found; leaving the note unchanged", file=sys.stderr)
        return raw

    pairs = pair_turns(turns)
    if not pairs:
        print("speaker labels found but no complete exchanges; leaving unchanged", file=sys.stderr)
        return raw

    blocks = []
    for i, (prompt, answer) in enumerate(pairs, start=1):
        block = f"#### Prompt {i}\\n\\n"
        block += quote_block(CALLOUT_PROMPT, prompt)
        block += "\\n\\n"
        block += quote_block(CALLOUT_ANSWER, answer)
        blocks.append(block)

    print(f"built {len(blocks)} prompt/answer pair(s)", file=sys.stderr)
    return "\\n\\n---\\n\\n".join(blocks) + "\\n"


def main():
    raw = sys.stdin.read()
    if not raw.strip():
        print("empty input", file=sys.stderr)
        return 1
    sys.stdout.write(transform(raw))
    return 0


if __name__ == "__main__":
    sys.exit(main())
`,
  'reddit_thread.py': `#!/usr/bin/env python3
"""
Reddit thread transformer for Clip Archiver.

Contract
--------
stdin  : the note body, with frontmatter already stripped by the plugin
stdout : the rewritten body
stderr : warnings; anything here is logged but does not stop the plugin

Safety
------
If no comments section or no comment headers are found, the input is echoed back
unchanged. The plugin refuses to write empty output, so a bad match cannot blank
a note.
"""

import re
import sys

# The heading Web Clipper puts above the comment list. Tolerant about level,
# trailing punctuation and a bracketed count.
COMMENTS_HEADING = re.compile(r"^#{1,6}\\s*Comments?\\b.*$", re.MULTILINE | re.IGNORECASE)

# A comment header line. Handles:
#   **author** · 2 hours ago
#   **[u/author](https://...)** · 2 hours ago
#   **author** — 2 points
#   **author**
COMMENT_HEADER = re.compile(
    r"^\\*\\*\\s*(?:\\[)?(?:u/)?(?P<author>[^\\]\\*]+?)(?:\\])?(?:\\([^)]*\\))?\\s*\\*\\*"
    r"(?:\\s*[·•∙|:—–-]\\s*(?P<meta>.*))?$"
)


class CommentNode:
    def __init__(self, author, meta, depth):
        self.author = author
        self.meta = meta or ""
        self.depth = depth
        self.text_lines = []
        self.children = []
        self.path = []


def parse_line_depth(line):
    """Count the quote depth (number of '>') and return the remaining content."""
    depth = 0
    idx = 0
    while idx < len(line):
        if line[idx] == ">":
            depth += 1
            idx += 1
        elif line[idx].isspace():
            idx += 1
        else:
            break
    return depth, line[idx:].rstrip("\\r\\n")


def trim_empty_lines(lines):
    """Drop blank lines from both ends, keeping the ones in the middle."""
    lines = list(lines)
    while lines and lines[0].strip() == "":
        lines.pop(0)
    while lines and lines[-1].strip() == "":
        lines.pop()
    return lines


def render_tree(node, level=1):
    """Build the markdown lines for one comment and everything nested under it."""
    prefix = "> " * level

    if level == 1:
        tag = f"[!Comment {node.path[0]}]"
    else:
        tag = f"[!Sub-Comment {'.'.join(map(str, node.path))}]"

    out = [f"{prefix}{tag}"]
    header = f"**{node.author}**"
    if node.meta:
        header += f" · {node.meta}"
    out.append(f"{prefix}{header}")
    out.append(prefix.rstrip())

    for line in trim_empty_lines(node.text_lines):
        out.append(f"{prefix}{line}" if line.strip() else prefix.rstrip())

    for child in node.children:
        out.append(prefix.rstrip())
        out.extend(render_tree(child, level + 1))

    return out


def split_sections(raw):
    """Return (original post, comments) using the first Comments heading."""
    match = COMMENTS_HEADING.search(raw)
    if not match:
        return raw, ""
    return raw[: match.start()], raw[match.end() :]


def build_comment_tree(comments_part):
    roots = []
    active = {}

    for line in comments_part.split("\\n"):
        if not line.strip() or line.strip().startswith("---"):
            continue

        depth, content = parse_line_depth(line)
        if depth == 0:
            continue  # unquoted stray text between comments
        # An empty quoted line is a paragraph break inside a comment, so keep it.

        header = COMMENT_HEADER.match(content)
        if header:
            node = CommentNode(
                header.group("author").strip(),
                (header.group("meta") or "").strip(),
                depth,
            )
            if depth == 1:
                roots.append(node)
                node.path = [len(roots)]
            else:
                parent_depth = depth - 1
                while parent_depth > 0 and parent_depth not in active:
                    parent_depth -= 1
                if parent_depth > 0:
                    parent = active[parent_depth]
                    parent.children.append(node)
                    node.path = parent.path + [len(parent.children)]
                else:
                    roots.append(node)
                    node.path = [len(roots)]

            active[depth] = node
            for d in [d for d in active if d > depth]:
                del active[d]
        else:
            # Body text belongs to the deepest open comment at or above this depth.
            target_depth = depth
            while target_depth > 0 and target_depth not in active:
                target_depth -= 1
            if target_depth > 0:
                active[target_depth].text_lines.append(content)

    return roots


def transform(raw):
    op_part, comments_part = split_sections(raw)

    if not comments_part.strip():
        print("no Comments heading found; leaving the note unchanged", file=sys.stderr)
        return raw

    roots = build_comment_tree(comments_part)
    if not roots:
        print("no comment headers matched; leaving the note unchanged", file=sys.stderr)
        return raw

    out = ["> [!Question]"]
    for line in op_part.strip().split("\\n"):
        stripped = line.strip()
        if stripped.startswith("---"):
            continue
        out.append(f"> {stripped}" if stripped else ">")

    out.append("")
    out.append("# Comments")
    out.append("")

    for node in roots:
        out.append(f"###### Comment {node.path[0]}")
        out.extend(render_tree(node, level=1))
        out.append("")

    total = len(roots) + sum(count_descendants(n) for n in roots)
    print(f"built {len(roots)} top-level comment(s), {total} total", file=sys.stderr)
    return "\\n".join(out).rstrip() + "\\n"


def count_descendants(node):
    return len(node.children) + sum(count_descendants(c) for c in node.children)


def main():
    raw = sys.stdin.read()
    if not raw.strip():
        print("empty input", file=sys.stderr)
        return 1
    sys.stdout.write(transform(raw))
    return 0


if __name__ == "__main__":
    sys.exit(main())
`,
};
