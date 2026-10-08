# Changelog

Version lives in `manifest.json` — Obsidian reads it from there and shows it in Community Plugins, so that's the source of truth. This file explains what changed at each version. The two transformer scripts aren't part of the plugin version; see the note at the bottom for how they're tracked.


> **Numbering.** `1.0.0` is the first release meant for anyone other than its author. Everything before it was development and is numbered `0.1.0` upward in the order it happened, with no entries dropped or merged. Those versions were renumbered twice on the way here, so any number you see in an old console log or screenshot will not match this file.


## Unreleased

- **`.claude/CLAUDE.md` removed** (2026-10-09). Its two lines, from Sep 10, said he was new to git and asked for every command to be explained, plus a note on the Intel Mac's Homebrew. The Intel note is in `~/Documents/CLAUDE.md`. Asked whether "explain every command" still holds, his answer was *"Go to TRASH"*. The file is in `~/Documents/_/TRASH/arch-after-clipping/.claude/`.

## 1.22.2 — current

- **Media Extended 4.2.7 is the tested version** (`TESTED` in `checkMediaExtended`, which the log names at startup when *Videos Outside the Vault* is set). His request, 2026-10-04: *"I want to install the latest 4.2.7 and update out plugin to it if needed."* He kept 4.2.1 because *"4.2.5 were bugged from my experience"*. That was Media Extended issue 670 (fails to load on Obsidian 1.13), fixed in 4.2.7. His check in TESTFIELD the same day: *"everything seem like before, all the clicks and hotkey work"*. 4.2.7 reads the library notes this plugin writes (`mx-uid`, `video:`, `subtitles:`) the same way, so nothing else changed. The 4T-HDD videos get one more look on 4.2.7 when the drive is plugged in.

## 1.22.1

- **A video title's colon becomes " - " when the note is renamed from it** (`Lecture 3: Markets` is `Lecture 3 - Markets`), and a colon inside a word becomes "-". It became "_" before. His rule for every ARCH plugin, 2026-10-02: *"Fix it, we need will need to find what games got ":" replace with blank space too, this need to be a universal rule too too!"* (Recreations 0.4.4 has the whole account.)
- **A note already renamed the old way stays as it is.** Processing runs again on a note it has seen, and the subtitles and drive video are found by the note's name, so `renameNoteTo` leaves a note whose name is the old rule's (`legacySanitizeName`). No note was renamed.

## 1.22.0

**The note opens in Obsidian, and the vault with it.** His words after using 1.21.0: *"Ok so the plugin did work but it not auto open vault and auto open not even when vault is open."* The helper wrote the file and nothing more, so a closed vault stayed closed and After Clipping never finished the clip there.

- After saving, the helper opens the note through `obsidian://arch-youtube-note?vault=…&video=…&file=…`, which starts Obsidian and the vault when closed, as Web Clipper does. **Not `obsidian://open` with the file name**: the first test opened TESTFIELD but not the note, because this plugin renamed the new clip ("Blender — Open Test Note") the moment the vault opened, before Obsidian looked for the old name. The link goes to this plugin's handler (`openYouTubeNote`), which finds the note by the video id, waits up to ten seconds for a new file to be indexed, and switches to its tab when it is already open.
- **When**: by default only when a note is created, so a Cmd + K does not pull Obsidian up each time; the extension's options page offers *After Every Note* and *Never*. **Chrome stays in front** by default (macOS `open -g`), so the video is not interrupted; *Bring Obsidian to the Front* changes that. A vault Obsidian has to open still comes forward on its own.
- Tested with the helper called as Chrome calls it: TESTFIELD open, an existing renamed note opened with VS Code left in front; TESTFIELD closed, a new note created, renamed by this plugin on opening, and opened. Test notes deleted, his helper memory restored.

## 1.21.0

**A new video note is clipped with his Web Clipper template.** His words after using 1.20.0: *"Ok so the command work, but I think it should use the Web Clipper template too, like take note also mean to clip the video as well. I export the clipping template in Downloads."* The export, his *YouTube Video* template (`channel`, `banner`, `url`, `dl-ed`, `v-rank`, `duration`, `status: Watch Later`, `published`, `tags: yt-video`; body `{{content}}`; name `{{title}}`; folder `YouTube`), ships as the extension's `template.json`.

- **Web Clipper cannot be asked to clip by another extension** (no external messaging; its quick clip runs from its own shortcut only), so the extension makes the note itself from the same template with the same library: **Defuddle 0.19.4** (MIT, `defuddle.js` copied unchanged from the npm package, with its licence), loaded into the tab through `chrome.scripting` only when a new note is made. `{{content}}` is therefore Web Clipper's own: the embed, the description, `## Transcript` with chapter headings and `**0:10** ·` lines. The template variables his template uses are filled (`title`, `author`, `image`, `published` with the `date` filter, `meta:property:og:url`, `content`), and each property is written by its type as Web Clipper writes it. The first timestamp goes below the embed, above the description.
- **YouTube changes videos without reloading the page**, and what the page's own scripts hold stays the first video's. The live page is used only when its player data is for this video; otherwise a fresh copy is fetched. That copy's VideoObject lacks the description (YouTube adds it once the page runs), so it is filled from the same page's player data; without that, a video reached by clicking inside YouTube was clipped with no description (found in testing).
- **The picker** says which template it clips with, and the folder starts at the template's (`YouTube`) until a folder is chosen for that vault; a template with its own vault preselects it. If clipping fails, the note is still made with the plain `url` and the reason is shown.
- **The options page imports a newer export**, for when the template changes in Web Clipper, and can go back to the bundled one.
- `main.js` grows from about 0.37 MB to 1.1 MB, nearly all of it Defuddle, embedded so the extension works offline and never fetches code.

Tested in a headless Chrome with a throwaway profile, one video loaded directly and one reached by an in-page change of video: both notes came out with his template's properties, the description and (where YouTube has captions) the transcript; After Clipping then renamed them "Channel — Title", saved the thumbnail and filled `duration`, as for a Web Clipper clip. Test notes deleted, the helper's memory put back to his own choices.

## 1.20.0

**YouTube notes from Chrome.** His thought note of 2026-08-11, *YouTube on Chrome Instant Note-taking Hotkey*: *"Instantaneity: You're better of take notes from webpage first then to downloaded video later"*, with *"Tried to Ask AI: JDownloader 2 is not viable"*; on 2026-09-28 he asked *"Can we develop chrome hotkey for this?"* and chose, of the options put to him: *"Both, Like Cmd for bare timestamp and Cmd + Shift is plus a typed line – help me find suitable hotkey too"*, and for the vault, *"Ask the first time"*. He approved the plan (*"Ok go"*): a Chrome extension, a helper that writes the note on disk, and the relinking in this plugin, which owns single-video notes.

- **The extension, ARCH YouTube Notes**, on YouTube pages only. Cmd + K saves `- [12:34](https://youtu.be/ID?t=754)`; Cmd + Shift + K pauses the video and opens a box for a line, Enter saves and plays on, Esc cancels. The keys were chosen against what is taken on his Chrome: its own Cmd + Shift letters, and his extensions' Cmd + Shift + E, S, O, 1, 2, 6 and the arrows; Cmd + Shift + K belonged to an extension no longer installed. K is YouTube's own pause key. Because the listener is on YouTube pages, Cmd + K elsewhere (a link in Gmail or Docs) is untouched. It listens in the capture phase at `document_start`, so the hotkey never reaches YouTube and typing in the box does not trigger YouTube's k, j, l or f (tested). The options page changes the keys and checks the helper.
- **The helper** (`host.py`, Chrome native messaging) writes the line into the note on disk, so Obsidian may be closed. It finds the video's note in any vault by the video id in the properties (about 3 seconds over 8,600 notes, first note on a video only), remembers it in `state.json`, and finds it again if renamed. With no note, the extension asks which vault (the last one preselected) and a folder for a new note, remembered per vault; the new note carries `url` as `[Link](…)` and `created`. Lines go in time order among that video's lines, or at the top of the body below any embed and drive link.
- **Set Up** (settings section *YouTube Notes From Chrome*, and a command) writes the extension to `~/Library/Application Support/ARCH YouTube Notes/extension` (Linux `~/.local/share/arch-youtube-notes`), the helper beside it, and Chrome's native messaging host manifest, then checks each part and says what fails and how to fix it; the Chrome row reads Chrome's `Secure Preferences` to see whether the extension is loaded. Loading it (Developer mode, *Load unpacked*) stays a step by hand. At startup a set-up computer gets the new files, with a notice to press the extension's reload arrow when they changed.
- **Timestamps follow the download.** When a note with such lines gets a `[[video]]` in `media`, they become `[[video.webm#t=754|12:34]]`, which Media Extended opens at that moment (his own form, from April). Automatic, on the `automaticOn` computer; the command *Point YouTube Timestamps at the Downloaded Video* does it by hand. A video on the outside drive keeps its YouTube links for now: a markdown link to a `file:///` address opens in the browser, and whether Media Extended opens its library note at a moment could not be tested with 4T-HDD unplugged.
- **One source for the extension files**: `youtube-notes/` in this repository, copied into `main.js` by `node tools/embed-youtube-notes.js` (`--check` fails when `main.js` is behind), not a hand-kept copy like the transformers.

