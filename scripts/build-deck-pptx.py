#!/usr/bin/env python3
"""Export the rendered deck as a 16:9 PPTX: one full-bleed PNG per slide
(docs/deck/slides/slide-NN.png from scripts/build-deck.mjs) with the speaker
notes (docs/deck/speaker-notes.md) in each slide's notes pane. Image-based:
the slides are not editable text. Needs python-pptx:
    python3 -m venv .venv && .venv/bin/pip install python-pptx
    .venv/bin/python scripts/build-deck-pptx.py
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
SLIDES = sorted(f for f in os.listdir(os.path.join(DECK, "slides")) if re.match(r"slide-\d+\.png$", f))
if not SLIDES:
    sys.exit("no slide PNGs; run node scripts/build-deck.mjs first")

notes_md = open(os.path.join(DECK, "speaker-notes.md"), encoding="utf-8").read()
notes = re.split(r"^## \d+ · .*$", notes_md, flags=re.M)[1:]  # one block per slide, TR then EN

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)
blank = prs.slide_layouts[6]
for i, png in enumerate(SLIDES):
    slide = prs.slides.add_slide(blank)
    slide.shapes.add_picture(os.path.join(DECK, "slides", png), 0, 0, width=prs.slide_width, height=prs.slide_height)
    if i < len(notes):
        text = re.sub(r"\*\*(TR|EN)\.\*\*", r"\1:", notes[i]).strip()
        slide.notes_slide.notes_text_frame.text = text

out = os.path.join(DECK, "kumbara-deck.pptx")
prs.save(out)
print(f"{out}: {len(SLIDES)} slides, {os.path.getsize(out) / 1_000_000:.1f} MB (image-based, notes attached)")
