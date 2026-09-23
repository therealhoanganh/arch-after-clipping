# ARCH After Clipping — working notes

An Obsidian plugin that finishes what Web Clipper starts: saves a clip's images
into the vault, repoints its links and image properties at them, runs a Python
transformer over the body, and downloads video or audio with yt-dlp.

Read `CHANGELOG.md` before changing behaviour. It is the reliable record of why
things are the way they are, and it is kept current.

## Environment

macOS Intel (`darwin x64`), Obsidian 1.13.4. Desktop only — the plugin spawns
subprocesses.

- yt-dlp standalone, installed by the plugin into `.obsidian/arch-tools/`
- ffmpeg at `/usr/local/bin`
- node at `/usr/local/bin/node`, but first-run detection currently picks
  `deno:/usr/local/bin/deno` as the JS runtime. Both work.
- Python 3 for the transformers
- Cookies read from Chrome
- Media Extended 4.2.1, closed source, pinned deliberately. It throws a
  `TypeError` on every startup that is **not ours**.

## Things that cost hours to learn

**Two flags YouTube needs, both easy to miss.** `--remote-components ejs:github`
lets yt-dlp fetch the challenge solver, whose fetch is off by default; without it
downloads fail with "The page needs to be reloaded". And `--js-runtime` must name
the runtime by **full path**, because the PATH an Electron app inherits is far
shorter than a terminal's, so a runtime the plugin can see may be invisible to
yt-dlp.

**Media host entries accept a regex when wrapped in slashes.** This is the least
obvious setting in the plugin and the highest-value one. A bare `x.com` matches
every URL on the domain including profile pages with no media, and each one costs
a full yt-dlp round trip — measured at 7 to 10 seconds — to discover there is
nothing there. The defaults now use `/(?:twitter|x)\.com\/[^\/]+\/status\//` and
`/instagram\.com\/(?:p|reel|tv)\//`. If a host feels slow, look for
`metadata done` followed by `no downloadable media`: that pairing means the
pattern is too broad.

**The lap times in the console are cumulative.** A stage's cost is the difference
between two lines. Both the author and a previous session misread this and blamed
the image download for time spent in the rename ahead of it.

**Nothing deletes a note, and that is deliberate.** Duplicate-trashing was removed
outright, not made safer. Its stated reason was that a second clip downloads the
video twice, and the processed-URL record already prevents that. A duplicate note
is visible and easy to delete by hand; duplicate media is not, and that is handled
by image hashing and the record. Do not reintroduce it.

**The create listener is registered after layout-ready, and that alone misses
the clip that launched Obsidian.** Web Clipper saving to a closed vault starts
Obsidian and writes the note during startup, before any listener registered in
`onLayoutReady` exists. `catchUpStartupClips` runs right after the listener is
registered and sweeps for notes younger than `graceSeconds` that carry a source
URL. Do not "simplify" by registering the listener earlier — that brings back
the startup popup storm the deferral was added to fix.

**The processed record is keyed on the source URL, not the note path**, so a
re-clip of the same page is skipped wherever it lands. It gates the **media step
only** — images and the transform re-run, because deleting a note and clipping it
again is the normal testing loop and it used to do nothing at all.

**Frontmatter image properties are a bare `[[file.jpg]]` unless the property
has a label in `frontmatterImageLabels`**, then `[[file.jpg|Label]]`. Aliases
render correctly in Pretty Properties, tested. The alias form was absent for a
while because this plugin clips any site, so no *one* label fits every property
it might rewrite; a label chosen per property (`banner=Banner, icon=Icon`) is
what answers that. The default is empty, so nothing changes until it is set.
A label the template itself put on the value — `[Thumbnail](url)` on a video
clip — wins over the setting, because the template author knew what the picture
is and the setting cannot; the setting fills in for bare addresses and `![](url)`.
ARCH YT Playlists is YouTube-only and hardcodes its alias.

