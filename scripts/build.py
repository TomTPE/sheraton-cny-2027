#!/usr/bin/env python3
"""建置可部署的前台靜態檔到 dist/。

- 只複製前台需要的檔案（index.html、assets/、data/content.json）。
- 不含 admin/、server.py、docs/、草稿、版本快照、權杖檔。
- 移除 content.json 內部欄位（verify 校稿備註、source 資料來源），避免公開內部確認事項。
- --env test   保留 noindex（測試環境，預設）
  --env prod   依 content.json 的 meta.noindex 決定；若仍為 true 會中止，避免正式站被設為不索引而不自知。
"""
import argparse
import html as H
import json
import re
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


def esc(v):
    return H.escape(str(v), quote=True)


def absurl(base, path):
    if not path:
        return ""
    if path.startswith("https://"):
        return path
    return base.rstrip("/") + "/" + path.lstrip("/")


def jsonld(obj):
    # 避免 </script> 斷開
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


def seo_head(d):
    seo, meta, c = d.get("seo", {}), d["meta"], d["contacts"]
    base = seo.get("siteUrl", "")
    title = seo.get("title") or meta.get("title", "")
    desc = seo.get("description") or meta.get("description", "")
    robots = "noindex, nofollow" if meta.get("noindex", True) else "index, follow, max-image-preview:large"
    img = absurl(base, seo.get("ogImage", ""))
    out = [
        "<title>%s</title>" % esc(title),
        '<meta name="description" content="%s">' % esc(desc),
        '<meta name="robots" content="%s">' % robots,
    ]
    if seo.get("keywords"):
        out.append('<meta name="keywords" content="%s">' % esc("、".join(seo["keywords"])))
    if base:
        out.append('<link rel="canonical" href="%s">' % esc(base))
    if seo.get("googleSiteVerification"):
        out.append('<meta name="google-site-verification" content="%s">' % esc(seo["googleSiteVerification"]))
    og = [("og:type", "website"), ("og:site_name", seo.get("siteName", "")), ("og:locale", seo.get("locale", "zh_TW")),
          ("og:title", title), ("og:description", desc), ("og:url", base), ("og:image", img), ("og:image:alt", seo.get("ogImageAlt", ""))]
    out += ['<meta property="%s" content="%s">' % (k, esc(v)) for k, v in og if v]
    out += ['<meta name="twitter:card" content="summary_large_image">', '<meta name="twitter:title" content="%s">' % esc(title),
            '<meta name="twitter:description" content="%s">' % esc(desc)]
    if img:
        out.append('<meta name="twitter:image" content="%s">' % esc(img))
    if seo.get("structuredData", True):
        for obj in structured(d, base):
            out.append('<script type="application/ld+json">%s</script>' % jsonld(obj))
    return "\n".join(out)


def structured(d, base):
    c = d["contacts"]
    hotel_id = "https://www.sheratongrandtaipei.com/#hotel"
    addr = {"@type": "PostalAddress", "streetAddress": "忠孝東路一段12號", "addressLocality": "中正區", "addressRegion": "台北市", "postalCode": "100", "addressCountry": "TW"}
    rest = [r for r in d["dining"].get("restaurants", []) if r.get("id") != "lounge" or d["dining"].get("showLounge")]
    hotel = {"@context": "https://schema.org", "@type": "Hotel", "@id": hotel_id, "name": "台北喜來登大飯店 Sheraton Grand Taipei Hotel",
             "url": "https://www.sheratongrandtaipei.com/", "telephone": c["main"]["tel"], "email": c.get("email"), "address": addr,
             "image": absurl(base, d.get("seo", {}).get("ogImage", "")),
             "containsPlace": [{"@type": "Restaurant", "name": r["name"] + (" " + r["nameEn"] if r.get("nameEn") else ""), "servesCuisine": r.get("type"),
                                "telephone": r.get("tel"), "url": r.get("page"), "image": absurl(base, r.get("image", "")),
                                "acceptsReservations": r.get("booking", {}).get("url", "True"), "address": addr} for r in rest]}
    page = {"@context": "https://schema.org", "@type": "WebPage", "name": d.get("seo", {}).get("title") or d["meta"]["title"],
            "description": d.get("seo", {}).get("description") or d["meta"]["description"], "url": base, "inLanguage": "zh-Hant-TW",
            "about": {"@id": hotel_id}}
    items = []
    for t in d["takeaway"]["items"]:
        if t.get("status") == "onsale" and t.get("price"):
            items.append({"@type": "Product", "name": t["name"], "description": t.get("desc"), "image": absurl(base, t.get("image", "")),
                          "brand": {"@type": "Brand", "name": "台北喜來登大飯店"},
                          "offers": {"@type": "Offer", "price": t["price"], "priceCurrency": "TWD", "availability": "https://schema.org/InStock", "url": base + "#takeaway"}})
    for g in d["gifts"]["items"]:
        if g.get("status") == "onsale" and g.get("price"):
            buy = next((x.get("url") for x in g.get("ctas", []) if x.get("type") == "buy"), base + "#gifts")
            items.append({"@type": "Product", "name": g["name"], "image": absurl(base, g.get("image", "")), "brand": {"@type": "Brand", "name": "台北喜來登大飯店"},
                          "offers": {"@type": "Offer", "price": g["price"], "priceCurrency": "TWD", "availability": "https://schema.org/InStock", "url": buy}})
    out = [hotel, page]
    if items:
        out.append({"@context": "https://schema.org", "@type": "ItemList", "name": "2027 新春年菜與伴手禮",
                    "itemListElement": [{"@type": "ListItem", "position": i + 1, "item": it} for i, it in enumerate(items)]})
    faq = [f for f in d["faq"].get("items", []) if f.get("q") and f.get("a") and f.get("status") != "hidden"]
    if faq:
        out.append({"@context": "https://schema.org", "@type": "FAQPage",
                    "mainEntity": [{"@type": "Question", "name": f["q"], "acceptedAnswer": {"@type": "Answer", "text": f["a"]}} for f in faq]})
    return out