Tested end to end in a separate headless Chrome with a throwaway profile, driven over the DevTools protocol: the extension loaded with its fixed id, the first Cmd + K opened the vault picker and made the note in TESTFIELD, Cmd + Shift + K paused, took typed text and resumed, a second Cmd + K went straight to the note after this plugin had renamed it, Esc cancelled; setting `media` pointed all three timestamps at the file. The test note was deleted.

## 1.19.1

The same fixes as ARCH YT Playlists 1.9.2, found on the PC on 2026-09-28: the extra subtitle language is fetched as its `-orig` track only (plain `vi` asked YouTube for a machine translation, which it refused with HTTP 429 and failed the download); `--ignore-errors` on the calls that fetch subtitles, so a refused track is a warning; and `driveOf` reads `/Volumes/<name>` on any platform, so the PC's drive links are labelled "4T-HDD: …" rather than ": …".

## 1.19.0

**Vietnamese subtitles, when the video is in Vietnamese**, the same change as ARCH YT Playlists 1.9.0, at his request of 2026-09-28: *"can you make this into default setting too? Like download vietnamese subtitle if there is one."* A new setting, *Also Keep Subtitles In*, default `vi`, adds `vi,vi-orig` to `--sub-langs`, and *Keep Only the Best Subtitles* (renamed from *Keep Only One Subtitle File*) keeps the Vietnamese track only when the video is spoken in Vietnamese, which YouTube marks with a `vi-orig` track; the machine translation it offers on English videos is deleted with the other extras. The choice (`subLangsArg`, `pickSubtitles` and helpers) is copied word for word from YT Playlists' `lib/subtitles.js`; change the two together. The *Subtitle Languages* description no longer suggests `en.*,vi.*`, which fetched those machine translations.

## 1.18.6

Fixes YouTube thumbnails left as web addresses. He asked on 2026-09-27: *"My Arch After
Clipping doesn't auto download image anymore, can you check?"* Fourteen YouTube clips from
2026-09-24 and 2026-09-25 (ten in Psycho-history, four in CHAOS, and three more in
TESTFIELD's trash) had been processed (video recorded, `duration` filled) with `banner` still pointing at
`i.ytimg.com`, and nothing in the log said why. Clips made on 2026-09-27 were fine. Three
causes, each measured in the running app:

- **The image properties were read from the metadata cache only.** Obsidian has nothing
  for a note in the first moments after it is created (tested: nothing at creation, all of
  it 300 ms later), and while it is busy indexing (a clip that launched a closed vault,
  Syncthing bringing many files) that gap lasts seconds. 1.18.5 called on a note that
  instant left the thumbnail remote without a word; 1.18.6 saves it. `doImages` now
  parses the note's own text first and uses the cache only if that will not parse, as
  every other check in the plugin already did.
- **Obsidian refuses any request carrying a youtube.com `Referer`** (`net::ERR_BLOCKED_BY_CLIENT`;
  the same request without it returns 200 in a few milliseconds). The image fetch sends the
  clip's page as the Referer, so every YouTube thumbnail depended on the single Node attempt at
  the end of the ladder. A blocked request is now sent again without `Referer` and `Origin`,
  and Node gets a second attempt. A timeout moves on to the next attempt; before, it
  ended the fetch at once.
- **A failed automatic download said nothing.** It now shows a notice naming the note, the
  reason (`HTTP 404`, `timed out`…) and the command that retries it, *Download Images for
  This Note*. An address that simply is not an image stays a quiet log line, as before.

The fourteen notes were repaired the same day through each vault's own *Download Images for
This Note* step. TESTFIELD's trashed ones and CHAOS's duplicate *The Hot Zone - Starts 3 July*
(its twin from 2026-09-20 has its image) were left alone.

## 1.18.5

- The setup popup's box heading reads *Filled In for You*: the Title Case pass read only labels set through Obsidian's own calls, and this one is plain text (found in the check before a compact, 2026-09-27; "in" is capitalized as the particle of *fill in*).
- `testCookies`, which 1.18.4's login check replaced, is removed; nothing called it.

## 1.18.4

- **The setup's Cookies row checks for a YouTube login and says what it means.** His words, 2026-09-27, after the PC's missing X login was explained only in the chat: *"You need to explicitly tell this in the setup, so future me can know what's went wrong. And apply this explicit telling in other plugin too."* It
  showed "Read from chrome on each run" whenever a browser was picked, and *Test* only
  proved yt-dlp could read the cookies. Now `testYouTubeLogin` has yt-dlp write out the
  cookies it loaded (`--cookies` to a private temporary folder, deleted at once, and an
  address it refuses straight away, so nothing is fetched) and looks for YouTube's login
  cookie. The row says, line by line, what is wrong, what fails because of it
  (age-restricted and members-only videos, "Sign in to confirm you're not a bot"), and how
  to fix it and see that it worked. A keyring that cannot be read, a missing
  `secretstorage` and a browser holding its cookie file each get their own fix.
- The *Transformer Scripts* row, when empty, says no site script will run and names the
  command that restores them.

## 1.18.3

- **The transformer rule rows are readable again.** 1.18.2 gave each row a description
  beside its three boxes, which squeezed the row's name column to a sliver: the rows read
  "R.. 1 / N.. U.. p.. s…". Found the same day in a screenshot, looking at the settings'
  layout. A row is now its three boxes alone, stretched across the card, each named by a
  tooltip, and the rules' explanation shares one card with *Add Rule* (it was a loose
  paragraph above the rows, and *Add Rule* a card of its own below them).
- ***Media Sites* is edited in a popup behind *Manage…***, one site per line; the card shows
  how many there are. It was a narrow three-line box that wrapped the regular expressions
  mid-word. The setting is still stored comma-separated, and saving without a change
  leaves it byte for byte as it was. After the Title Case releases he asked: *"Did you work on UI of the plugins like button structures or something? Like in Arch YT Playlist, the toggle list to paste youtube channel links in is quite ugly."* The review had used a checklist (wording, keyboard, focus) that never judged layout. Shown three layouts, he chose a *Manage…* button opening a popup, the way Obsidian's own *Excluded files* setting works, and chose it for every list of that kind. The popup (`ListModal`, the same class in YT Playlists, X Twitter, After Clipping and Browser History) has a large box, a live count as you type, and *Cancel* and *Save*; only *Cancel* throws an edit away, since a long paste lost to Escape is worse than a save not asked for. Tried in TESTFIELD: the count, Cancel leaving the list alone, and Escape keeping an edit.

## 1.18.2

- **Title Case in every label**, from the web-design-guidelines review of 2026-09-27 (`~/Documents/ARCH UI Review.md`), whose whole list he approved: *"Yes, proceed on."* Commands, setting names and headings, buttons, popup titles and dropdown choices, Chicago style (small words such as *for*, *the*, *before* stay lower case), as in ARCH Images Plus 0.7.6. His preference: *"Actually, I much prefer Title Case."* Descriptions and notices stay sentences, and the ones that name a command or setting use its new name. A hotkey set on a command survives, because Obsidian stores hotkeys by the command's id.
- **"Clip Archiver", the plugin's old name, is gone from what is shown**: the *Inspect This
  Note* command and its popup, and five notices, one of which sent him to "Clip Archiver
  settings", which exist under no such name. The description of *Leave Notes Owned by
  Another ARCH Plugin Alone* said "ARCH X Archive"; it says ARCH X Twitter.
