# ARCH After Clipping

## Rules

### What It Is

- An Obsidian plugin that finishes what Web Clipper starts.
- It saves a clip's images into the vault and points its links and image properties at them.
- It runs a Python transformer over the body, and downloads video or audio with yt-dlp.
- Desktop only, because it starts other programs.
- Read `CHANGELOG.md` before changing behaviour. It records why each thing is the way it is.
- The old file word for word, with the full reasoning: `Documents/_/AI/arch-after-clipping/Details.md`.

### What Comes First

- Downloaded media and images are the expensive thing to protect. Notes are cheap, and he tidies them by hand. His words: "they are harder to manage, while clipped notes are easier and I can manually download myself."
- So anything that prevents a second download fails closed: when unsure whether a file was fetched, skip it.
- Keep honouring an old marker after its setting is gone. Dropping one downloads media again for notes that have it.
- Nothing deletes a note. Duplicate-trashing was removed outright. Never bring it back.

### YouTube and yt-dlp

- yt-dlp needs `--remote-components ejs:github`, or downloads fail with "The page needs to be reloaded".
- `--js-runtime` names the runtime by full path. Obsidian's PATH is far shorter than a terminal's.
- TESTFIELD's runtime is `deno:/usr/local/bin/deno`, picked on first run. node works too.
- Tool paths are synced, and each computer fills in its own. `localTool` skips a saved yt-dlp, ffmpeg or JavaScript runtime that is missing here or built for the other system, for the one on this computer's PATH. Never save the fallback: the two computers would overwrite each other.
- `runsHere`, `localTool` and `ytDlpBin` are copied word for word from YT Playlists.
- Obsidian refuses a request whose `Referer` is youtube.com. `fetchImage` retries a thumbnail without `Referer` and `Origin`, and logs "fetched without the Referer".
- A Media Sites entry wrapped in slashes is a regex. A bare `x.com` sends every profile page to yt-dlp, 7 to 10 seconds each, for nothing.
- A host feels slow when the log shows `metadata done` then `no downloadable media`: the pattern is too broad.
- Video + Audio is one download. The mp3 is cut from the merged file with ffmpeg.
- Audio is made in a temp folder first. Beside the video under the same name, yt-dlp deletes it.

### New Clips

- Read the note's own text for a new clip, not only the metadata cache. The cache is empty for its first seconds.
- The create listener is registered after layout-ready, to avoid a storm of popups at startup. Never move it earlier.
- So `catchUpStartupClips` sweeps for notes younger than `graceSeconds` with a source URL. That catches the clip that launched Obsidian.
- The processed record is keyed on the source URL, not the note path. It gates the media step only.
- Images and the transform run again on a re-clip, because delete and clip again is the normal test.

### Frontmatter

- `setFrontmatter` is the only frontmatter writer.
- `frontmatterOrder` places only the keys that write added. Keys the note already had never move.
- The default order is the same string as YT Playlists' `videoNoteOrder`, so `media` and `dl-ed` land in the same place from either plugin.
- An image property is a bare `[[file.jpg]]`, or `[[file.jpg|Label]]` when `frontmatterImageLabels` names that property.
- A label the template put on the value, such as `[Thumbnail](url)`, wins over the setting.
- A changed default reaches only a vault with no `data.json`. Settings load as `Object.assign({}, DEFAULT_SETTINGS, saved)`, and the settings tab saves on every keystroke.

### The Other ARCH Plugins

