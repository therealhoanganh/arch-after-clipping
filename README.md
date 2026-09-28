# ARCH After Clipping

An Obsidian plugin that finishes what [Web Clipper](https://obsidian.md/clipper) starts.

Web Clipper saves a page's text and leaves everything else pointing at the internet. Images stay on someone else's server, video stays on the site, and the note is named whatever the page's `<title>` happened to be. This plugin watches for new clips and, without you doing anything:

- pulls the images into your vault and repoints the body links and image properties at the local copies
- renames the note to `Channel — Title` using the source's own metadata
- runs a Python script over the body if you have one matching that site
- offers to download the video or audio with `yt-dlp`, and embeds the result

It runs on every site, not just YouTube. `yt-dlp` covers around a thousand of them.

> **Status:** works, and has been used daily — but on one machine: macOS on Intel, Obsidian 1.13.4. Windows and Linux are untested, and the parts most likely to break there are browser cookie access and the paths to `yt-dlp` and `ffmpeg`. `1.5.0` is the first public release; everything before it was development on that one machine, so read the history as "known to work for its author".

## Requirements

Desktop only. The plugin spawns external programs, which Obsidian mobile cannot do.

| | why | notes |
| --- | --- | --- |
| **yt-dlp** | video and audio | the plugin can install and self-update a standalone copy for you |
| **ffmpeg** | extracting audio from video | install it yourself |
| **Python 3** | the body transformers | only if you use them |
| **A JavaScript runtime** | YouTube's challenge solver | Node or Deno, given as a full path |

Run **Set Up External Tools** from the command palette after installing. It reports what it found and what is missing, which is faster than guessing.

## Install

There is no community-store listing, so there are two ways in.

**With BRAT**, which also handles updates. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from the community store, run *BRAT: Add a beta plugin for testing* from the command palette, and give it:

```
therealhoanganh/arch-after-clipping
```

Then enable **ARCH After Clipping** under Settings → Community plugins. BRAT pulls each new release as it appears.

**By hand.** Download `main.js` and `manifest.json` from the [latest release](https://github.com/therealhoanganh/arch-after-clipping/releases/latest) into `YourVault/.obsidian/plugins/arch-after-clipping/`, then enable it the same way. The folder must keep the name `arch-after-clipping`.

To upgrade by hand, replace `main.js` and `manifest.json` only — your settings survive. Replacing the whole folder wipes `data.json`, which holds your settings *and* the record of what has already been downloaded.

## How a clip gets processed

1. **Wait for the note to be on disk.** Web Clipper creates the file and fills it a moment later, so the plugin waits for content rather than reading an empty note.
2. **Find the source URL** from `url`, `source`, `link`, `permalink` or `original-url`, then from any property holding a web address.
3. **Rename** to `Channel — Title`. The title is the note's *own* name, so an edit you made by hand survives and only the channel is added.
4. **Download images**, rewrite body links, and repoint image properties at the saved files.
5. **Run a transformer** if a rule matches the URL.
6. **Ask what to download** — Video + Audio, Video, Audio, or Skip — and hand it to `yt-dlp`.

Steps 4 and 6 have separate scopes, which is what the folder settings below are for.

## Settings worth knowing about

**Images have their own folder list, separate from media.** *Download Images Only in These Folders* scopes the image pass alone — video still downloads anywhere the plugin runs. Empty means everywhere.

**Save locations** offer the same choices as Obsidian's own attachment setting: vault folder, same folder as the note, a subfolder under it, or a path you name. Images get a fifth, *follow Obsidian's attachment setting*. Out of the box both use *in subfolder under the note*: media lands in a `Medias` folder beside the note and images in an `Images` folder, so a note in `Clips/YouTube` gets `Clips/YouTube/Medias` and `Clips/YouTube/Images`. This plugin clips any site, so the folders follow the note rather than naming one source.

**Only one subtitle file is kept.** A language pattern like `en.*` matches `en`, `en-US`, `en-GB` and `en-orig`, so yt-dlp writes a separate file for each and you end up with four tracks for one video. *Keep Only One Subtitle File* keeps the closest match to what you asked for — a plain code beats the original-language track, which beats a regional variant — and deletes the rest. Only files named after the video itself are considered, so a subtitle you put in the folder by hand is never touched.

**Media hosts accept regular expressions.** This is the least obvious setting and the most worth understanding. A bare domain like `x.com` matches *every* URL on that domain, including profile pages with no video on them — and each one costs a full `yt-dlp` round trip, several seconds, to discover there is nothing there. Wrap an entry in slashes and it compiles as a regex instead:

```
/(?:twitter|x)\.com\/[^\/]+\/status\//
```

That matches real posts and ignores profiles. The defaults already do this for Twitter/X and Instagram. If a site feels slow to clip, look in the console for `metadata done` followed by `no downloadable media` — that pairing means the host pattern is too broad.

**The note can be flagged once media arrives.** *Mark the Note as Downloaded* names a property — `dl-ed` by default — set to `true` in the same write that adds `media`, and only after the files are on disk, so it never claims a download that failed. A note that already has the property keeps its position; a note without it gets it as its first property, since a status flag buried at the bottom of the block is easy to miss. Leave the setting empty to write nothing.

**Image properties become `[[file.jpg]]`**, a plain wikilink, on `img`, `image`, `cover`, `thumbnail`, `banner` and `icon` by default. Any label the property carried is dropped rather than moved, because this plugin clips arbitrary sites and no single label fits them all.

## Transformers

A transformer is a Python script that rewrites a note's body for one kind of page. It reads the body on stdin and writes the new body on stdout; anything on stderr is logged and ignored. If it produces nothing, the note is left alone — an empty result can never blank a note.

Two ship with the plugin:

- **`gemini_chat.py`** turns a Gemini conversation into numbered prompt/answer callouts.
- **`reddit_thread.py`** turns a thread into nested comment callouts. *This one has never been run against a real clip.*

Both are embedded in `main.js` and written into `transformers/` when the plugin loads, since a release only delivers `main.js` and `manifest.json`. A file already sitting there is never overwritten, so edits you make to them survive an update — run **Restore the Bundled Transformer Scripts** if you want the shipped versions back. Your own scripts in that folder are left alone regardless.

Add your own by dropping a `.py` file into `transformers/` and adding a rule that matches a URL pattern.

## Commands

| command | what it does |
| --- | --- |
| Archive This Clip | the whole pipeline, ignoring the already-processed record |
| Download Images for This Note | images only, ignoring the folder list |
| Transform This Note with Its Site Script | body rewrite only |
| Download Video and Audio for This Note | media only: the video, with the mp3 taken from it |
| Download Video for This Note | media only: the video |
| Download Audio for This Note | media only: the mp3 |
| Download Subtitles for This Note | the subtitle files only, beside where the video would go |
| Fill Video Length for This Note | writes `duration` in whole minutes, for a note clipped before 1.12.0 or with the setting off |
| Embed the Downloaded Media in This Note | inserts the `![[file]]` embed |
| Forget This Note, So It Can Be Archived Again | clears it from the processed record so it can be archived again |
| Restore the Bundled Transformer Scripts | asks first, then rewrites `gemini_chat.py` and `reddit_thread.py` from the copies inside `main.js` |
| Set Up External Tools (yt-dlp, ffmpeg, Python) | reports tool paths and versions, fills in the settings, installs what is missing |
| Inspect This Note (What After Clipping Sees) | what the plugin sees in the current note |
| Set Up YouTube Notes From Chrome | writes the Chrome extension and its helper, registers the helper with Chrome, and says what is still missing |
| Point YouTube Timestamps at the Downloaded Video | turns this note's `[12:34](https://youtu.be/…?t=754)` lines into `[[video.webm#t=754\|12:34]]` once the video is downloaded |

## YouTube notes from Chrome

Take timestamp notes on a YouTube video while it plays, straight into its note in Obsidian. On a YouTube page in Chrome, **Cmd + K** (Alt + K elsewhere) saves the moment as `- [12:34](https://youtu.be/ID?t=754)`, and **Cmd + Shift + K** pauses the video and asks for a line to go with it. The first note on a video asks which vault it goes to and a folder for the new note, unless some vault already has a note for that video, in which case the lines go there. Lines are kept in time order near the top of the note. Once the video is downloaded into the vault (by this plugin, ARCH YT Playlists or by hand), the timestamps are pointed at the file, which Media Extended opens at that moment.

Two parts do the work: a small Chrome extension, ARCH YouTube Notes, and a helper program that writes into the vault, so Obsidian does not need to be open. **Set Up** (in the settings, or the command) writes both and checks them. Loading the extension is one step by hand: in Chrome, open `chrome://extensions`, switch on Developer mode, click *Load unpacked* and choose the folder Set Up names (*Show Folder* opens it). The extension's options page changes the hotkeys and checks the helper. Chrome only; the helper needs Python 3.

## Things that will surprise you

**A page is only auto-processed once.** The record is keyed on the URL, not the note path, so re-clipping the same page — anywhere, under any name — skips the download. That is deliberate: it stops large files being fetched twice. Images and the transformer still re-run. A note whose `dl-ed` property is already `true` is skipped the same way, so the one property both records the download and prevents a repeat. **Forget This Note** clears both.

**Notes carrying a `yt-playlist` property are left alone**, because they belong to ARCH YT Playlists. Without this the two plugins fight over the same notes.

**Nothing written into your notes needs this plugin to render them.** Embeds are plain `![[file]]`. Uninstall it and your vault still reads correctly.

## Troubleshooting

Open the developer console with `Cmd/Ctrl+Shift+I`. Every run logs what it did and how long each stage took. The lap times are cumulative, so a stage's cost is the difference between two lines — the easiest mistake is blaming the image download for time actually spent in the rename before it.

**"The page needs to be reloaded"** from yt-dlp means the challenge solver could not be fetched. The plugin passes `--remote-components ejs:github` for exactly this; if it persists, your `yt-dlp` is too old.

**A runtime the plugin can see but yt-dlp cannot.** Give the full path. The `PATH` an Electron app inherits is much shorter than a terminal's.

## License

MIT. See [LICENSE](LICENSE).