- **Enter no longer deletes in the drive-media popup.** Its `keep.focus()` was overridden:
  Obsidian focuses the first button once a popup is open, which there is *Delete*. Found
  while testing the confirm popups below with a real Enter key press; *Keep Media* now takes
  the focus after Obsidian's. The buttons read *Delete Media* and *Keep Media*.
- **Two commands ask first**, as the guidelines ask of anything destructive: *Restore the
  Bundled Transformer Scripts* overwrites an edit made to them, and *Clean Up Old Video
  Blocks across the Vault* rewrites notes vault-wide. *Cancel* has the focus; Enter on it
  was tried and changed nothing.
- ***External Tools* told "all right" from "worth a look" by colour alone**, the same dot in
  green and yellow. Now ● all right, ▲ worth a look, ○ missing, with the word as a tooltip.
  The transformer rule rows name their three boxes (a description and a tooltip each),
  because the grey hints vanish once a box is filled.
- *Save the video:* is tied to its dropdown, so clicking the words opens it. The same edit
  went into YT Playlists 1.8.2, whose `renderPlaceChoice` stays word for word the same; that
  plugin's download popup now copies this one's.
- "…" instead of "..." in progress notices, a count and its word ("3 videos") instead of "video(s)", and no spell-check underlines in the settings, whose fields hold paths, commands and patterns, not prose (turned off as each field gets focus, which is when Chromium draws them).

## 1.18.1

- **Media Extended library notes go in `_/media-lib`, not `media-lib` at the vault's
  root.** One note is written per video saved on the drive (1.17.0), so Psycho-history
  had 204 of them and TECHNOS 89 in a folder at the top of the vault. His words,
  2026-09-25: *"why there is media-lib folder and lots of Media Extended id files in it?
  It's cluttering the vault."* `media-lib` was Media Extended's own default folder name,
  copied. The `_` folder is where each vault keeps tooling files, and Media Extended
  finds a library note by its `mx-uid` wherever it is, as this plugin already did when
  looking for an existing one; the notes already written were moved there the same day.
  YT Playlists 1.8.1 and `backup-strategy/link-subtitles.py` changed with it.

## 1.18.0

Since 2026-09-25 the vaults are mirrored between the Mac and an Ubuntu PC by Syncthing
(`~/Documents/backup-strategy/Backup Strategy.md`, Part 2). Two things in this plugin
assumed one computer.

- **The automatic work runs on one computer, named in the new setting *Automatic work
  runs on*.** A note clipped on one machine arrives on the other as a new file, so with
  Obsidian open on both, both processed it: two downloads, and conflict files. The
  setting holds a computer's name (macOS's Local Hostname, `Hoangs-MacBook-Pro`; the
  PC's hostname, `hoanganh-ubuntu`) or *Every computer*. It lives in the synced settings
  file, so both machines read the same answer. Gated: new-note processing, the startup
  catch-up, and the move of waiting videos to the drive. Commands and menus run
  anywhere. A vault without the setting is claimed by the first computer to load this
  version, so no vault runs on two by default. A note clipped on the PC is processed by
  the Mac when it arrives there, if Obsidian is open on the Mac.
- **The delete popup shows only on the computer where the note was deleted.** He chose
  it: *"I want to have 'the popup show on whichever machine I delete on', it's move
  convinient,"* and asked for it never to show on the other machine too. Every deletion
  made inside Obsidian goes through `vault.trash` or `vault.delete`; one arriving by sync
  goes through neither. The plugin wraps both and marks the paths, and the popup offers
  only marked ones (a folder marks everything under it; marks expire after a minute). A
  note deleted in Finder no longer gets the popup either, for the same reason.
- **Settings changed on disk are reloaded** (`onExternalSettingsChange`). Without it, a
  settings edit synced from the other machine was overwritten by this machine's next save.

Tested in TESTFIELD: the claim on first load; with the PC named, a new clip note left
alone (logged) and processed once the Mac was named; a note removed from disk (as a sync
does) gets no popup while the same note deleted through Obsidian does; Obsidian calls the
reload when it sees the settings file change. In TESTFIELD itself the plugin folder is a
symlink, so Obsidian's watcher does not see its `data.json` change; a BRAT install is a
real folder and does.

## 1.17.0

- **Deleting a note whose video is on the drive asks about its media.** Obsidian's own
  *Delete unlinked attachments* offers only vault files the note links. A drive video
  is a `file:///` address it can neither see nor delete, and the `.vtt` is linked only
  from the Media Extended library note, if at all. So deleting such a note left the
  video, its subtitles and its library note behind. His words: *"delete attrachment
  when delete files doesn't work. Like I just tried delete a youtube short note and it
  didn't show delete attrachment popup along with it."*
- The popup, *Delete this note's media too?*, is After Clipping's own. It lists:
  - the video on the drive, with its size;
  - its subtitles in the vault;
  - its library note.
- On *Delete*, the video goes to the macOS Trash (on the drive, `.Trashes`) and the
  rest to the vault trash.
- The rules around it:
  - Deleting a folder asks once for all its notes.
  - Anything another note still links is never offered.
  - With the drive unplugged, the video is listed as staying.
  - Vault files the note linked itself stay with Obsidian's popup.
- A queued video whose note was deleted is no longer moved to the drive.
- Tested in `TESTFIELD`: the popup listed all three, and *Delete* sent each to the
  right trash. His answer to the design: *"Yes, do what you think is best."*

## 1.16.0

- **Where the video goes is a choice in the download popup.** A "Save the video"
  dropdown under the Video + Audio buttons: *On 4T-HDD* or *In the vault*. It is
  preset to the default, which the commands also use. His words, 2026-09-24: *"make
  sure the default location works with command, and also have default location in
  download popup too along with Video + Audio ..., we could have it as a slide down
  option or something."* The default is the drive when *Videos outside the vault* is
  set, except in a folder listed in the new setting *Keep videos in the vault in these
  folders*: the sensitive ones, like Psycho-history's `Temp Videos`, which his table
  keeps on the Mac (*"based on vaults and materials"*). He saw it open, and confirmed:
  *"Yes, it open and there is location slide down in it."*
- **An unplugged drive no longer blocks a single download.** The drive's entry is
  disabled, and the video goes in the vault. Being there only for that reason, it is
  queued to move to the drive once the drive is back. A run of several videos with no
  choice made still refuses, so a whole playlist never lands on the Mac by default;
  choosing *In the vault* in the popup is what allows it. Before, every download to an
  unplugged drive was refused.
- **Subtitles in Media Extended.** After a video is saved to the drive, a Media Extended
  library note (`media-lib/url-<id>.md`, with `mx-uid`, `video:` and `subtitles:`) lists
  its `.vtt`, which stays in the vault, so the transcript works. He checked the route
  by eye (*"Both show subtitles!"*); a probe of the player's native text tracks had
  stayed empty meanwhile. The same note as `backup-strategy/link-subtitles.py`, which
  wrote it for the 294 videos already on the drive.
- Tested in `TESTFIELD` with a short video:
  - a download to the drive, then its library note;
  - a download with the drive pointed somewhere unplugged: vault, queued, then moved
    once the setting was back;
  - YT Playlists refusing a multi-video run and falling back on a single note.
- **Moving a video from the vault to the drive** (After Clipping only). The
  queued videos move when the drive is back, within a minute, if *Move videos to the
  drive when it is back* is on. His words: *"Should we make auto move video once plugin?
  I think a toggle on off in setting will do."* A video saved in the vault by choice is
  never queued. The move:
  1. copies the video to the drive and checks the size;
  2. switches every note whose `media` links it to the `file:///` address;
  3. removes its embed, and adds the readable drive link and the library note;
  4. sends the vault copy to the trash.

  Two commands: *Move videos waiting for the drive now*, and *Move this note's video to
  the drive*, for any note's video. The second is the in-Obsidian form of
  `move-videos-out.py`. YT Playlists hands its queued videos over through
  `queueDriveMove`.