def write_crawl_files(out, d):
    base = d.get("seo", {}).get("siteUrl", "")
    lines = ["User-agent: *"]
    if d["meta"].get("noindex", True):
        lines.append("Disallow: /")
    else:
        lines += ["Allow: /", "Disallow: /admin/"]
        if base:
            lines.append("Sitemap: " + absurl(base, "sitemap.xml"))
    (out / "robots.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    if base:
        sm = ('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
              "<url><loc>%s</loc><lastmod>%s</lastmod></url></urlset>\n" % (esc(base), esc(d["meta"].get("updatedAt", "")[:10])))
        (out / "sitemap.xml").write_text(sm, encoding="utf-8")


def copy_admin(out, args):
    import os
    repo = args.repo or os.environ.get("GITHUB_REPOSITORY", "")
    if "/" not in repo:
        sys.exit("中止：--with-admin 需要 --repo owner/name 或 GITHUB_REPOSITORY")
    owner, name = repo.split("/", 1)
    shutil.copytree(ROOT / "admin", out / "admin")
    cfg = {"backend": "github", "owner": owner, "repo": name, "branch": args.branch}
    csp = ('<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\'; '
           'img-src \'self\' https: data: blob:; connect-src \'self\' https://api.github.com; frame-src \'self\'; '
           'base-uri \'none\'; form-action \'self\'; object-src \'none\'">')
    idx = out / "admin" / "index.html"
    idx.write_text(idx.read_text(encoding="utf-8").replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  ' + csp, 1), encoding="utf-8")
    (out / "admin" / "cms-config.js").write_text("window.CMS_CONFIG = %s;\n" % json.dumps(cfg), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", choices=["test", "prod"], default="test")
    ap.add_argument("--out", default=str(ROOT / "dist"))
    ap.add_argument("--with-admin", action="store_true", help="一併部署雲端後台（GitHub 儲存庫作為資料後端）")
    ap.add_argument("--repo", default="", help="雲端後台使用的儲存庫，格式 owner/name（預設讀 GITHUB_REPOSITORY）")
    ap.add_argument("--branch", default="main")
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

    # SEO：把標題、描述、canonical、Open Graph、結構化資料寫進靜態 HTML（社群預覽與爬蟲不必執行 JS）
    html = (out / "index.html").read_text(encoding="utf-8")
    html = re.sub(r"<!-- SEO:start.*?<!-- SEO:end -->", lambda m: seo_head(data), html, flags=re.S)
    (out / "index.html").write_text(html, encoding="utf-8")
    write_crawl_files(out, data)

    if args.with_admin:
        copy_admin(out, args)

    # GitHub Pages：不要用 Jekyll 處理
    (out / ".nojekyll").write_text("", encoding="utf-8")

    files = [p for p in out.rglob("*") if p.is_file()]
    size = sum(p.stat().st_size for p in files)
    print("建置完成：%s（%d 個檔案，%.1f MB，環境 %s，內容版本 rev %s）" % (out, len(files), size / 1e6, args.env, data["meta"]["revision"]))


if __name__ == "__main__":
    main()
