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

**The processed record is keyed on the source URL, not the note path**, so a
re-clip of the same page is skipped wherever it lands. It gates the **media step
only** — images and the transform re-run, because deleting a note and clipping it
again is the normal testing loop and it used to do nothing at all.

**Frontmatter image properties are a bare `[[file.jpg]]`, not an alias.** Not
because aliases fail: they render correctly in Pretty Properties, tested. The
reason is scope — this plugin clips any site, so no one label fits every property
it might rewrite. ARCH YT Playlists is YouTube-only and does use an alias.

**Video + Audio is one download.** `bestvideo*+bestaudio` already fetches and
merges the audio, so the mp3 is extracted from the merged file with ffmpeg rather
than fetched twice. Audio is staged in a temp folder first: writing it beside the
video under the same stem lands on the video file, which yt-dlp then deletes after
converting.

**Video posters do not work and the feature is gone.** Seven attempts. A media
plugin renders the player in an iframe with a shadow root, so there is no
`<video>` element to attach a poster to. Thumbnails are still downloaded and
recorded, which was the original requirement.

## Coupling to ARCH YT Playlists

Separate plugin, separate repo, no shared code or runtime state. One link exists:
notes carrying `yt-playlist` (video notes) or `dl-all` (playlist notes) belong to
that plugin, and the automatic pass here skips them. The property names live in
the `otherArchKeys` setting.

That check reads the **raw frontmatter as well as the metadata cache**. A note
written moments earlier is not in the cache yet, which is exactly when this runs —
a cache-only version of this check never fired once.

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

Still outstanding:

- No release exists yet. BRAT installs from release *assets*, not from the branch,
  so the tag must be exactly `1.5.0` — no `v` prefix — with `main.js` and
  `manifest.json` attached as assets rather than only present in the source zip.
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