## 1.15.0

- **A palette command, *Relink videos on the outside drive***, which runs
  `backup-strategy/relink-videos.py`: every note's `file:///` link to a video that was
  moved or renamed on the drive is rewritten to where the video is now, in every
  vault, and the result shows in a notice. The script already runs after every
  backup; this is for right after reorganising the drive in Finder. He had looked
  for it in the palette and found only a link in `Backup Strategy.md`; his words: *"I
  think you should add a command either way."* The plugin only starts the script, so
  the relinking logic has one copy. A new setting, *Relink script*, holds its path and
  fills itself in when the script is at `~/Documents/backup-strategy/`. In After
  Clipping only, not YT Playlists, because the drive label is already After
  Clipping's and the two divide work rather than each carrying the same feature.
  Tested in `TESTFIELD`: renaming the test video on the drive and running the command
  moved both notes' links to the new name, including a `#t=` timestamp, and renaming
  it back returned both notes byte for byte. The test found a bug in the script,
  fixed there (see `backup-strategy/CHANGELOG.md`).

## 1.14.0

- **The `media` property reads "4T-HDD: <file name>" for a video outside the vault**,
  instead of its long `%`-encoded `file:///` address. Display only: the stored value
  stays the bare URL. His words: *"what I mean is to have readable name in the
  property, not in the note's body."* **The element's text must stay the address:**
  Media Extended 4.2.1 opens a click on a `media`/`video`/`audio` property only when
  the clicked element's `textContent` is a URL. A first version replaced the text
  and every click went to the web browser, which he caught, External Video Test
  included. So CSS hides the text (`font-size:0`) and a `::before` draws the label
  from a data attribute. `::before` is used because `::after` drew nothing. Obsidian
  redraws a property by swapping the text inside the same element, so the watcher
  checks changed elements as well as new ones. Tested in `TESTFIELD`: the label shows,
  and a click opens Media Extended's window.

## 1.13.1

- **A readable link to a video outside the vault, at the top of the note body:**
  `[4T-HDD: <file name>](file:///…)`. `media` has to stay a bare `file:///` URL,
  because Media Extended 4.2.1 reads nothing else there, and a labelled link in a
  property opens in the web browser (tested). So the properties panel shows a long
  `%`-encoded address. His words: *"One prolem is link name of media file in property,
  they are currenly full system root path with lot of % simple, can you change it so it
  will be like "4TB-HDD: File name" instead?"* He chose this form over keeping the raw
  address or drawing the property with Obsidian's undocumented internals. A link in
  the body opens in Media Extended's window. `(` and `)` are encoded in it too, so a
  folder like *Dante Seminar (June 2026, Beijing)* can't end the link early. It is
  added once: only the body is checked, since `media` always holds the same address.
  The 295 videos moved on 2026-09-24 got the same link from
  `move-videos-out.py --body-links`, and `relink-videos.py` renames the label when it
  follows a renamed video. Tested in `TESTFIELD`.

## 1.13.0

- **Videos outside the vault.** A new setting, *Videos outside the vault*: an
  absolute folder on another drive, such as `/Volumes/4T-HDD/Media`. When it is
  set, a downloaded video goes there, under the vault's name and the folders it
  would have had in the vault, so `Psycho-history/YouTube/…/Materials/x.webm` becomes
  `/Volumes/4T-HDD/Media/Psycho-history/YouTube/…/Materials/x.webm`. Subtitles and
  audio stay in the vault. yt-dlp is given a separate `subtitle:` output template
  for that, so the `.vtt` Claude reads stays beside the note. `media` is written as
  a bare `file:///…` URL, the form Media Extended 4.2.1 reads and plays in its own
  window. A markdown `[Video](file:///…)` link opened in the web browser instead.
  Empty, the default, changes nothing.
- **A video outside the vault is not embedded in the body.** An embed of a
  `file:///` video plays but prints its whole encoded address under the player,
  so the `media` property links it instead. Audio, in the vault, is still
  embedded. A YT Playlists note is still handed to that plugin (1.11.0), which
  has the same setting in 1.7.0.
- **Nothing downloads while the drive is unplugged.** A video download is refused
  with a notice. It never falls back to the vault, and never creates the folder: on
  an unplugged drive, `/Volumes/<name>` is a plain folder on the Mac's own disk.
  A drive counts as plugged in when `/Volumes/<name>` has a different device
  number from `/Volumes`.
- **The Media Extended version goes in the log on load**, only when the setting is
  set: `Media Extended 4.2.1, the version videos outside the vault were tested
  with`, or `not the tested 4.2.1` for any other version. Hoang Anh keeps 4.2.1 on
  purpose: *"I specifically use 4.2.1 because it's more stable, 4.2.5 were bugged
  from my experience using it."*
- Why: the non-sensitive videos (Psycho-history, TECHNOS, Obsidian, about 107 GB)
  move to 4T-HDD to free the Mac's disk. On 2026-09-24 Hoang Anh chose a setting
  in the two downloaders over a separate plugin. The reasons are in
  `~/Documents/backup-strategy/CHANGELOG.md`, and the plan is in
  `Videos Outside the Vault.md` beside it. Tested in `TESTFIELD` against 4T-HDD:
  a manual *Download video and audio* (video on the drive, mp3 and `.en.vtt`
  in the vault) and the automatic pass on new clip notes (renamed, duration filled,
  video on the drive).

## 1.12.0

- **A clipped video gets its length.** On by default (*Fill the video length*):
  when a clip is a video and the note has no `duration`, or an empty one as the
  Web Clipper template leaves it, the length is written there in whole minutes
  rounded up, the same as ARCH YT Playlists writes on a synced video note. A
  value already there is kept. YouTube titles come from oEmbed, which carries no
  length, so the watch page is read for its `lengthSeconds`: one request with no
  cookies, about a second, where a yt-dlp lookup takes seven to ten. Other hosts
  get it from the yt-dlp metadata call they already made, which now prints the
  duration too. New command, *Fill video length for this note*, for notes
  clipped before. His words: *"there is one hidden feature in YT Playlist that I
  want After Clipping to have by defaut, which is fetch video length. Like if I
  sync video playlist, it will add video note that have video length in them.
  How can I have that for After Clipping? The web clipper template don't have
  that so we will need to fetch with plugin."* Tested in `TESTFIELD`: 6:03 → 7,
  3:33 → 4 on a fresh clip, Dailymotion through yt-dlp → 248 s.

## 1.11.0

- **The four download commands hand a YT Playlists note to that plugin.** On a
  video note (`yt-playlist`) they call ARCH YT Playlists' own download with the
  choice made, so the file lands in the playlist's media folder beside the rest
  of the playlist, named and pruned the way that plugin does it; on a playlist
  note (`dl-all`) they download the whole playlist. Before, a video note
  downloaded here went into this plugin's own media folder, apart from its
  playlist. Without YT Playlists enabled, a video note is downloaded here as
  before and a playlist note is refused. **A note recognised by
  `otherArchTags` (a channel note) is refused**: its `url` is a channel address,
  and the manual command used to hand it to yt-dlp, which downloads the whole
  channel. YT Playlists 1.6.0 dropped its own single-note command the same day,
  so single notes are this plugin's job and playlist notes that one's.
  His words: *"Also change YT playlist 'Dowload media for this note' to 'Dowload media
  for this playlist note', better clarity"*, and then *"only run when in playlist note,
  the reason is we already have after clipping for individual video/note, we're just
  doing bad job at making the two plugins in synergy with each other, please fix
  that!"*

## 1.10.0

- ***Download media for this note* is four commands now**: *Download video and
  audio for this note*, *Download video for this note*, *Download audio for this
  note* and *Download subtitles for this note*. Each is the choice itself, so it
  skips the choice dialog and any choice remembered for the session. His reason:
  YT Playlists has a *Download media for this note* too, so the palette showed
  two identical names, and the subtitles choice was hidden inside a dialog; he
  searched the palette for a subtitles command and found none. YT Playlists is
  unchanged. The automatic pass still asks, as before. No vault had a hotkey on
  the old command.

