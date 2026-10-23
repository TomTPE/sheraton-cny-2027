#!/usr/bin/env python3
"""建置可部署的前台靜態檔到 dist/。

- 只複製前台需要的檔案（index.html、assets/、data/content.json）。
- 不含 admin/、server.py、docs/、草稿、版本快照、權杖檔。
- 移除 content.json 內部欄位（verify 校稿備註、source 資料來源），避免公開內部確認事項。
- --env test   保留 noindex（測試環境，預設）
  --env prod   依 content.json 的 meta.noindex 決定；若仍為 true 會中止，避免正式站被設為不索引而不自知。
"""
import argparse
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INTERNAL_KEYS = {"verify", "source"}
COPY = ["index.html", "assets"]
SKIP_DIRS = {"uploads"}  # 上傳區由 CMS 管理，只複製被內容引用的檔案


def strip(node):
    if isinstance(node, dict):
        return {k: strip(v) for k, v in node.items() if k not in INTERNAL_KEYS}
    if isinstance(node, list):
        return [strip(v) for v in node]
    return node


def referenced_uploads(node, out):
    if isinstance(node, dict):
        for v in node.values():
            referenced_uploads(v, out)
    elif isinstance(node, list):
        for v in node:
            referenced_uploads(v, out)
    elif isinstance(node, str) and node.startswith("assets/uploads/"):
        out.add(node)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", choices=["test", "prod"], default="test")
    ap.add_argument("--out", default=str(ROOT / "dist"))
    args = ap.parse_args()

    data = json.loads((ROOT / "data" / "content.json").read_text(encoding="utf-8"))
    if args.env == "prod" and data["meta"].get("noindex", True):
        sys.exit("中止：正式環境建置，但 content.json 的 meta.noindex 仍為 true。請於 CMS 確認後改為 false。")

    out = Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    for name in COPY:
        src = ROOT / name
        if src.is_dir():
            shutil.copytree(src, out / name, ignore=lambda d, files: [f for f in files if f in SKIP_DIRS or f.startswith(".")])
        else:
            shutil.copy2(src, out / name)

    if args.env == "test":
        data["meta"]["noindex"] = True
    else:
        data["meta"]["stage"] = "published"

    ups = set()
    referenced_uploads(data, ups)
    for rel in sorted(ups):
        src = ROOT / rel
        if not src.is_file():
            sys.exit("中止：內容引用的圖片不存在：" + rel)
        (out / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, out / rel)

    (out / "data").mkdir()
    (out / "data" / "content.json").write_text(json.dumps(strip(data), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    if args.env == "prod":
        html = (out / "index.html").read_text(encoding="utf-8")
        html = html.replace('<meta name="robots" content="noindex, nofollow">', '<meta name="robots" content="index, follow">')
        (out / "index.html").write_text(html, encoding="utf-8")

    # GitHub Pages：不要用 Jekyll 處理
    (out / ".nojekyll").write_text("", encoding="utf-8")

    files = [p for p in out.rglob("*") if p.is_file()]
    size = sum(p.stat().st_size for p in files)
    print("建置完成：%s（%d 個檔案，%.1f MB，環境 %s，內容版本 rev %s）" % (out, len(files), size / 1e6, args.env, data["meta"]["revision"]))


if __name__ == "__main__":
    main()
