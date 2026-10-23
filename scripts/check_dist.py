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

DIST = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "dist")
errors, notes = [], []


def err(msg):
    errors.append(msg)


if not DIST.is_dir():
    sys.exit("找不到 %s，請先執行 scripts/build.py" % DIST)

# 1. 不該出現的檔案
for pat in ["admin", "server.py", "docs", "scripts", ".cms-tokens.json", "data/draft.json", "data/revisions", "data/audit.log", "README.md", ".github"]:
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
for css in DIST.rglob("*.css"):
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

# 4. 統計
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