**Video + Audio is one download.** `bestvideo*+bestaudio` already fetches and
merges the audio, so the mp3 is extracted from the merged file with ffmpeg rather
than fetched twice. Audio is staged in a temp folder first: writing it beside the
video under the same stem lands on the video file, which yt-dlp then deletes after
converting.

**Video posters do not work and the feature is gone.** Seven attempts. A media
plugin renders the player in an iframe with a shadow root, so there is no
`<video>` element to attach a poster to. Thumbnails are still downloaded and
recorded, which was the original requirement.

## Property order

`setFrontmatter` is the only frontmatter writer, and it applies `frontmatterOrder`
after every mutation — **to the keys that mutation added, and to nothing else.**
An added key goes after the nearest listed key above it that the note has, else
before the nearest listed key below it, else at the end. Keys the note already
had are never moved. 1.9.0 ordered the whole note, and since the list is a video
note's shape and this plugin clips every kind of page, that scrambled every
article template on the first cover download. The default is the ARCH video
note template and is deliberately the same string as YT Playlists'
`videoNoteOrder`, so `media` and `dl-ed` land in the same place whichever plugin
downloaded a video's media.

## Coupling to ARCH YT Playlists

Separate plugin, separate repo, no shared code. Two links exist. **The second, since
1.11.0, is a runtime call**: the four *Download … for this note* commands go through
`downloadForNote`, which hands a video note (`yt-playlist`) to
`app.plugins.getPlugin('arch-yt-playlists').bulkDownload([file], mode)` and a
playlist note (`dl-all`) to its `downloadWholePlaylist(file, mode)`, so a playlist's
media stays in that plugin's folder. The division is his: single notes are this
plugin's, playlist notes are YT Playlists' ("we already have after clipping for
individual video/note"). **Renaming either method, or the mode strings
(`video_and_audio`, `video_only`, `audio_only`, `subs_only`), breaks the handoff**:
a video note then quietly falls back to this plugin's own download, in the wrong
folder. The first link:
notes carrying `yt-playlist` (video notes) or `dl-all` (playlist notes) belong to
that plugin, and the automatic pass here skips them. The property names live in
the `otherArchKeys` setting.

Channel notes from that plugin carry **no marker property** — their frontmatter
is `url`, `icon`, `banner`, `tags` and nothing else, by design — so they are
recognised by tag instead: `otherArchTags`, default `yt-channel`. A channel note's
`url` is a channel address, and yt-dlp given a channel address downloads the
channel. That is the failure this guards against.

Both checks read the **raw frontmatter as well as the metadata cache**. A note
written moments earlier is not in the cache yet, which is exactly when this runs —
a cache-only version of this check never fired once.

## Videos outside the vault, and the coupling to Media Extended

**Since 1.13.0, a video can live on another drive** (setting *Videos outside the
vault*, e.g. `/Volumes/4T-HDD/Media`). The video goes under
`<that folder>/<vault name>/<the folder it would have had in the vault>`, so the
drive mirrors the vault. The one-off move script in `~/Documents/backup-strategy/`
uses the same mapping, and the two must agree. Subtitles and audio stay in the vault
(a `subtitle:` output template). `media` is a bare `file:///…` URL, from Node's
`pathToFileURL`. The plan and the reasons are in
`~/Documents/backup-strategy/Videos Outside the Vault.md`.

**A `file:///` video on a drive that is not plugged in counts as downloaded** (in YT Playlists' `mediaOnDisk`, which decides for every playlist note, including ones handed over from here).
Do not "simplify" this to an existence check. Unplugged is not gone, and treating it
as gone downloads a whole playlist again into the vault. A download to an unplugged
drive is refused, and the folder is never created. A drive is plugged in when
`/Volumes/<name>` has a different device number from `/Volumes`, because an empty
folder of that name can sit on the Mac's own disk.

**Playback depends on Media Extended, tested on 4.2.1 only.** Hoang Anh keeps 4.2.1 on
purpose (*"4.2.5 were bugged from my experience using it"*), frozen through BRAT in
every vault. What is relied on:
- Its media-note schema reads `video`, `audio` or `media` from the frontmatter as a
  string: a `[[wikilink]]` resolves to a vault file, anything else is parsed as a URL.
- A bare `file:///` URL there opens in its own player window.
- A markdown `[Video](file:///…)` link parses as neither, and opened in the web browser.

**A readable body link goes with it** (`addDriveLinks`, since YT Playlists 1.7.1 and
After Clipping 1.13.1): `[4T-HDD: <file name>](file:///…)` at the top of the body,
because `media` must stay a bare URL and reads as a long `%`-encoded address. Check
only the body for an existing link: the frontmatter always holds the address, and
checking the whole note made the first version add nothing, ever. Its `(` `)` are
encoded, unlike `media`'s. `relink-videos.py` keeps the label in step with a rename.

**The readable `media` label is After Clipping's alone** (`watchDriveLabels`, 1.14.0):
CSS hides the text and a `::before` draws "4T-HDD: <file name>". Never change the
element's text: Media Extended opens a property click only if the clicked element's
`textContent` is a URL, and replacing it sent every click to the browser.

**The drive helpers are copied word for word in both plugins; change both together.**
`driveOf`, `driveMounted`, `checkMediaExtended` and `addDriveLinks`, and the way the outside folder is
worked out (`externalVideoFolder`: `<setting>/<vault name>/<the vault-relative media
folder>`), are the same in ARCH YT Playlists and ARCH After Clipping, because the two
share no code by design. A fix made in one only is how the two would start disagreeing:
one refusing an unplugged drive the other writes into, or one putting a video where the
other doesn't look. The link form has two more copies in `~/Documents/backup-strategy/`:
`file_url` in `move-videos-out.py` and `relink-videos.py` reproduces Node's
`pathToFileURL` (checked against Node on all 296 moved videos). Change the link form in
all four places, or not at all.

`checkMediaExtended()` logs the running version on load when the setting is set. If
Media Extended ever changes version, retest both points before trusting it. Only
playback depends on it: the "already downloaded?" check reads the disk.

## Before publishing

The author placeholders are filled in: `manifest.json` and `LICENSE` carry
`Hoang Anh`, and the manifest's `authorUrl` points at `therealhoanganh`. The repo
is public at `therealhoanganh/arch-after-clipping`.

Distribution delivers only `main.js`, `manifest.json` and `styles.css`, so the
`transformers/*.py` files would not arrive on their own. As of 1.5.0 they are
embedded in `main.js` as `BUNDLED_TRANSFORMERS` and written to disk by
`ensureTransformers()` on load, which never overwrites a file that already exists
— the **Restore the bundled transformer scripts** command is the way to force it.

**The embedded copies and the `.py` files in `transformers/` are kept in sync by
hand, and nothing checks them.** Edit the `.py` file and the string in `main.js`
together, or the repository and every installed vault quietly disagree about what
a transformer does. There is no build step in this project to catch it.

Releases are cut with `gh release create <version> main.js manifest.json`. BRAT
installs from release **assets**, not from the branch, so both files have to be
attached — being present in the auto-generated source zip is not enough, and that
is the usual way a first Obsidian release silently fails. The tag must equal the
`version` in `manifest.json` exactly, with no `v` prefix. `1.5.0` is the first
public release; bump `manifest.json`, add a `CHANGELOG.md` entry and move the
`— current` marker before cutting the next one.

**Distribution is BRAT, and it is installed in every vault under ~/Downloads that has BRAT except TESTFIELD, which is symlinked to this repo, and in ~/Documents.**
An installed plugin folder is an ordinary directory BRAT wrote, not a symlink back
to this repo, so an edit here reaches no vault until a release is cut. Versions
have drifted: as of 1.7.0 the vaults under `~/Downloads` carry 1.4.0, 1.6.0 and —
in two of them — **5.2.0**, a leftover from the numbering used before the
renumbering this changelog describes. Obsidian and BRAT compare version strings, so
`5.2.0` is newer than anything this repo will ship: those two will never be offered
a 1.x update and have to be removed and reinstalled to move across. Check what a
vault actually reports before assuming a release reached it. Checked 2026-09-23: the
ten BRAT vaults under `~/Downloads` and `~/Documents` all report 1.9.3, so the two
5.2.0 installs have since been replaced.

**A changed default only reaches a vault that has no `data.json`.** Settings load as
`Object.assign({}, DEFAULT_SETTINGS, saved)`, so any value the user has ever saved
wins over a new default — including one they never deliberately chose, because the
settings tab saves on every keystroke. Changing `DEFAULT_SETTINGS` is therefore a
change for fresh installs; an existing vault needs the setting changed in the UI.

Still outstanding:

- Network use and reading Chrome's cookie store must be disclosed in the README if
  this ever goes to the community store.

## Working style that helps

Console logs settle far more than reasoning does. Several rounds have been lost to
plausible theories that a single log line disproved. When something does not work,
the first move is a command that reports what is actually there.

Two specific traps, both of which have already caused bugs:

- **Check whether a method already exists before writing one.** A duplicate
  `pruneSubtitles` was once added to the sibling plugin and silently shadowed the
  existing one, because a later definition in a class wins. The same class of bug
  produced a doubled `embed-local-player` command here.
- **A clean test run is not evidence.** The mock has now missed five real Obsidian
  APIs: `_children`, `register`, `registerMarkdownPostProcessor`, `Modal.open`, and
  `registerEvent`. It catches logic bugs and nothing else.

## Coupling to ARCH X Twitter

ARCH X Twitter (ARCH X Archive when this was written; its plugin id changed from
`arch-x-archive` to `arch-x-twitter`) writes hundreds of notes carrying a `url` that points at
`x.com/<user>/status/<id>`, which is exactly the shape this plugin exists to
process. On its first run it took every one of them, ran a full yt-dlp metadata
probe — about **three seconds per note** — and downloaded a video and an mp3 into
the profile's folder. At that plugin's intended scale, a few hundred profiles,
that is tens of thousands of probes nobody asked for.

`otherArchKeys` now defaults to `['yt-playlist', 'dl-all', 'x-author', 'x-name']`.
`x-author` and `x-name` are on **both** of ARCH X Twitter's note types, which is
why two keys are enough there. Since then a profile note carries only `x-name`, which is
enough, because `otherArchKeys` matches any one of its names.

A saved `otherArchKeys` shadows the default entirely, so `loadSettings` appends
any missing default markers to a saved list rather than replacing it — a vault
configured before ARCH X Twitter existed would otherwise keep probing. A key the
user added by hand survives that.

## Rewriting history means repointing every tag

If commits are ever rewritten — an author correction, stripping a trailer —
moving `main` is not enough. **A tag is a reference**, so any tag left on an old
commit keeps that commit alive on GitHub, and it keeps whatever was wrong with it
alive too: the old author, the old trailer, the contributor entry derived from
them. This has already caused an afternoon of confusion, where `main` was clean
and the contributors list was not.

The steps, in order:

1. Note which commit each tag points at **before** rewriting, by commit subject —
   the SHAs are about to change.
2. Rewrite, e.g. `git rebase --root --exec '<amend script>'`.
3. Move every local tag onto its new equivalent: `git tag -f <tag> <new sha>`.
4. `git push --force-with-lease origin main`.
5. Repoint each remote tag:
   `gh api --method PATCH repos/<owner>/<repo>/git/refs/tags/<tag> -f sha=<new> -F force=true`
6. Verify no ref is orphaned:
   `gh api repos/<owner>/<repo>/git/refs --jq '.[] | "\(.ref) \(.object.sha)"'`
   — every one should be an ancestor of `main`.

Release assets survive a tag move; they are attached to the release, not the
commit. GitHub's contributors widget is cached separately and lags behind all of
this, so check `git/refs` rather than the web page to know whether the work is
actually done.
