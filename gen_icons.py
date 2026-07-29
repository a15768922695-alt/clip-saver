from PIL import Image, ImageDraw

OUT = r"C:\Users\Administrator\WorkBuddy\2026-07-28-16-42-46\clip-saver"

def make_icon(size, path):
    # 渐变背景 (紫 #6c5ce7 -> #a29bfe)
    base = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = base.load()
    for y in range(size):
        t = y / size
        R = int(108 + (162 - 108) * t)
        G = int(92 + (155 - 92) * t)
        B = int(231 + (254 - 231) * t)
        for x in range(size):
            px[x, y] = (R, G, B, 255)
    # 圆角蒙版
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=255)
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    img.paste(base, (0, 0), mask)
    # 白色“+”符号
    d = ImageDraw.Draw(img)
    thick = max(6, int(size * 0.075))
    cx = cy = size // 2
    arm = int(size * 0.18)
    d.rectangle([cx - thick // 2, cy - arm, cx + thick // 2, cy + arm], fill=(255, 255, 255, 255))
    d.rectangle([cx - arm, cy - thick // 2, cx + arm, cy + thick // 2], fill=(255, 255, 255, 255))
    img.save(path)
    print("saved", path)

make_icon(192, f"{OUT}/icon-192.png")
make_icon(512, f"{OUT}/icon-512.png")
make_icon(180, f"{OUT}/icon-apple.png")