- No shared code with any of them.
- Notes carrying a key in `otherArchKeys` (`yt-playlist`, `dl-all`, `x-author`, `x-name`) are skipped by the automatic pass.
- YT Playlists' channel notes have no marker, so they are told by the tag in `otherArchTags` (`yt-channel`). yt-dlp given a channel address downloads the whole channel.
- Both checks read the raw frontmatter as well as the cache. A cache-only check never fired once.
- `loadSettings` adds missing default markers to a saved `otherArchKeys`, and keeps any key he added.
- The four Download … for This Note commands hand a `yt-playlist` note to YT Playlists' `bulkDownload` and a `dl-all` note to its `downloadWholePlaylist`.
- Renaming either method or a mode string (`video_and_audio`, `video_only`, `audio_only`, `subs_only`) makes a video quietly download here, into the wrong folder.
- Subtitle choice is YT Playlists' `lib/subtitles.js`, copied word for word above `sanitizeName`. Change both copies together. It keeps the main language's track and the one in the language the video is spoken in, any language, his rule of Oct 9.
- Subtitle Languages holds one language. A second one after a comma is dropped on load, saved and announced.
- `computerName()` and `automaticRunsHere()` are copied word for word into Images Plus.

### Videos Outside the Vault

- The plan and the reasons: `backup-strategy/Videos Outside the Vault.md`.
- A video goes under `<setting>/<vault name>/<the folder it would have had in the vault>`, so the drive mirrors the vault. Subtitles and audio stay in the vault.
- `media` is a bare `file:///…` URL from Node's `pathToFileURL`. A markdown link there opens in the web browser.
- A `file:///` video on an unplugged drive counts as downloaded. Never simplify this to an existence check: it would download whole playlists again.
- A download to an unplugged drive is refused, and the folder is never created.
- A drive is plugged in when `/Volumes/<name>` has a different device number from `/Volumes`.
- `addDriveLinks` writes `[4T-HDD: <file name>](file:///…)` at the top of the body. It checks only the body for an existing link.
- `watchDriveLabels` hides the `media` text with CSS and draws the label with `::before`. Never change the element's text: Media Extended opens a click only when the text is a URL.
- These are copied word for word in YT Playlists. Change both together: `driveOf`, `driveMounted`, `checkMediaExtended`, `addDriveLinks`, `externalVideoFolder`, `keepsVideosInVault`, `videoPlace`, `writeLibraryNote`, `renderPlaceChoice`.
- The link form has two more copies, `file_url` in `backup-strategy/move-videos-out.py` and `relink-videos.py`. Change all four or none.
- `writeLibraryNote` also matches `backup-strategy/link-subtitles.py`.
- The move queue (`queueDriveMove`, `moveVideoToDrive`) is here only. YT Playlists calls `queueDriveMove` by name, so a rename leaves its videos in the vault.
- Relink Videos on the Outside Drive only runs `backup-strategy/relink-videos.py`. Never copy that logic into the plugin.
- `watchDeletedDriveNotes` offers a deleted note's drive video, subtitles and library note. It never offers what another note still links.
- Never test subtitles by reading the player's text tracks. They stayed empty while subtitles showed. Look, or ask him to.
- `checkMediaExtended` logs the running version against `TESTED`, 4.2.7. If Media Extended changes version, test playback and the property click again.

### YouTube Notes From Chrome

- A Chrome extension takes timestamp notes on YouTube. A helper, `host.py`, writes them into the video's note on disk.
- The source is `youtube-notes/`. After editing it, run `node tools/embed-youtube-notes.js`. Never edit the block between the `YOUTUBE_NOTES_FILES` markers by hand.
- `node tools/embed-youtube-notes.js --check` exits 1 when `main.js` is behind.
- The `key` in its manifest fixes the extension id, `icepmkgljifnfffejmojdicdmnaokiei`. Changing it breaks the helper until Set Up runs again.
- The launcher names Python by a stable full path (`pythonForHelper`). The helper stays Python 3.9 compatible, for macOS's own `/usr/bin/python3`.
- The helper writes the file directly, so a line can land while the plugin works on the same note. The window is small, not zero.
- `watchYouTubeStamps` points timestamps at a `[[wikilink]]` video. Drive videos keep YouTube links until a 4T-HDD test shows Media Extended opens `[[<library note>#t=…]]`.
- A new note is clipped in the tab with Defuddle and his Web Clipper template. `defuddle.js` is the npm package's `dist/index.full.js`, unchanged.
- `clip()` uses the live page only when its `videoDetails.videoId` matches. YouTube changes videos without reloading the page.
- The note opens through `obsidian://arch-youtube-note`, never `obsidian://open`: this plugin renames a new clip the moment its vault opens.
- Test it in a headless Chrome with a throwaway profile, never his Chrome. Load the extension with the DevTools call `Extensions.loadUnpacked`; branded Chrome ignores `--load-extension`.
- YouTube's Trusted Types block Defuddle injected over DevTools. Test through the extension.

