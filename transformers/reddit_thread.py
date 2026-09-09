#!/usr/bin/env python3
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
COMMENTS_HEADING = re.compile(r"^#{1,6}\s*Comments?\b.*$", re.MULTILINE | re.IGNORECASE)

# A comment header line. Handles:
#   **author** · 2 hours ago
#   **[u/author](https://...)** · 2 hours ago
#   **author** — 2 points
#   **author**
COMMENT_HEADER = re.compile(
    r"^\*\*\s*(?:\[)?(?:u/)?(?P<author>[^\]\*]+?)(?:\])?(?:\([^)]*\))?\s*\*\*"
    r"(?:\s*[·•∙|:—–-]\s*(?P<meta>.*))?$"
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
    return depth, line[idx:].rstrip("\r\n")


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

    for line in comments_part.split("\n"):
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
    for line in op_part.strip().split("\n"):
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
    return "\n".join(out).rstrip() + "\n"


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
