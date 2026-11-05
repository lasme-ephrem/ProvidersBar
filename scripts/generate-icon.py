"""Construit assets/icon.ico à partir de assets/icon.png (marque Lasmium « L »).

icon.png est la source unique : fenêtre, zone de notification, et (via cet
.ico) l'exécutable, la barre des tâches, le menu Démarrer et l'installeur.
Usage : python scripts/generate-icon.py
"""
from pathlib import Path

from PIL import Image

ASSETS = Path(__file__).resolve().parent.parent / 'assets'
SIZES = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]

source = Image.open(ASSETS / 'icon.png').convert('RGBA')
if source.size[0] != source.size[1] or source.size[0] < 256:
    raise SystemExit(f'icon.png doit être carré et faire au moins 256 px (actuel : {source.size}).')
# Chaque taille est réduite depuis l'original (Lanczos) pour rester nette.
largest = source.resize((256, 256), Image.Resampling.LANCZOS)
largest.save(ASSETS / 'icon.ico', sizes=SIZES, append_images=[
    source.resize(size, Image.Resampling.LANCZOS) for size in SIZES[:-1]
])
print(f'icon.ico : {len(SIZES)} tailles depuis icon.png {source.size[0]} px')