## 1.9.3

- **A fourth download choice: Subtitles.** In the prompt and as a default
  choice, matching YT Playlists 1.5.1. Fetches only the subtitle files, into
  the folder the video would go in and under its stem, so a later video
  download finds them there and yt-dlp does not fetch them again. Nothing is
  linked or embedded and no property is written — a subtitle is a sidecar,
  never the media. If a subtitle file for the note is already there, nothing
  is fetched. The processed record is written as usual, so the automatic
  pass will not come back for the video; *Download media for this note*
  still will.

## 1.9.2

- **Property order no longer moves properties a note already has.** 1.9.0
  applied the order to the whole note — listed keys first, the rest after —
  and the list is a *video* note's shape. On a clipped article it dragged
  `url`, `published` and `tags` to the top of a template that had them
  elsewhere, every time the plugin wrote a cover image or media. Now the
  order decides only where a property this plugin **adds** goes: after the
  nearest listed property the note already has, else before the nearest one
  below, else at the end. `media` and `dl-ed` still land in the template's
  place on a YT Playlists note; a hentai clip keeps its own order.
- **A plain `[Cover](url)` in the body is rewritten when that address was
  downloaded for a property or embed.** The body pass only handled `![]()`
  embeds and `<img>`, so a template that wrote `[Cover]({{image}})` in the
  body and the same address in a cover property got the property updated and
  the body link left remote. It becomes a link to the saved file, in the
  vault's link syntax, keeping its label. A plain link is never a download
  candidate on its own — only an address already fetched is rewritten.
- **The default order names `rank`, not `v-rank`**, following YT Playlists
  1.4.4. A saved order that is exactly the old default moves; anything typed
  stays.

## 1.9.1

- **A clip that launched Obsidian is now processed.** Saving from Web Clipper
  to a vault that is not open starts Obsidian and writes the note during
  startup — before the plugin's listener exists, because that listener is
  deliberately registered after layout-ready to sidestep the re-index replay.
  The result was the one clip that mattered being the one clip never seen; the
  workaround was deleting the note and clipping again. Once the listener is in
  place the plugin now sweeps for notes younger than the grace window (the
  same 120 s the replay guard uses) that carry a source URL, and runs them
  through the normal entry point. A young note without a URL is left alone —
  the live listener takes any new note because it saw it being born, but here
  the only evidence is a young file, and that could be one the user just made
  by hand. The console line is `clipped before the plugin was listening,
  catching up:`.

## 1.9.0

- **A *Property order* setting, applied whenever this plugin writes a note's
  properties.** Downloading media used to append `media` at the bottom and
  shove `dl-ed` to the top, so a video note looked different depending on
  which plugin had downloaded it. Listed properties now come first in the
  configured order and everything else keeps its place after them. The default
  is the ARCH video note template — `media, channel, yt-playlist, banner, url,
  dl-ed, v-rank, duration, status, published, tags` — the same as YT
  Playlists' default. Empty keeps whatever order a note already has, which is
  the old behaviour minus the `dl-ed` shuffle.

## 1.8.0

- **Notes can be left alone by tag as well as by property.** New setting
  *Leave notes carrying these tags alone*, default `yt-channel`. ARCH YT
  Playlists' channel notes have no marker property — their frontmatter is
  `url`, `icon`, `banner`, `tags` and nothing else — and a channel note's `url`
  would otherwise send yt-dlp after the entire channel. Missing defaults are
  appended to a saved list on load, the same as `otherArchKeys`.
- **Image properties can carry a label of your choosing.** The new *Labels for
  image properties* setting takes `property=Label` pairs, e.g. `banner=Banner,
  icon=Icon`, and a listed property is rewritten as `[[file.webp|Banner]]`
  instead of the bare `[[file.webp]]`. A label the template already gave the
  value — `[Thumbnail](url)` on a video clip — is kept in preference to the
  setting, since the template knew what the picture is; the setting fills in
  for bare addresses and `![](url)`. Unlisted properties are unchanged, and
  the default is empty. The alias form was removed in 0.16.0 because no single
  label fits every property this plugin might touch; a label per property is
  the answer to that objection rather than a reversal of it.
- **ARCH X Archive notes are now left alone.** `otherArchKeys` gains `x-author`
  and `x-name`, which that plugin writes on both its note types. Without them
  every archived X post got a full yt-dlp metadata probe, about three seconds
  each, and media downloaded into the profile folder — tens of thousands of
  probes at a few hundred profiles.
- A saved `otherArchKeys` list no longer shadows new markers: missing defaults
  are appended on load rather than the list being replaced, so a vault
  configured before ARCH X Archive existed is fixed without editing the setting
  by hand. Keys added by hand survive.

## 1.7.0

- **Only one subtitle file is kept per download.** `--sub-langs en.*` matches `en`,
  `en-US`, `en-GB` and `en-orig`, so yt-dlp wrote a separate file for each and a
  single video ended up with four tracks beside it. The closest match to the
  requested language is kept — a plain code, then the original-language track, then
  a regional variant — and the rest are deleted. `pruneSubtitles` is ported from
  ARCH YT Playlists, which hit this first. Only files named after the video itself
  are considered, so a subtitle put in the folder by hand is never touched, and a
  failure to delete one is logged rather than failing the download. The new *Keep
  only one subtitle file* setting turns it off.
- **New defaults for where things are saved.** Media and images both default to a
  subfolder beside the note — `Medias` and `Images` — so a note in `Clips/YouTube`
  gets `Clips/YouTube/Medias` and `Clips/YouTube/Images`. A named path like
  `YouTube/Medias` was the obvious first choice and the wrong one: this plugin
  clips any site, so the folders have to follow the note rather than name a single
  source. Images previously followed Obsidian's own attachment setting.
- **The separate `archived` done marker is gone.** It had not been written into
  notes since 1.0.0 and was only read, which left two properties meaning almost the
  same thing. The skip check now reads `dl-ed`, the property the media step already
  writes, so one property both records a download and prevents a repeat. **Forget
  this note** clears that property along with the URL record. Diagnose reports
  *Already downloaded* rather than *Already archived*. Notes clipped before 1.0.0
  carry `archived` and are still honoured — the setting is gone, the property is
  not, because re-downloading media for a note that already has its files is the
  one thing the marker exists to prevent.
- **The default ignored folder is `_` rather than `Templates`.**

## 1.6.0

- **New setting: mark the note as downloaded.** A property — `dl-ed` by default —
  is set to `true` alongside `media`, in the same frontmatter write, once the files
  are on disk. It is written after the save rather than before it, so it cannot
  claim a download that failed. Leave the setting empty to write nothing.
- The reason it was needed: the YouTube clipping template carries `dl-ed: false`
  and nothing was flipping it. This plugin never wrote the property, and ARCH YT
  Playlists only writes it on notes it owns — which a Web Clipper note, carrying no
  `yt-playlist` marker, is not. The field sat `false` forever in both plugins' blind
  spot.
- **A note without the property gets it as its first one.** Assigning a key that was
  not already there appends it below every other property, which buries a status
  flag at the bottom of the block. A note that already carries the property keeps
  the position it had, so a template's own layout survives.

## 1.5.0

- **The transformer scripts now ship inside `main.js`.** A release delivers only
  `main.js`, `manifest.json` and `styles.css`, so the `transformers/` folder never
  reached an installed vault. Every install that was not a copy of the repository
  folder — which is every BRAT install — had two transform rules enabled by
  default, for Gemini and Reddit, both pointing at files that were not there. The
  scripts are now embedded and written to `transformers/` on load.
- **A copy already on disk is never overwritten.** If the file exists it is left
  exactly as it is, because it may be one you edited, and your own scripts in that
  folder are untouched regardless of name.
- **New command: Restore the bundled transformer scripts.** Overwrites the two
  bundled files with the versions inside `main.js`. This is the only way a fix to a
  shipped script reaches a vault whose copy is stale, since load never overwrites.
