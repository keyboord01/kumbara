#!/usr/bin/env python3
"""Export each rendered deck variant as a 16:9 PPTX: one full-bleed PNG per
slide (docs/deck/slides-<variant>/ from scripts/build-deck.mjs) with the
matching speaker notes (docs/deck/speaker-notes.md) in the notes pane.
Image-based: the slides are not editable text. Needs python-pptx:
    python3 -m venv .venv && .venv/bin/pip install python-pptx
    .venv/bin/python scripts/build-deck-pptx.py            # both variants
    VARIANT=hackathon .venv/bin/python scripts/build-deck-pptx.py
"""
import os
import re
import sys

try:
    from pptx import Presentation
    from pptx.util import Inches
except ImportError:  # pragma: no cover
    sys.exit("python-pptx is not installed: python3 -m venv .venv && .venv/bin/pip install python-pptx")

DECK = os.path.join(os.path.dirname(__file__), "..", "docs", "deck")
VARIANTS = [os.environ["VARIANT"]] if os.environ.get("VARIANT") else ["scf", "hackathon"]

NOTES = {"scf": "speaker-notes-scf.md", "hackathon": "speaker-notes.md"}
ORDER = {"scf": ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "A"], "hackathon": ["1", "2", "3", "3b", "4", "5", "6", "7"]}

def load_notes(name):
    """Notes are keyed by slide id: "## <id> · <title>"."""
    md = open(os.path.join(DECK, name), encoding="utf-8").read()
    blocks = {}
    for m in re.finditer(r"^## ([\w]+) · .*?$\n(.*?)(?=^## |\Z)", md, flags=re.M | re.S):
        blocks[m.group(1)] = re.sub(r"\*\*(TR|EN)\.\*\*", r"\1:", m.group(2)).strip()
    return blocks

for variant in VARIANTS:
    blocks = load_notes(NOTES[variant])
    slides_dir = os.path.join(DECK, f"slides-{variant}")
    pngs = sorted(f for f in os.listdir(slides_dir) if re.match(r"slide-\d+\.png$", f))
    if not pngs:
        sys.exit(f"no slide PNGs in {slides_dir}; run node scripts/build-deck.mjs first")
    ids = ORDER[variant]
    if len(ids) != len(pngs):
        sys.exit(f"{variant}: {len(pngs)} slides rendered but {len(ids)} notes ids expected")
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank = prs.slide_layouts[6]
    for png, sid in zip(pngs, ids):
        slide = prs.slides.add_slide(blank)
        slide.shapes.add_picture(os.path.join(slides_dir, png), 0, 0, width=prs.slide_width, height=prs.slide_height)
        slide.notes_slide.notes_text_frame.text = blocks.get(sid, "")
    out = os.path.join(DECK, f"kumbara-deck-{variant}.pptx")
    prs.save(out)
    print(f"{os.path.relpath(out)}: {len(pngs)} slides, {os.path.getsize(out) / 1_000_000:.1f} MB (image-based, notes attached)")
