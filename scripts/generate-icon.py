from PIL import Image, ImageDraw
from pathlib import Path
target = Path(__file__).resolve().parent.parent / 'assets'
target.mkdir(exist_ok=True)
im = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
d.rounded_rectangle((8, 8, 248, 248), radius=63, fill='#cfedaa')
for box in [(65, 128, 96, 189), (113, 67, 144, 189), (161, 98, 192, 189)]:
    d.rounded_rectangle(box, radius=11, fill='#34402a')
im.save(target / 'icon.png')
im.save(target / 'icon.ico', sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
