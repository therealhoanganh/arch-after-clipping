# Written by ARCH After Clipping. Edits here are overwritten when the plugin
# updates the helper; change youtube-notes/ in the plugin's repository.
#
# The helper Chrome starts for ARCH YouTube Notes. It writes the timestamp
# lines into the video's note on disk, so Obsidian does not need to be open,
# and it remembers which note belongs to which video (state.json beside it).
# Chrome talks to it in native messaging: a 4-byte length, then JSON.
import json
import os
import re
import struct
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(HERE, 'state.json')
HOME = os.path.expanduser('~')
OBSIDIAN_JSON = [
    os.path.join(HOME, 'Library', 'Application Support', 'obsidian', 'obsidian.json'),
    os.path.join(HOME, '.config', 'obsidian', 'obsidian.json'),
    os.path.join(HOME, 'snap', 'obsidian', 'current', '.config', 'obsidian', 'obsidian.json'),
    os.path.join(HOME, '.var', 'app', 'md.obsidian.Obsidian', 'config', 'obsidian', 'obsidian.json'),
]
SKIP_DIRS = {'.obsidian', '.trash', '.git', 'node_modules', '.stfolder', '.stversions'}
HEAD_BYTES = 3000
BAD_NAME = re.compile(r'[\\/:*?"<>|#^\[\]\x00-\x1f]')


def read_msg():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    n = struct.unpack('=I', raw)[0]
    return json.loads(sys.stdin.buffer.read(n).decode('utf-8'))


def send(obj):
    data = json.dumps(obj, ensure_ascii=False).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('=I', len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def load_state():
    try:
        with open(STATE, encoding='utf-8') as f:
            s = json.load(f)
    except (OSError, ValueError):
        s = {}
    s.setdefault('notes', {})
    s.setdefault('folders', {})
    s.setdefault('last', None)
    return s


def save_state(s):
    tmp = STATE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(s, f, ensure_ascii=False, indent=1)
    os.replace(tmp, STATE)


def vaults():
    """Every vault Obsidian knows on this computer that still exists, by name."""
    for p in OBSIDIAN_JSON:
        try:
            with open(p, encoding='utf-8') as f:
                data = json.load(f)
        except (OSError, ValueError):
            continue
        out = {}
        for v in (data.get('vaults') or {}).values():
            path = v.get('path')
            if path and os.path.isdir(path):
                out[os.path.basename(path.rstrip('/'))] = path
        return out
    return {}


def walk_notes(root):
    for d, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS and not x.startswith('.')]
        for f in files:
            if f.endswith('.md'):
                yield os.path.join(d, f)


def frontmatter(text):
    if not text.startswith('---'):
        return None
    end = text.find('\n---', 3)
    return text[3:end] if end > 0 else None


def note_is_for(path, vid):
    """True when the note's properties name this video (url, source or any key)."""
    try:
        with open(path, 'rb') as f:
            head = f.read(HEAD_BYTES).decode('utf-8', 'ignore')
    except OSError:
        return False
    fm = frontmatter(head)
    if not fm or vid not in fm:
        return False
    return re.search(r'(?:youtube\.com/(?:watch\?(?:[^\s)"]*&)?v=|shorts/|live/|embed/)|youtu\.be/)' + re.escape(vid) + r'(?![\w-])', fm) is not None


def find_note(vid, state, only=None):
    known = state['notes'].get(vid)
    vs = vaults()
    if known and known.get('vault') in vs:
        p = os.path.join(vs[known['vault']], known['path'])
        if os.path.isfile(p) and note_is_for(p, vid):
            return known['vault'], known['path']
    for name, root in vs.items():
        if only and name != only:
            continue
        for p in walk_notes(root):
            if note_is_for(p, vid):
                rel = os.path.relpath(p, root)
                state['notes'][vid] = {'vault': name, 'path': rel}
                return name, rel
    return None


def folders(root, depth=3):
    out = []
    base = len(root.rstrip('/').split(os.sep))
    for d, dirs, _ in os.walk(root):
        dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS and not x.startswith('.'))
        level = len(d.rstrip('/').split(os.sep)) - base
        if level >= depth:
            dirs[:] = []
        if level > 0:
            out.append(os.path.relpath(d, root))
    return out


def label(sec):
    h, rest = divmod(int(sec), 3600)
    m, s = divmod(rest, 60)
    return '%d:%02d:%02d' % (h, m, s) if h else '%d:%02d' % (m, s)


def stamp_re(vid):
    # a line holding a timestamp of this video, as written here or after the
    # plugin pointed it at the downloaded file
    return re.compile(r'^\s*- (?:\[\d[\d:]*\]\(https://youtu\.be/' + re.escape(vid) + r'\?t=(\d+)\)|\[\[[^\]|]*#t=(\d+)\|\d[\d:]*\]\])')


