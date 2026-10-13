"""Regenerate PDF fonts using fonttools[woff] 4.66.1.

Fontkit cannot reliably subset transformed WOFF2 composite glyphs. Keep web
fonts unchanged and decode their original outlines into SFNT for PDF embedding.
"""
from pathlib import Path
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parent.parent
destination = root / "assets/pdf-fonts"
destination.mkdir(parents=True, exist_ok=True)
for source in sorted([
    *(root / "app/fonts").glob("*.woff2"),
    *(root / "app/admin/(tool)/engine/typefaces/google").glob("*.woff2"),
]):
    font = TTFont(source, recalcTimestamp=False)
    font.flavor = None
    font.save(destination / (source.stem + ".ttf"))
    font.close()
