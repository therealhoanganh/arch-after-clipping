#!/usr/bin/env python3
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
            r"\*\*(You|Gemini)\*\*(.*?)(?=\*\*(?:You|Gemini)\*\*|\Z)",
            re.DOTALL,
        ),
        "**You** / **Gemini**",
    ),
    (
        re.compile(
            r"\*\*(You|Gemini)\s+said:?\*\*(.*?)(?=\*\*(?:You|Gemini)\s+said:?\*\*|\Z)",
            re.DOTALL,
        ),
        "**You said:** / **Gemini said:**",
    ),
    (
        re.compile(
            r"^#{1,6}\s+(You|Gemini)\s*:?\s*$(.*?)(?=^#{1,6}\s+(?:You|Gemini)\s*:?\s*$|\Z)",
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
    for line in text.split("\n"):
        lines.append(f"> {line}" if line.strip() else ">")
    return "\n".join(lines)


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
                pairs[-1] = (prompt, answer + "\n\n" + body)
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
        block = f"#### Prompt {i}\n\n"
        block += quote_block(CALLOUT_PROMPT, prompt)
        block += "\n\n"
        block += quote_block(CALLOUT_ANSWER, answer)
        blocks.append(block)

    print(f"built {len(blocks)} prompt/answer pair(s)", file=sys.stderr)
    return "\n\n---\n\n".join(blocks) + "\n"


def main():
    raw = sys.stdin.read()
    if not raw.strip():
        print("empty input", file=sys.stderr)
        return 1
    sys.stdout.write(transform(raw))
    return 0


if __name__ == "__main__":
    sys.exit(main())