- Failing to create or write the folder is logged and skipped rather than thrown,
  so a read-only plugin folder cannot stop the plugin from loading.

## 1.4.0

- **The duplicate-trashing option is gone.** Not made safer — removed. Its stated reason was that a second clip "downloads the video twice", and the processed-URL record already prevents that, keyed on URL, whether or not a duplicate note exists. So it was solving a solved problem using the only irreversible action in the plugin. A duplicate note is visible in the file list and takes a second to delete by hand; duplicate *media* is the thing that is hard to notice, and that is handled by image hashing and the record. The setting is now **Tell me** or **Do nothing**, and a saved `trash` value migrates to the former.
- After this, nothing in either plugin deletes a note. The only remaining deletion touching your folders is subtitle pruning in ARCH YT Playlists, which removes only tracks it downloaded seconds earlier and can be turned off.

## 1.3.0

Fixes a data-loss default.

- **Duplicate handling no longer trashes anything by default.** `duplicateAction` defaulted to `trash`, which moved a newly created note to trash whenever its `url` matched an existing note's. The trigger is Obsidian's `create` event, which fires for *every* new file, so a note written or saved by hand was indistinguishable from a second Web Clipper clip — and got trashed. The default is now `warn`: both notes are kept and a notice names the other one.
- **Trashing, when chosen, refuses to destroy the larger note.** A second clip of the same page is the same size or smaller than the first. A note with more content is not a duplicate of the thing it matches, so it is kept and reported instead. A guard, not a guarantee.
- **The notice now says where the note went**, since `trashFile` follows the Obsidian setting and a trashed note is recoverable from Settings → Files and links → Deleted files.
- The setting is relabelled to say plainly that matching is on the `url` property alone, that it applies to any note created in a watched folder, and that trashing is destructive.

## 1.2.0

- **The ownership markers are a setting.** *Leave notes owned by another ARCH plugin alone* holds the property names — `yt-playlist` and `dl-all` by default. Adding a marker no longer needs a code change on this side.

## 1.1.0

- **Playlist notes are recognised as ARCH YT Playlists' too.** 1.0.0 checked only for a `yt-playlist` property, which video notes carry and playlist notes do not — so playlist notes were still renamed on every sync. `dl-all` is now accepted as a second ownership marker.

## 1.0.0

The first version meant for anyone other than its author. It was never published — `1.5.0` is the first public release. The entries below record how it got here.

- **The ARCH YT Playlists ownership check now works.**

- 0.23.0 read the `yt-playlist` property from the metadata cache, but a note written moments earlier is not in the cache yet — which is exactly when the automatic pass runs. `fm` was null every time and the check never fired once. The raw frontmatter is read as well now.

## 0.23.0


- **Notes owned by ARCH YT Playlists are left alone.** Any note carrying a `yt-playlist` property is skipped by the automatic pass. Until now After Clipping renamed those notes, re-fetched their images and raised a download prompt for each one on every sync — including renaming the playlist note itself. Folder exclusion also works, but it lives in settings, and settings are no help to anyone who reinstalls by replacing the plugin folder. Running a command by hand still processes the note.

## 0.22.0


- Comment only, no behaviour change. `rewriteImageValue` justified the bare wikilink by claiming an alias renders as its label rather than the picture. That was never verified and turns out to be wrong — aliases render fine in Pretty Properties. The real reason for the bare form is that this plugin clips any site, so no one label fits every property. Recorded properly so the next reader does not "fix" it back.

## 0.21.0

- **Removed a duplicate `embed-local-player` command.** It was registered twice with the same id and name but different bodies — one inline, one calling `embedFromFrontmatter`. Obsidian keeps one and discards the other, so forty lines had never run.

## 0.20.0


- **The archived record no longer stops everything, only the download.** It used to return before the whole pipeline, so deleting a note and clipping the page again did nothing at all — the most common thing you do while testing. The record exists to stop a large download running twice, so it now gates the media step alone. Images, rename and transform run again on a re-clip. **Forget this note** still clears the record when you want the media back too.
- **An identical image already in the vault is reused instead of copied.** Re-clipping used to leave `name-1.jpg` beside the original, because the old attachment was still there and `uniquePath` stepped around it. Files that could have taken this image's name are now hashed and compared, and a byte-identical match is linked to rather than re-saved. Only same-named candidates are read, so the check stays cheap.
- **Twitter/X and Instagram default to path-scoped patterns.** Both serve profiles and videos from one domain, so a bare `x.com` entry meant every profile clip paid for a yt-dlp round trip — measured at 7–10s — to discover there was no video. The defaults are now `/(?:twitter|x)\.com\/[^\/]+\/status\//` and `/instagram\.com\/(?:p|reel|tv)\//`. A slash-wrapped entry in **Media hosts** has always compiled as a regex; only the defaults changed. An existing vault keeps its saved list.

## 0.19.0


Fixes what 0.18.0 claimed to fix. The prompt still appeared, just later.

- **`doMedia` was asking on its own.** 0.18.0 gated only the early parallel prompt. When that was suppressed, `doMedia` reached its own fallback — ask whenever no mode was handed in — and consulted the same host allowlist the upstream fix had just overruled. The prompt therefore moved to *after* the images rather than going away. The metadata result is now passed down, and the media step is skipped outright when the lookup found no formats.

## 0.18.0


- **The download prompt only appears when there is something to download.** It was gated on the URL's *host*, so any address on a known media host raised it — an x.com profile, a subreddit, a channel page. The metadata call now also prints `%(format_id)s`, which comes back as `NA` when a page carries no media, and both the prompt and the rename are gated on that instead.
- **One metadata lookup instead of two paths.** The rename and the prompt used to run independently, each deciding for itself from the host. They now share a single `fetchChannelAndTitle` result.
- **Non-media pages no longer pay for a rename.** A clip of an x.com profile spent ~10s on two yt-dlp calls fetching a channel and title that did not exist, and images could not start until it finished. That lookup is now skipped when there are no formats.
- Trade-off worth knowing: the prompt used to open immediately, in parallel with the rest of the pipeline. It now waits for the metadata answer. YouTube is unaffected — oEmbed replies in milliseconds — but on other hosts the prompt appears after the yt-dlp call rather than instantly. A new `metadata done` lap time shows exactly what that costs.

## 0.17.0


- **A re-clip of an archived page is now deduplicated.** The already-archived check returned before `findExistingClip` ever ran, so clipping a page a second time left both notes in the vault — the exact thing `duplicateAction` exists to prevent. Duplicate handling now runs first; the archived skip runs after it.
- **New command: Forget this note, so it can be archived again.** The processed record is keyed on the source URL, not the note path, so once a page was archived every future clip of it was skipped wherever it landed, with no way out short of editing `data.json`. The command clears the URL and the note path from the record, and also removes a legacy `archived` property left by older builds, which would otherwise keep blocking on its own.
- **`icon` added to the default image properties.** It is a common property name in clipper templates and was silently ignored.

## 0.16.0


- **Images have their own folder list.** `inScope` used to gate images, transform and media together, so narrowing where images downloaded also narrowed where video did. A new **Download images only in these folders** list scopes the image pass on its own; media still runs everywhere the plugin runs. Subfolders are included, an empty list means every folder, and running **Download images for this note** by hand ignores the list — doing it by hand is already a statement of intent.
- **Save locations now match Obsidian's own.** Both images and media offer Vault folder, Same folder as the note, In subfolder under the note, and In the folder specified below. Images keep a fifth choice, *Follow Obsidian's attachment setting*, which is what a blank folder used to mean and remains the default. An existing vault derives its mode from what it was already doing, so nothing moves on upgrade.
- **Frontmatter image properties are now a plain `[[file.png]]` wikilink**, not `[Label](path)`. The alias form `[[path|label]]` is deliberately avoided: in some property views it renders as its label instead of the picture. Any label the property carried is dropped rather than moved, so the **Label for bare image addresses** setting is gone with it.
- Media downloads still go anywhere, which is the point of splitting the two lists.

## 0.15.0

