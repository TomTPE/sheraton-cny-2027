#!/usr/bin/env python3
"""檢查 dist/ 建置產物是否可安全部署。

- 不含後台、伺服器、文件、權杖、草稿等檔案
- content.json 已移除 verify／source 內部欄位
- 測試環境 noindex 為 true
- index.html、CSS、content.json 引用的本機檔案都存在
- 所有 CTA 的電話與網址格式正確
失敗時回傳非 0，可用於 CI。
"""
import json
import re
import sys
from pathlib import Path

ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
DIST = Path(ARGS[0] if ARGS else Path(__file__).resolve().parent.parent / "dist")
errors, notes = [], []


def err(msg):
    errors.append(msg)


if not DIST.is_dir():
    sys.exit("找不到 %s，請先執行 scripts/build.py" % DIST)

# 1. 不該出現的檔案
ALLOW_ADMIN = "--allow-admin" in sys.argv
if ALLOW_ADMIN:
    cfg = (DIST / "admin" / "cms-config.js")
    if not cfg.is_file() or not re.search(r'"backend": "(github|worker)"', cfg.read_text(encoding="utf-8")):
        err("雲端後台缺少後端設定 admin/cms-config.js")
    if 'http-equiv="Content-Security-Policy"' not in (DIST / "admin" / "index.html").read_text(encoding="utf-8"):
        err("雲端後台 index.html 缺少 Content-Security-Policy")
for pat in (["admin"] if not ALLOW_ADMIN else []) + ["server.py", "docs", "scripts", ".cms-tokens.json", "data/draft.json", "data/revisions", "data/audit.log", "README.md", ".github"]:
    if (DIST / pat).exists():
        err("不應部署的檔案：" + pat)

# 2. content.json
data = json.loads((DIST / "data/content.json").read_text(encoding="utf-8"))
raw = json.dumps(data, ensure_ascii=False)
for key in ("verify", "source"):
    if '"%s"' % key in raw:
        err("content.json 仍含內部欄位：" + key)
if data["meta"].get("stage") != "published" and not data["meta"].get("noindex"):
    err("測試環境 meta.noindex 應為 true")

# 3. 引用檔案
refs = set()
html = (DIST / "index.html").read_text(encoding="utf-8")
refs.update(re.findall(r'(?:src|href)="((?:assets|data)/[^"#?]+)"', html))
for css in (DIST / "assets").rglob("*.css"):
    for u in re.findall(r'url\("?([^")]+)"?\)', css.read_text(encoding="utf-8")):
        if u.startswith("data:") or u.startswith("http"):
            continue
        refs.add(str((css.parent / u).resolve().relative_to(DIST.resolve())))


def walk(n, path=""):
    if isinstance(n, dict):
        for k, v in n.items():
            walk(v, path + "." + k)
    elif isinstance(n, list):
        for i, v in enumerate(n):
            walk(v, "%s[%d]" % (path, i))
    elif isinstance(n, str):
        if n.startswith("assets/"):
            refs.add(n)
        if path.endswith(".tel") or path.endswith("Tel"):
            if n and not re.fullmatch(r"\+886\d{8,9}", n):
                err("電話格式錯誤 %s：%s" % (path, n))
        if path.endswith(".url") and n and not n.startswith("https://"):
            err("網址需為 https %s：%s" % (path, n))


walk(data)
for r in sorted(refs):
    if not (DIST / r).is_file():
        err("引用的檔案不存在：" + r)

# 4. 色票一致：CSS 與 SVG 只能使用 brand.approvedPalette 的顏色（rgba 需為色盤顏色加透明度）
palette = {c["hex"].upper() for c in data["brand"]["approvedPalette"]}
rgb_ok = {tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) for h in palette}
def expand(h):
    h = h.upper()
    return "#" + "".join(ch * 2 for ch in h[1:]) if len(h) == 4 else h
color_files = list((DIST / "assets").rglob("*.css")) + list((DIST / "assets").rglob("*.svg"))  # 後台介面不受前台色票限制
off = {}
for f in color_files:
    txt = re.sub(r"/\*.*?\*/", "", f.read_text(encoding="utf-8"), flags=re.S)
    for h in re.findall(r"#(?:[0-9A-Fa-f]{8}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{3})\b", txt):
        base6 = h[:7] if len(h) in (7, 9) else expand(h[:4])
        if base6.upper() not in palette:
            off.setdefault(str(f.relative_to(DIST)), set()).add(h)
    for bad in re.findall(r"hsla?\(|rgba?\(\s*\d+\s+\d+", txt):
        off.setdefault(str(f.relative_to(DIST)), set()).add("請改用 #RRGGBB 或 rgba(r, g, b, a)：" + bad)
    for r, g, b in re.findall(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)", txt):
        if (int(r), int(g), int(b)) not in rgb_ok:
            off.setdefault(str(f.relative_to(DIST)), set()).add("rgb(%s,%s,%s)" % (r, g, b))
for f, cs in off.items():
    err("色盤外的顏色 %s：%s" % (f, "、".join(sorted(cs))))
notes.append("色票檢查：%d 個檔案，核准色盤 %d 色" % (len(color_files), len(palette)))

# 5. SEO：robots、sitemap、canonical 與結構化資料
html_all = (DIST / "index.html").read_text(encoding="utf-8")
robots = (DIST / "robots.txt").read_text(encoding="utf-8") if (DIST / "robots.txt").is_file() else None
if robots is None:
    err("缺少 robots.txt")
elif data["meta"].get("noindex") and "Disallow: /\n" not in robots + "\n":
    err("noindex 為 true，但 robots.txt 沒有 Disallow: /")
elif not data["meta"].get("noindex") and re.search(r"^Disallow: /\s*$", robots, flags=re.M):
    err("正式環境 robots.txt 仍禁止全站索引")
if 'property="og:title"' not in html_all:
    err("index.html 缺少 Open Graph（SEO:start／SEO:end 標記可能遺失）")
if data["meta"].get("noindex") and "noindex" not in html_all:
    err("noindex 為 true，但 index.html 沒有 noindex")
for ld in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html_all, flags=re.S):
    try:
        json.loads(ld)
    except ValueError as e:
        err("結構化資料 JSON 格式錯誤：%s" % e)
notes.append("SEO：結構化資料 %d 段、canonical %s" % (len(re.findall(r'application/ld\+json', html_all)), "有" if 'rel="canonical"' in html_all else "無"))

# 6. 統計
ctas = sum(len(i.get("ctas", [])) for sec in ("takeaway", "gifts", "events") for i in data[sec]["items"])
size = sum(p.stat().st_size for p in DIST.rglob("*") if p.is_file())
notes.append("引用檔案 %d 個、商品與活動 CTA %d 個、總大小 %.1f MB" % (len(refs), ctas, size / 1e6))

for n in notes:
    print("．" + n)
if errors:
    print("檢查失敗 %d 項：" % len(errors))
    for e in errors:
        print("  ✗ " + e)
    sys.exit(1)
print("檢查通過：%s（內容版本 rev %s，noindex=%s）" % (DIST, data["meta"]["revision"], data["meta"]["noindex"]))
