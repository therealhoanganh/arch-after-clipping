# Changelog

Version lives in `manifest.json` — Obsidian reads it from there and shows it in Community Plugins, so that's the source of truth. This file explains what changed at each version. The two transformer scripts aren't part of the plugin version; see the note at the bottom for how they're tracked.


> **Numbering.** `1.0.0` is the first release meant for anyone other than its author. Everything before it was development and is numbered `0.1.0` upward in the order it happened, with no entries dropped or merged. Those versions were renumbered twice on the way here, so any number you see in an old console log or screenshot will not match this file.


## 1.13.1 — current

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