- **`archived` is no longer written into notes.** Every clip was getting a property you then had to delete by hand. The record of what has been archived now lives in the plugin's own data, so notes stay clean. The property is still *read* on notes that already carry it, so nothing gets reprocessed.
- **Image properties normalise to a labelled markdown link** with the full vault path: `[[Image Name|Banner]]` becomes `[Banner](<attachments/Name.jpg>)`, keeping the label. A wikilink alias renders as its label rather than the image in some property views, so the shape is set rather than copied from the template.
- **Installed tools moved to `.obsidian/arch-tools/`.** yt-dlp was being installed inside the plugin folder, so replacing that folder to update the plugin deleted it — which is what caused `spawn yt-dlp ENOENT`. The old location is still checked for existing installs.
- A missing binary is now named before the download starts, rather than surfacing as a generic failure afterwards, and the first-run notice says which tool is missing.
- **Version numbers realigned across both ARCH plugins.** The two had drifted to 5.3.0 and 3.1.0 through separate rename histories, which made "which version am I on" a per-plugin question. They now move together from 0.15.0. See the mapping table above.

## 0.14.0

- **New: Check what yt-dlp can see (JavaScript runtime and solver).** Runs yt-dlp with `-v` and reads its own debug output — the optional libraries list, which must contain `yt_dlp_ejs`, and the JS runtimes list, which must not be empty. It then says which of the two is missing. Two versions in a row were spent guessing at this; yt-dlp reports it directly.
- **The JavaScript runtime setting is filled in with a full path**, e.g. `node:/usr/local/bin/node`, rather than left blank. A bare name relies on yt-dlp finding the binary on PATH, and the PATH an Electron app inherits is often much shorter than a terminal's — so a runtime that this plugin detects can still be invisible to yt-dlp.

## 0.13.0

- **Fixed YouTube downloads failing with "The page needs to be reloaded".** yt-dlp needs an EJS solver script for YouTube's signature and n-challenges. The library ships inside the standalone build, but the script itself is fetched at run time and that fetch is off by default, so solving failed no matter how many runtimes were installed. `--remote-components ejs:github` is now passed by default, and exposed as a setting for anyone who would rather yt-dlp fetched nothing.
- **The setup screen stops claiming the solver is fine.** It reported "bundled with the standalone build" purely from the install method, without checking whether the script could actually be fetched — so it showed green while downloads were failing for exactly that reason. It now reports whether the fetch is enabled.
- Failure detection recognises "The page needs to be reloaded", "challenge solving failed", and "remote component ... skipped", and the notice names the real cause instead of pointing at a missing package.

## 0.12.0

**The video thumbnail feature is removed.** Seven attempts across as many versions; none worked. A poster cannot be attached when a media plugin renders the player in its own frame, and the two workarounds — a self-rendered block, and a thumbnail linking to the video — both failed in practice.

- Removed: the `arch-video` block and its renderer, the thumbnail-link style, the three-way style setting, and the poster-matching helpers. Notes get a plain `![[file]]` embed, which is what a media plugin expects.
- **New: Clean up old video blocks across the vault.** Versions 0.8.0 to 0.11.0 wrote blocks that nothing renders now, so they would sit in notes as raw text. This replaces each with a plain embed, recovering the file path from the block's `video:` line or, for a block left malformed by the 0.10.0 bug, from the embed inside it.
- Thumbnails are unaffected: still downloaded, still saved, still recorded in `img`, which is what Bases reads. That was the original requirement and it has worked since 0.2.0.

## 0.11.0

- **The player accepts clicks in Live Preview.** Obsidian treats a click on a rendered block there as a request to edit it, so the press never reached the controls — the thumbnail appeared but nothing played. The container is now marked non-editable and keeps the click to itself.

## 0.10.0

- **Switching embed style replaces the old one instead of stacking on it.** The cleanup only removed remote YouTube links, never a local `![[file]]` embed, so each switch left the previous form in place. A later strip could then leave bare fences wrapped around a surviving embed — an `arch-video` block with no `video:` line, which rendered as "Video not found: (none)". All three forms are now removed before a new one is written, and a malformed block left by the old bug is repaired on the next run. Verified over seven consecutive style switches: one embed, body intact.
- The thumbnail-link matcher was truncating at the first bracket, so a filename containing parentheses — `... (BQ).jpg` — was never matched. Same bug as the img property parser had.
- **The note's image property is used as a poster when no same-named image exists.** A thumbnail swapped by hand no longer shares the video's name, so name matching alone could not find it.
- **Player with the thumbnail is now the default.** Plain embed remains available for handing the file to another media plugin.

## 0.9.0

- **Renamed to ARCH After Clipping**, folder `arch-after-clipping`. It runs on notes Web Clipper has already made, and the name now says so rather than reading like a clipper itself.
- Settings migrate through every previous folder: `arch-web-clipper`, `arch-clipping`, `archive-clippings-plus`, `clip-archiver`.

## 0.8.0

- **Renamed to ARCH Web Clipper**, folder `arch-web-clipper`. Settings migrate from `arch-clipping`, `archive-clippings-plus` and `clip-archiver` in turn.
- **Images go where Obsidian puts attachments**, using `getAvailablePathForAttachments`. The image folder setting is now blank by default and only overrides that when you set it, so the vault's own preference is respected instead of a folder this plugin invented. (Approach taken from Meikul/obsidian-thumbnails, MIT.)
- **Player with the thumbnail on it is back**, as a third choice under *How the video appears in the note*. It writes an `arch-video` block that this plugin renders as a real video element with the saved image as its poster.

  This is the only way to get a poster onto a local video: an `![[embed]]` gets taken over by a media plugin and leaves no `<video>` element to attach one to. Building the element here avoids that entirely.

  The trade is that the block only renders while this plugin is installed. It was ruled out earlier for that reason; it is back because the alternative is no poster at all. The other two styles remain plugin-independent.

- Old `archive-video` blocks are cleaned up when a note is re-embedded.

## 0.7.0

Adds bulk YouTube archiving. Notes are written after a fast enumeration pass, then filled in by a slower details pass, so the vault is useful within seconds.

- **`bulk/` module**, loaded in-process rather than spawned. No Node binary needed, no `npm install`, and it reuses the plugin's own yt-dlp runner, folder helpers, and vault writers instead of duplicating them.
- **Two passes.** `--flat-playlist --dump-json` lists everything in one call; a second call over the whole playlist streams per-video JSON and writes subtitle files. One process for the set, not one per video.
- **Transcripts by default, media opt-in.** Auto-captions arrive as VTT rolling captions where each cue repeats the previous line and appends words — a naive strip roughly doubles the line count. The converter collapses exact repeats and prefix-extensions, strips word-level timing tags and HTML entities, and emits timestamped paragraphs. Tested at 9 raw lines to 4 clean ones, plus 8 edge cases (manual subs, SRT-style commas, NOTE blocks, cue identifiers, mm:ss timestamps).
- **Description trimming**, shared with the single-clip pipeline. Cuts at the first promo heading, drops timestamp lines, affiliate and social URLs, hashtag piles, and divider bars including box-drawing characters. A realistic description went 502 chars to 145 with the real text and the paper link intact; clean descriptions pass through untouched.
- **Chapters come from yt-dlp's structured `chapters` field**, not parsed out of description prose.
- **Idempotent re-runs.** `video-id` in frontmatter indexes the vault, so re-syncing skips what exists. No state file.
- **Provenance and judgment are separate fields.** Sync writes `yt-playlist`, `video-id`, `url`, `channel`, `duration`, `published`. It writes `category` once at creation and never touches it again, so hand-sorting survives every later sync.
- Playlist shortcuts: `Watch Later`, `Liked`, `History`, `Subscriptions` resolve to yt-dlp's `:yt*` aliases. Private playlists work with your existing cookies.
- Bulk notes are created with `archived: true`, so the single-clip watcher ignores all of them. No modal storm at any count.
- **Subtitles for single clips too**, as a separate toggle rather than a fourth download button.

## 0.6.0