def insert_line(text, vid, sec, line):
    lines = text.split('\n')
    start = 0
    if lines and lines[0].strip() == '---':
        for i in range(1, len(lines)):
            if lines[i].strip() == '---':
                start = i + 1
                break
    rx = stamp_re(vid)
    stamps = []
    for i in range(start, len(lines)):
        m = rx.match(lines[i])
        if m:
            stamps.append((i, int(m.group(1) or m.group(2))))
    if stamps:
        # in time order among this video's lines
        after = [i for i, t in stamps if t <= sec]
        at = (after[-1] + 1) if after else stamps[0][0]
        lines[at:at] = [line]
        return '\n'.join(lines)
    # none yet: at the top of the body, after the embeds and drive links there
    i = start
    while i < len(lines) and (not lines[i].strip() or lines[i].startswith('![') or lines[i].startswith('[4T-HDD')):
        i += 1
    j = i
    while j > start and not lines[j - 1].strip():
        j -= 1
    block = ([''] if j > start else []) + [line] + ([''] if i < len(lines) else [])
    lines[j:i] = block
    out = '\n'.join(lines)
    return out if out.endswith('\n') else out + '\n'


def safe_name(title, vid):
    name = BAD_NAME.sub(' ', title or '').strip().strip('.')
    name = re.sub(r'\s+', ' ', name)[:150].strip()
    return name or ('YouTube ' + vid)


def create_note(root, folder, vid, title, url, markdown=None):
    """The note the extension clipped with his Web Clipper template, or, when
    that failed, a plain one that still carries the url."""
    folder = (folder or '').strip().strip('/')
    d = os.path.join(root, folder) if folder else root
    os.makedirs(d, exist_ok=True)
    name = safe_name(title, vid)
    p = os.path.join(d, name + '.md')
    if os.path.exists(p):
        p = os.path.join(d, '%s (%s).md' % (name, vid))
    if not markdown:
        markdown = '---\nurl: "[Link](%s)"\ncreated: %s\n---\n' % (url, time.strftime('%Y-%m-%dT%H:%M:%S'))
    with open(p, 'w', encoding='utf-8') as f:
        f.write(markdown)
    return os.path.relpath(p, root)


def add(msg, state):
    vid = msg['videoId']
    vs = vaults()
    vault, rel = msg.get('vault'), msg.get('path')
    made = False
    if not (vault and rel):
        # "create" comes after a search that found nothing, so none is repeated
        hit = None if msg.get('create') else find_note(vid, state)
        if hit:
            vault, rel = hit
        elif msg.get('create') and vault in vs:
            rel = create_note(vs[vault], msg.get('folder'), vid, msg.get('name') or msg.get('title'),
                              'https://www.youtube.com/watch?v=' + vid, msg.get('markdown'))
            made = True
            state['folders'][vault] = (msg.get('folder') or '').strip().strip('/')
        else:
            return {'need': 'place', 'vaults': sorted(vs), 'last': state['last'], 'folders': state['folders']}
    if vault not in vs:
        return {'error': 'The vault "%s" is not in Obsidian\'s vault list on this computer.' % vault}
    p = os.path.join(vs[vault], rel)
    sec = int(msg.get('seconds') or 0)
    text = re.sub(r'\s+', ' ', msg.get('text') or '').strip()
    line = '- [%s](https://youtu.be/%s?t=%d)%s' % (label(sec), vid, sec, (' ' + text) if text else '')
    with open(p, encoding='utf-8') as f:
        body = f.read()
    with open(p, 'w', encoding='utf-8') as f:
        f.write(insert_line(body, vid, sec, line))
    state['notes'][vid] = {'vault': vault, 'path': rel}
    state['last'] = vault
    return {'ok': True, 'vault': vault, 'note': os.path.splitext(os.path.basename(rel))[0], 'created': made, 'label': label(sec)}


def handle(msg, state):
    t = msg.get('type')
    if t == 'ping':
        return {'ok': True, 'python': sys.version.split()[0], 'vaults': len(vaults())}
    if t == 'find':
        hit = find_note(msg['videoId'], state)
        if hit:
            return {'found': True, 'vault': hit[0], 'path': hit[1], 'note': os.path.splitext(os.path.basename(hit[1]))[0]}
        return {'found': False, 'vaults': sorted(vaults()), 'last': state['last'], 'folders': state['folders']}
    if t == 'folders':
        root = vaults().get(msg.get('vault'))
        return {'folders': folders(root) if root else []}
    if t == 'add':
        return add(msg, state)
    return {'error': 'Unknown request: %s' % t}


def main():
    msg = read_msg()
    if msg is None:
        return
    state = load_state()
    try:
        res = handle(msg, state)
        save_state(state)
    except Exception as e:  # report, never die silently
        res = {'error': '%s: %s' % (type(e).__name__, e)}
    send(res)


if __name__ == '__main__':
    main()