### One Computer Does the Automatic Work

- Syncthing mirrors the vaults to the PC, so anything automatic would run on both.
- Any new watcher, interval or startup sweep checks `this.automaticHere()`. Work he starts by hand does not.
- The delete popup follows him instead: only deletions made in this Obsidian (`watchLocalDeletions`).

### Releasing

- No build. A release ships the repo's `main.js` and `manifest.json` as assets: `gh release create <version> main.js manifest.json`. BRAT ignores the source zip.
- The tag equals `version` in `manifest.json`, with no `v`.
- Before a release: bump `manifest.json`, add a `CHANGELOG.md` entry and move its `— current` marker.
- The transformers are embedded in `main.js` as `BUNDLED_TRANSFORMERS`. Edit the `.py` file and that string together; nothing checks them.
- `ensureTransformers()` never overwrites a file on disk. Restore the Bundled Transformer Scripts forces it.
- An installed copy is a plain folder BRAT wrote. An edit here reaches no vault until a release.
- If it ever goes to the community store, the README must disclose network use and reading Chrome's cookies.
- Rewriting history means moving every tag too. The steps: `Details.md`, Rewriting History Means Repointing Every Tag.

### Testing

- When something fails, first run a command that reports what is there. Log lines have settled what theories could not.
- Before writing a method, check it does not exist. A later definition in a class silently wins.
- The console lap times are cumulative. A stage's cost is the difference between two lines.
- A clean mock test run is not evidence. The mock has missed five real Obsidian APIs.

## Mistakes and Lessons

- 1.9.0: ordering the whole note's frontmatter scrambled every article template on the first cover download.
- A first check for YT Playlists notes read only the cache and never fired once.
- Sep 24 to 25: `doImages` read image properties from the cache alone and saved nothing for 14 clips (fixed in 1.18.6).
- Sep 24: replacing the `media` element's text sent every click to the browser.
- The first `addDriveLinks` checked the whole note, found the address in the frontmatter and added nothing, ever.
- Video posters: seven attempts failed. The player has no `<video>` element to reach. The feature is gone.
- ARCH X Twitter's first run: every profile post was probed by yt-dlp, about 3 seconds each, and its video downloaded. Hence `x-author` and `x-name`.
- A duplicate `pruneSubtitles` in YT Playlists silently replaced the first. A doubled `embed-local-player` command here had the same cause.
- He and a session misread the cumulative lap times and blamed the image download for the rename's time.
- A history rewrite left tags on old commits, which kept the old author on GitHub for an afternoon.
- 1.22.0: the first test opened TESTFIELD but not the note, because the plugin had already renamed it.

## Where It Stands

- 1.22.3 is current (Oct 9). In `~/Documents` and 12 vaults through BRAT, checked Oct 9. `~/Documents` has 1.22.3, copied in to check the release.
- The other vaults run 1.22.0 to 1.22.2. BRAT updates each at its next startup.
- TESTFIELD has the symlink. Archive has no BRAT, so no copy.
- Media Extended 4.2.7 is the tested version (1.22.2). CHAOS, Psycho-history and iCanStudy still run 4.2.1.
- On 4.2.7 a 4T-HDD video, its property click and a drive timestamp wait for the drive to be plugged in.
- TESTFIELD's settings: Videos Outside the Vault is `/Volumes/4T-HDD/Media`, `automaticOn` is the MacBook, image labels `banner=Banner, icon=Icon`.