- **Images: added a Node `https` fallback.** `net::ERR_BLOCKED_BY_CLIENT` means a content blocker intercepted the request inside Chromium's network stack, which is what Obsidian's `requestUrl` uses. Node's http stack does not go through it, so a blocked request now retries there instead of giving up. A blocked error skips straight to that fallback rather than burning a retry on a stack that will never succeed.
- **Diagnosed "Requested format is not available" properly.** It does not mean the format string is wrong. YouTube returned only storyboard images, which happens when the challenge solver scripts are missing. `yt-dlp-ejs` is a *separate* PyPI package — `pip install -U yt-dlp` does not pull it in, and it is not part of the `default` extra either. Standalone builds bundle it; pip installs do not.
- Setup screen now has a **YouTube challenge solver** row with an Install button that runs `pip install -U yt-dlp-ejs`, retrying with `--break-system-packages` on managed environments.
- **The probe no longer lies.** It ran `--simulate` without `--ignore-no-formats-error`, so a format-selection failure was reported as "yt-dlp does not handle this URL" — which is why media download stopped silently on a page yt-dlp understood perfectly well.
- Failure notices distinguish "no real formats came back" from an ordinary format miss, and name the actual fix.
- **New command: List available formats for this note's URL.** Runs `yt-dlp -F` and, if it sees the storyboard-only signature, says so at the top instead of making you read the table.
- Added a **JavaScript runtime** setting that passes `--js-runtime` when yt-dlp cannot find one itself.
- Renamed the button to **Video + Audio**.

## 0.5.0

Fixes the actual cause of `(no url)`. My 0.4.0 diagnosis was wrong: the property really is named `url`, and `[Link](https://...)` parses fine. The bug was *when* the read happened, not what it looked for.

- **Fixed a race between the `create` event and the file being written.** `waitForFrontmatter` read the file the instant `create` fired. On a not-yet-flushed file that read returns an empty string, `''.startsWith('---')` is false, and the method returned immediately from a metadata cache that had not parsed the new note yet — so it produced `null` without ever entering its own polling loop. That early return existed to avoid a 4-second wait on notes with no frontmatter, and instead skipped the wait entirely for exactly the notes that needed it.
- Replaced it with `waitForNoteContent`, which polls the file itself and only returns once the content is non-empty *and* either has no frontmatter fence or has a complete one. Verified against a simulated staged write: 6 polls through the empty and half-written stages, versus the old code bailing on the first.
- **Added a raw frontmatter parser as a backstop**, so the URL is read straight out of the text block when the metadata cache is cold. Both paths are tried and either can win.
- The archived marker is also checked against the raw block, so a cold cache cannot cause a note to be reprocessed.
- `doMedia` and `doTransform` re-resolve the URL from raw content too, and `processNote` no longer gates them on the first read succeeding.
- The no-URL warning now reports content length and whether the metadata cache was ready.
- `Inspect this note` shows both resolution paths separately, so a cache lag is visible at a glance.

## 0.4.0

Fixes the reason video downloading never fired.

- **The source URL is no longer read from one hardcoded property.** `frontmatterUrlKey: 'url'` only matched custom templates. Web Clipper's *default* template names the property `source`, so a clip made with it resolved to no URL at all — and since both media download and transform require one, they silently did nothing while image downloading (which scans the body) kept working. Now a list of names is tried in order (`url, source, link, permalink, original-url`), and if none match, any property holding a web address is used. An existing `frontmatterUrlKey` setting migrates in as the first entry.
- **A missing URL is now loud**, with a console warning naming every property that was checked.
- **New command: Inspect this note.** Shows the detected URL and which property it came from, whether the host counts as media, which transformer rule matches, and whether the media folder is set — so a failure like this is one command away from being obvious.
- `extractUrl` handles list-valued properties.
- Body image scanning skips video-page addresses, so a YouTube link written as a markdown image is no longer fetched and rejected as HTML.

## 0.3.0

Fixes found by actually running 0.2.0.

- **Auto-setup now fills the settings in.** In 0.2.0 the bare command name (`ffmpeg`) sat second in the candidate list, so it won via PATH and detection reported `path: "ffmpeg"`. `path.dirname("ffmpeg")` is `"."`, which failed the `isAbsolute` guard, so nothing was ever written — the fields stayed blank while the setup screen showed green. Absolute paths are now tried first, and a bare-name hit is resolved through `which` / `where` before use.
- **Media folder defaults to `media`** when empty. An empty media folder made `doMedia` return silently, which is why video downloading looked broken with no error anywhere.
- **Cookie settings auto-fill.** Detects installed browser profiles per OS and picks whichever was modified most recently — that's the browser you actually use. The setup screen has a dropdown over the detected browsers and a Test button that verifies extraction really works.
- **Python path auto-fills** from detection.
- **The setup screen lists what it just filled in**, instead of silently writing settings, and the settings tab re-renders on close so you see the new values.
- **Update yt-dlp handles pip and Homebrew.** When `-U` refuses, it reads the reason and runs `pip install -U yt-dlp` (retrying with `--break-system-packages` on managed environments) or `brew upgrade yt-dlp`. There's also an explicit *Install standalone* button that leaves your existing install alone.
- **Known-bad version warning.** Builds from `2026.07.04` up to `2026.08.19` carried the `android_vr` regression that returned 403 on downloads. Those now show red with the reason named, rather than a generic "old build" note.
- The setup screen shows how yt-dlp was installed (pip, brew, standalone).
- Frontmatter image scanning skips known video hosts, and expected non-image rejections dropped from `console.warn` to debug logging.

## 0.2.0

- Rewrote the yt-dlp retry ladder. Previously: your flags → a guessed `player_client=tv,web_safari` → no cookies. Now, ordered by how often each step actually resolves a 403 per current yt-dlp bug reports: plain retry after 4s → `--rm-cache-dir -4` → `player_client=mweb` → drop the forced format string → no cookies. Stops early once a failure no longer looks like a 403.
- Added **Set up external tools**: detects yt-dlp, ffmpeg, Python, and a JS runtime per-OS, auto-fills their paths, flags a yt-dlp build older than 30 days, and offers one-click install for yt-dlp (all platforms) and ffmpeg (Windows/Linux; no prebuilt macOS binary exists, so that one still points to Homebrew).
- Added **Update yt-dlp** command, separate from setup.
- Runs tool detection once automatically on first load.
- Frontmatter image rewrite now trusts the server's `content-type` instead of guessing from the URL extension, so cover images with no file extension get caught.
- yt-dlp download commands no longer force `--merge-output-format mp4` (that flag was fighting the retry ladder's "drop the format" step).
- Fixed alt text sanitization so an image caption containing `[`, `]`, or `|` can't break the generated wikilink.
- Download-queue promise chain no longer holds up an unrelated note's download if one fails.

## 0.1.0

- Merged the separate image-download and video-download plugins into one.
- Fixed the startup popup storm: the vault listener now registers inside `onLayoutReady`, so Obsidian's startup re-index of existing files no longer triggers the plugin. Backed up by a file-age check and an `archived` marker that's actually read (the old plugin wrote it but never checked it).
- Added a third download option (video / audio / video+audio / skip) with a "remember for this session" checkbox.
- Switched from shelling out with interpolated strings to `execFile` with argument arrays — closes a shell-injection path where a crafted clipped URL could run arbitrary commands, and stops filenames with quotes from breaking commands.
- Frontmatter image properties (`image`, `cover`, `thumbnail`, `banner`) are now rewritten to point at the downloaded local file, closing the manual step from the old images plugin.
- Added the Python transformer pipeline (site-matching rules → script on stdin/stdout) so Gemini and Reddit clips no longer need manual copy-paste into separate scripts.
- Made all path handling cross-platform (no hardcoded `:` separator, no Unix-only PATH patching, `PYTHONUTF8` set for Windows).
- Added `--no-playlist` by default.

## Before 0.1.0

Two separate, unversioned plugins: *Auto Download Video After Web Clipping* and *Auto Download Images After Web Clipping* (the latter based on a third-party plugin by chenxiccc). Not tracked here.

---

**Transformer scripts** (`transformers/gemini_chat.py`, `transformers/reddit_thread.py`) aren't part of the plugin's version number, since they can be edited or added to independently of a plugin update. Each carries a short header comment noting what it does; if you want them versioned too, say so and I'll add a version line to each script's docstring and log changes here under a separate section.
