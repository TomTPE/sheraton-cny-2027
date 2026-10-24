#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
台北喜來登 2027 新春宣傳網站：本機後台上稿伺服器（CMS）

- 僅使用 Python 標準函式庫，支援 Python 3.9 以上。
- 只綁定 127.0.0.1；正式環境請改用具 HTTPS、SSO 的後端（見 docs/CMS規劃.md）。

用法：
    python3 server.py --port 8777 --root <網站根目錄>

資料：
    data/content.json        已發布（前台讀取）
    data/draft.json          草稿（僅後台可讀）
    data/revisions/rev-N.json 發布快照
    data/audit.log           操作紀錄（JSON Lines）
    .cms-tokens.json         角色金鑰（權限 600）
"""

import argparse
import functools
import hashlib
import hmac
import json
import os
import posixpath
import re
import secrets
import sys
import tempfile
import threading
import urllib.parse
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional, Tuple

TPE = timezone(timedelta(hours=8))  # Asia/Taipei（台灣無日光節約時間）
MAX_DOC_BYTES = 2 * 1024 * 1024
MAX_UPLOAD_BYTES = 3 * 1024 * 1024

REQUIRED_KEYS = [
    "meta", "brand", "contacts", "nav", "hero", "takeaway",
    "dining", "banquet", "events", "gifts", "faq", "footer",
]
STATUS_VALUES = ["onsale", "coming", "soldout", "confirmed", "sample", "hidden"]
IMAGE_STATUS_VALUES = ["official", "reference", "placeholder", "none"]
IMAGE_KEYS = {"image", "onDark", "onLight", "ogImage", "heroImage"}
TEL_KEYS = {"tel", "bookingTel", "directTel"}
TRACK_RULES = {
    "ga4": (r"^G-[A-Z0-9]{4,12}$", "GA4 評估 ID 格式為 G-XXXXXXXXXX"),
    "gtm": (r"^GTM-[A-Z0-9]{4,10}$", "GTM 容器 ID 格式為 GTM-XXXXXXX"),
    "googleAds": (r"^AW-\d{6,12}$", "Google Ads 轉換 ID 格式為 AW-123456789"),
    "metaPixel": (r"^\d{10,20}$", "Meta Pixel ID 為 10–20 位數字"),
}
TEL_TYPES = {"phone", "inquiry"}
URL_TYPES = {"booking", "buy", "link"}

TEL_RE = re.compile(r"^\+886\d{8,9}$")
HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
HTTPS_RE = re.compile(r"^https://\S+$")
REV_FILE_RE = re.compile(r"^rev-(\d+)\.json$")

ROLES = ("editor", "publisher")
ROLE_LEVEL = {"editor": 1, "publisher": 2}


def now_iso() -> str:
    return datetime.now(TPE).isoformat(timespec="seconds")


def etag_of(data: bytes) -> str:
    return '"' + hashlib.sha256(data).hexdigest() + '"'


def normalize_etag(value: str) -> str:
    v = (value or "").strip()
    if v.startswith("W/"):
        v = v[2:]
    return v.strip()


def dump_doc(doc: Any) -> bytes:
    return (json.dumps(doc, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def atomic_write(path: str, data: bytes, mode: int = 0o644) -> None:
    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", dir=directory)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


# ---------------------------------------------------------------------------
# 驗證（與 admin/admin.js 的 validateDoc 對應）
# ---------------------------------------------------------------------------

def fmt_path(parts: List[Any]) -> str:
    s = ""
    for p in parts:
        if isinstance(p, int):
            s += "[%d]" % p
        else:
            s += ("." if s else "") + str(p)
    return s or "（根）"


def image_path_ok(v: str) -> bool:
    if v == "":
        return True
    if HTTPS_RE.match(v):
        return True
    if not v.startswith("assets/") or "\\" in v or "\x00" in v:
        return False
    segs = v.split("/")
    return all(s not in ("", ".", "..") for s in segs)


def validate_document(doc: Any) -> List[Dict[str, str]]:
    errors: List[Dict[str, str]] = []

    def err(path: List[Any], msg: str) -> None:
        errors.append({"path": fmt_path(path), "message": msg})

    if not isinstance(doc, dict):
        return [{"path": "（根）", "message": "文件必須是 JSON 物件"}]

    hero = doc.get("hero") if isinstance(doc.get("hero"), dict) else {}
    if "effect" in hero and hero["effect"] != "arch":
        err(["hero", "effect"], "首屏效果只提供 arch（拱形視窗）；紅綢揭幕版已依統一方案撤下")

    for k in REQUIRED_KEYS:
        if k not in doc:
            err([k], "缺少必要欄位「%s」" % k)
        elif k == "nav":
            if not isinstance(doc[k], list):
                err([k], "「nav」必須是陣列")
        elif not isinstance(doc[k], dict):
            err([k], "「%s」必須是物件" % k)

    # --- 品牌 CIS：tokens 只能取自 approvedPalette ---
    brand = doc.get("brand")
    palette = set()
    if isinstance(brand, dict):
        pal = brand.get("approvedPalette")
        if not isinstance(pal, list) or not pal:
            err(["brand", "approvedPalette"], "核准色盤 approvedPalette 必須是非空陣列")
        else:
            for i, p in enumerate(pal):
                hx = p.get("hex") if isinstance(p, dict) else None
                if not isinstance(hx, str) or not HEX_RE.match(hx):
                    err(["brand", "approvedPalette", i, "hex"], "色碼格式必須為 #RRGGBB")
                else:
                    palette.add(hx.upper())
        tokens = brand.get("tokens")
        if not isinstance(tokens, dict):
            err(["brand", "tokens"], "色彩代號 tokens 必須是物件")
        else:
            for name, val in tokens.items():
                if not isinstance(val, str) or val.upper() not in palette:
                    err(["brand", "tokens", name],
                        "色彩「%s」不在核准色盤 approvedPalette 中，請改選核准色" % (val,))

    # --- 導覽列 id 與 CTA 類型 ---
    nav_ids: List[str] = []
    if isinstance(doc.get("nav"), list):
        for n in doc["nav"]:
            if isinstance(n, dict) and isinstance(n.get("id"), str):
                nav_ids.append(n["id"])
    cta_types = doc.get("ctaTypes")
    if not isinstance(cta_types, dict):
        err(["ctaTypes"], "缺少 ctaTypes 或格式錯誤（必須是物件）")
        cta_keys = set()
    else:
        cta_keys = set(cta_types.keys())

    def check_cta(c: Any, p: List[Any]) -> None:
        if not isinstance(c, dict):
            err(p, "CTA 必須是物件")
            return
        t = c.get("type")
        if t not in cta_keys:
            err(p + ["type"], "CTA 類型「%s」不存在於 ctaTypes" % (t,))
        if t in TEL_TYPES:
            tel = c.get("tel")
            if not isinstance(tel, str) or not TEL_RE.match(tel):
                err(p + ["tel"], "電話必須是 +886 開頭的國際格式（例：+886223215511），不可有空格或連字號")
        elif t in URL_TYPES:
            url = c.get("url")
            if not isinstance(url, str) or not HTTPS_RE.match(url):
                err(p + ["url"], "網址必須以 https:// 開頭")
        elif t == "anchor":
            target = c.get("target")
            if target not in nav_ids:
                err(p + ["target"], "頁內錨點 target 必須是導覽列 nav 的 id（可用：%s）" % "、".join(nav_ids))

    def walk(node: Any, path: List[Any]) -> None:
        if isinstance(node, dict):
            for k, v in node.items():
                p = path + [k]
                if k == "ctas":
                    if not isinstance(v, list):
                        err(p, "ctas 必須是陣列")
                    else:
                        for i, c in enumerate(v):
                            check_cta(c, p + [i])
                    continue
                if k == "status":
                    if v not in STATUS_VALUES:
                        err(p, "狀態「%s」無效，必須是：%s" % (v, "、".join(STATUS_VALUES)))
                elif k == "imageStatus":
                    if v not in IMAGE_STATUS_VALUES:
                        err(p, "圖片授權狀態「%s」無效，必須是：%s" % (v, "、".join(IMAGE_STATUS_VALUES)))
                elif k in IMAGE_KEYS:
                    if not isinstance(v, str) or not image_path_ok(v):
                        err(p, "圖片路徑必須留空、assets/ 底下的相對路徑，或 https:// 網址")
                elif k == "url":
                    if not isinstance(v, str) or (v != "" and not HTTPS_RE.match(v)):
                        err(p, "網址必須以 https:// 開頭")
                elif k in TEL_KEYS:
                    if not isinstance(v, str) or (v != "" and not TEL_RE.match(v)):
                        err(p, "電話必須是 +886 開頭的國際格式（例：+886223215511），不可有空格或連字號")
                walk(v, p)
            img = node.get("image")
            if isinstance(img, str) and img != "" and "imageAlt" in node:
                alt = node.get("imageAlt")
                if not isinstance(alt, str) or not alt.strip():
                    err(path + ["imageAlt"], "已設定圖片，請填寫替代文字（alt）")
            if node.get("status") == "soldout" and isinstance(node.get("ctas"), list):
                for i, c in enumerate(node["ctas"]):
                    if isinstance(c, dict) and c.get("type") == "buy":
                        err(path + ["ctas", i, "type"], "已售完的項目不得顯示「線上購買」按鈕")
        elif isinstance(node, list):
            for i, x in enumerate(node):
                walk(x, path + [i])

    walk(doc, [])

    # --- 販售中品項必須有 CTA ---
    for sec in ("takeaway", "gifts"):
        s = doc.get(sec)
        if not isinstance(s, dict):
            continue
        items = s.get("items")
        if not isinstance(items, list):
            err([sec, "items"], "items 必須是陣列")
            continue
        for i, it in enumerate(items):
            if isinstance(it, dict) and it.get("status") == "onsale":
                ctas = it.get("ctas")
                if not isinstance(ctas, list) or len(ctas) == 0:
                    err([sec, "items", i, "ctas"], "販售中的品項至少需要一個 CTA 按鈕")

    # --- 餐廳內用：春節僅電話訂位的餐廳 ---
    dining = doc.get("dining")
    if isinstance(dining, dict) and isinstance(dining.get("offers"), list):
        rest = {}
        for r in dining.get("restaurants") or []:
            if isinstance(r, dict) and isinstance(r.get("id"), str):
                rest[r["id"]] = r
        for i, o in enumerate(dining["offers"]):
            if not isinstance(o, dict):
                continue
            b = o.get("booking")
            if b not in ("phone", "online"):
                err(["dining", "offers", i, "booking"], "訂位方式 booking 必須是 phone 或 online")
            r = rest.get(o.get("restaurant"))
            if r is None:
                err(["dining", "offers", i, "restaurant"], "找不到對應的餐廳 id「%s」" % (o.get("restaurant"),))
            else:
                bk = r.get("booking") if isinstance(r.get("booking"), dict) else {}
                if bk.get("cnyPhoneOnly") is True and b != "phone":
                    err(["dining", "offers", i, "booking"],
                        "「%s」春節期間僅受理電話訂位，booking 必須為 phone" % (r.get("name") or r["id"]))
    tr = doc.get("tracking")
    if tr is not None:
        if not isinstance(tr, dict):
            err(["tracking"], "追蹤碼設定必須是物件")
        else:
            for k, (rx, msg) in TRACK_RULES.items():
                v = tr.get(k)
                if v not in (None, "") and (not isinstance(v, str) or not re.match(rx, v)):
                    err(["tracking", k], msg + "；不使用請留空")
    seo = doc.get("seo")
    if isinstance(seo, dict):
        u = seo.get("siteUrl")
        if u and not re.match(r"^https://\S+/$", str(u)):
            err(["seo", "siteUrl"], "正式網址必須以 https:// 開頭、以 / 結尾")
        gv = seo.get("googleSiteVerification")
        if gv and not re.match(r"^[A-Za-z0-9_-]{10,100}$", str(gv)):
            err(["seo", "googleSiteVerification"], "驗證碼只能包含英數字、- 與 _")
    return errors


# ---------------------------------------------------------------------------
# 圖片格式（以檔頭判斷，不信任副檔名）
# ---------------------------------------------------------------------------

def sniff_image(data: bytes) -> Optional[str]:
    if len(data) >= 3 and data[:3] == b"\xFF\xD8\xFF":
        return "jpg"
    if len(data) >= 8 and data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


# ---------------------------------------------------------------------------
# 伺服器狀態
# ---------------------------------------------------------------------------

class Context:
    def __init__(self, root: str, port: int):
        self.root = os.path.realpath(root)
        self.port = port
        self.content_path = os.path.join(self.root, "data", "content.json")
        self.draft_path = os.path.join(self.root, "data", "draft.json")
        self.rev_dir = os.path.join(self.root, "data", "revisions")
        self.audit_path = os.path.join(self.root, "data", "audit.log")
        self.tokens_path = os.path.join(self.root, ".cms-tokens.json")
        self.upload_dir = os.path.join(self.root, "assets", "uploads")
        self.lock = threading.RLock()
        self.tokens: Dict[str, str] = {}

    # --- 金鑰 ---
    def load_tokens(self) -> Tuple[Dict[str, str], bool]:
        if os.path.exists(self.tokens_path):
            with open(self.tokens_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            for r in ROLES:
                if not isinstance(data.get(r), str) or len(data[r]) < 16:
                    raise SystemExit("金鑰檔 .cms-tokens.json 格式錯誤：缺少 %s" % r)
            self.tokens = {r: data[r] for r in ROLES}
            return self.tokens, False
        toks = {r: secrets.token_urlsafe(32) for r in ROLES}
        fd = os.open(self.tokens_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(toks, f, indent=2)
            f.write("\n")
        os.chmod(self.tokens_path, 0o600)
        self.tokens = toks
        return toks, True

    def role_for(self, token: str) -> Optional[str]:
        if not token:
            return None
        given = token.encode("utf-8")
        role = None
        for r in ROLES:  # 每個角色都比對，避免時間差洩漏
            if hmac.compare_digest(given, self.tokens[r].encode("utf-8")):
                role = r
        return role

    # --- 草稿 / 版本 ---
    def read_content(self) -> bytes:
        with open(self.content_path, "rb") as f:
            return f.read()

    def read_draft(self) -> bytes:
        with self.lock:
            if not os.path.exists(self.draft_path):
                atomic_write(self.draft_path, self.read_content())
            with open(self.draft_path, "rb") as f:
                return f.read()

    def snapshot_revisions(self) -> List[int]:
        if not os.path.isdir(self.rev_dir):
            return []
        revs = []
        for name in os.listdir(self.rev_dir):
            m = REV_FILE_RE.match(name)
            if m:
                revs.append(int(m.group(1)))
        return sorted(revs)

    def ensure_baseline(self) -> None:
        """首次啟動時，把目前線上版本存成第一份快照，方便回滾。"""
        with self.lock:
            if self.snapshot_revisions():
                return
            data = self.read_content()
            try:
                rev = int(json.loads(data.decode("utf-8"))["meta"]["revision"])
            except Exception:
                rev = 0
            atomic_write(os.path.join(self.rev_dir, "rev-%d.json" % rev), data)

    def audit(self, role: str, action: str, revision: Any = None, detail: str = "") -> None:
        line = json.dumps({
            "ts": now_iso(), "role": role, "action": action,
            "revision": revision, "detail": detail,
        }, ensure_ascii=False)
        with self.lock:
            os.makedirs(os.path.dirname(self.audit_path), exist_ok=True)
            with open(self.audit_path, "a", encoding="utf-8") as f:
                f.write(line + "\n")


# ---------------------------------------------------------------------------
# HTTP 處理
# ---------------------------------------------------------------------------

ADMIN_CSP = (
    "default-src 'self'; script-src 'self'; "
    "style-src 'self' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com; "
    "img-src 'self' https: data:; connect-src 'self'; frame-src 'self'; "
    "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'"
)


class CMSHandler(SimpleHTTPRequestHandler):
    server_version = "CMS/1.0"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    extensions_map = dict(SimpleHTTPRequestHandler.extensions_map)
    extensions_map.update({
        ".webp": "image/webp", ".svg": "image/svg+xml", ".json": "application/json",
        ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
        ".woff2": "font/woff2", ".md": "text/markdown",
    })

    @property
    def ctx(self) -> Context:
        return self.server.ctx  # type: ignore[attr-defined]

    # --- 共用 ---
    def guess_type(self, path):  # type: ignore[override]
        t = super().guess_type(path)
        if t.startswith("text/") or t in ("application/json", "image/svg+xml"):
            t += "; charset=utf-8"
        return t

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        path = self.path.split("?", 1)[0]
        if path == "/admin" or path.startswith("/admin/"):
            self.send_header("Content-Security-Policy", ADMIN_CSP)
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("[%s] %s\n" % (now_iso(), fmt % args))

    def host_ok(self) -> bool:
        host = self.headers.get("Host")
        if not host:
            return True
        name = host.rsplit(":", 1)[0] if not host.startswith("[") else host.split("]")[0] + "]"
        return name.lower() in ("127.0.0.1", "localhost", "[::1]")

    def send_json(self, status: int, obj: Any, headers: Optional[Dict[str, str]] = None) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_bytes_json(self, data: bytes, etag: Optional[str] = None) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        if etag:
            self.send_header("ETag", etag)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def fail(self, status: int, message: str, **extra: Any) -> None:
        obj = {"error": message}
        obj.update(extra)
        if self.command in ("PUT", "POST"):
            # 請求本文可能尚未讀取，結束連線避免殘留資料被當成下一個請求
            self.close_connection = True
        self.send_json(status, obj)

    def read_body(self, limit: int, too_large_msg: str) -> Optional[bytes]:
        cl = self.headers.get("Content-Length")
        if self.headers.get("Transfer-Encoding"):
            self.close_connection = True
            self.fail(411, "不支援分段傳輸，請提供 Content-Length")
            return None
        if cl is None:
            self.close_connection = True
            self.fail(411, "缺少 Content-Length")
            return None
        try:
            n = int(cl)
        except ValueError:
            self.close_connection = True
            self.fail(400, "Content-Length 格式錯誤")
            return None
        if n < 0:
            self.close_connection = True
            self.fail(400, "Content-Length 格式錯誤")
            return None
        if n > limit:
            # 先讀掉（上限 16 MB）再回應，讓瀏覽器能收到 413 而非連線中斷
            remaining = n if n <= 16 * 1024 * 1024 else 0
            while remaining > 0:
                chunk = self.rfile.read(min(65536, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
            self.close_connection = True
            self.fail(413, too_large_msg)
            return None
        return self.rfile.read(n) if n else b""

    def require(self, minimum: str) -> Optional[str]:
        role = self.ctx.role_for(self.headers.get("X-Admin-Token", ""))
        if role is None:
            if self.headers.get("X-Admin-Token"):
                self.ctx.audit("-", "auth_fail", None, self.command + " " + self.path.split("?", 1)[0])
            self.fail(401, "未授權：請提供有效的後台金鑰（X-Admin-Token）")
            return None
        if ROLE_LEVEL[role] < ROLE_LEVEL[minimum]:
            self.fail(403, "權限不足：此操作需要發布者（publisher）權限")
            return None
        return role

    # --- 靜態檔案存取限制 ---
    def is_denied(self) -> bool:
        raw = self.path.split("?", 1)[0].split("#", 1)[0]
        try:
            decoded = urllib.parse.unquote(raw, errors="strict")
        except UnicodeDecodeError:
            return True
        if "\x00" in decoded or "\\" in decoded:
            return True
        # 以伺服器實際會讀取的檔案路徑判斷，避免 //、%2e、大小寫等繞過
        fs_path = os.path.realpath(self.translate_path(self.path))
        rel = os.path.relpath(fs_path, self.ctx.root).replace(os.sep, "/")
        if rel == ".." or rel.startswith("../"):
            return True
        if rel == ".":
            return False
        low = rel.lower()
        parts = low.split("/")
        if any(p.startswith(".") for p in parts):
            return True
        if any(p.startswith(".") for p in posixpath.normpath(decoded).lower().split("/") if p):
            return True
        if low.endswith(".py") or low in ("data/draft.json", "data/audit.log"):
            return True
        if low == "data/revisions" or low.startswith("data/revisions/"):
            return True
        if low.endswith(".tmp") or "/.tmp-" in "/" + low:
            return True
        return False

    def list_directory(self, path):  # type: ignore[override]
        self.send_error(404, "Not Found")
        return None

    # --- 方法 ---
    def do_GET(self) -> None:
        if not self.host_ok():
            self.fail(421, "不允許的 Host")
            return
        if self.path.startswith("/api/"):
            self.handle_api("GET")
            return
        if self.is_denied():
            self.send_error(404, "Not Found")
            return
        super().do_GET()

    def do_HEAD(self) -> None:
        if not self.host_ok() or self.path.startswith("/api/") or self.is_denied():
            self.send_error(404, "Not Found")
            return
        super().do_HEAD()

    def do_PUT(self) -> None:
        if not self.host_ok():
            self.fail(421, "不允許的 Host")
            return
        self.handle_api("PUT")

    def do_POST(self) -> None:
        if not self.host_ok():
            self.fail(421, "不允許的 Host")
            return
        self.handle_api("POST")

    def do_DELETE(self) -> None:
        self.fail(405, "不支援的方法")

    def handle_api(self, method: str) -> None:
        parsed = urllib.parse.urlsplit(self.path)
        route = parsed.path
        query = urllib.parse.parse_qs(parsed.query)
        routes = {
            ("GET", "/api/whoami"): self.api_whoami,
            ("GET", "/api/content"): lambda: self.api_content(query),
            ("PUT", "/api/draft"): self.api_put_draft,
            ("POST", "/api/publish"): self.api_publish,
            ("GET", "/api/revisions"): self.api_revisions,
            ("POST", "/api/rollback"): self.api_rollback,
            ("POST", "/api/upload"): self.api_upload,
            ("GET", "/api/audit"): self.api_audit,
        }
        fn = routes.get((method, route))
        if fn is None:
            if any(r == route for (_, r) in routes):
                self.fail(405, "不支援的方法")
            else:
                self.fail(404, "找不到 API")
            return
        try:
            fn()
        except Exception as e:  # 不把內部細節回傳給用戶端
            self.log_message("API 錯誤 %s %s: %r", method, route, e)
            try:
                self.fail(500, "伺服器內部錯誤")
            except Exception:
                pass

    # --- API ---
    def api_whoami(self) -> None:
        role = self.require("editor")
        if role:
            self.send_json(200, {"role": role})

    def api_content(self, query: Dict[str, List[str]]) -> None:
        stage = (query.get("stage") or ["published"])[0]
        if stage == "published":
            data = self.ctx.read_content()
            self.send_bytes_json(data, etag_of(data))
        elif stage == "draft":
            if not self.require("editor"):
                return
            data = self.ctx.read_draft()
            self.send_bytes_json(data, etag_of(data))
        else:
            self.fail(400, "stage 必須是 published 或 draft")

    def parse_json_body(self) -> Tuple[bool, Any]:
        body = self.read_body(MAX_DOC_BYTES, "文件超過 2 MB 上限")
        if body is None:
            return False, None
        try:
            return True, json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as e:
            self.fail(400, "JSON 格式錯誤：%s" % e)
            return False, None

    def api_put_draft(self) -> None:
        role = self.require("editor")
        if not role:
            return
        ok, doc = self.parse_json_body()
        if not ok:
            return
        with self.ctx.lock:
            cur = self.ctx.read_draft()
            cur_etag = etag_of(cur)
            if_match = self.headers.get("If-Match")
            if not if_match:
                self.fail(428, "缺少 If-Match 標頭：請先載入草稿再儲存")
                return
            if normalize_etag(if_match) != cur_etag:
                cur_meta = {}
                try:
                    cur_meta = json.loads(cur.decode("utf-8")).get("meta", {})
                except Exception:
                    pass
                self.fail(409, "草稿已被其他人更新，請重新載入後再編輯",
                          etag=cur_etag, updatedAt=cur_meta.get("updatedAt"),
                          updatedBy=cur_meta.get("updatedBy"))
                return
            errors = validate_document(doc)
            if errors:
                self.fail(422, "驗證失敗，共 %d 項需修正" % len(errors), errors=errors)
                return
            try:
                cur_rev = json.loads(cur.decode("utf-8"))["meta"]["revision"]
            except Exception:
                cur_rev = doc["meta"].get("revision", 0)
            doc["meta"]["revision"] = cur_rev  # 版本號由伺服器管理
            doc["meta"]["updatedAt"] = now_iso()
            doc["meta"]["updatedBy"] = role
            out = dump_doc(doc)
            if len(out) > MAX_DOC_BYTES:
                self.fail(413, "文件超過 2 MB 上限")
                return
            atomic_write(self.ctx.draft_path, out)
            self.ctx.audit(role, "save_draft", cur_rev)
            tag = etag_of(out)
            self.send_json(200, {"ok": True, "etag": tag, "meta": doc["meta"]}, {"ETag": tag})

    def api_publish(self) -> None:
        role = self.require("publisher")
        if not role:
            return
        self.close_connection = True  # 本 API 不讀取請求本文
        with self.ctx.lock:
            draft = self.ctx.read_draft()
            if_match = self.headers.get("If-Match")
            if if_match and normalize_etag(if_match) != etag_of(draft):
                self.fail(409, "草稿已被其他人更新，請重新載入並確認後再發布", etag=etag_of(draft))
                return
            try:
                doc = json.loads(draft.decode("utf-8"))
            except ValueError:
                self.fail(500, "草稿檔案損毀，無法發布")
                return
            errors = validate_document(doc)
            if errors:
                self.fail(422, "草稿驗證失敗，無法發布（共 %d 項）" % len(errors), errors=errors)
                return
            try:
                pub_rev = int(json.loads(self.ctx.read_content().decode("utf-8"))["meta"]["revision"])
            except Exception:
                pub_rev = 0
            try:
                draft_rev = int(doc["meta"].get("revision", 0))
            except (TypeError, ValueError):
                draft_rev = 0
            snaps = self.ctx.snapshot_revisions()
            new_rev = max([pub_rev, draft_rev] + snaps) + 1
            doc["meta"]["revision"] = new_rev
            doc["meta"]["updatedAt"] = now_iso()
            doc["meta"]["updatedBy"] = role
            out = dump_doc(doc)
            atomic_write(os.path.join(self.ctx.rev_dir, "rev-%d.json" % new_rev), out)
            atomic_write(self.ctx.content_path, out)
            self.ctx.audit(role, "publish", new_rev)
            self.send_json(200, {"ok": True, "revision": new_rev, "updatedAt": doc["meta"]["updatedAt"]})

    def api_revisions(self) -> None:
        if not self.require("editor"):
            return
        try:
            live = int(json.loads(self.ctx.read_content().decode("utf-8"))["meta"]["revision"])
        except Exception:
            live = None
        out = []
        for rev in sorted(self.ctx.snapshot_revisions(), reverse=True):
            item = {"revision": rev, "updatedAt": None, "updatedBy": None, "live": rev == live}
            try:
                with open(os.path.join(self.ctx.rev_dir, "rev-%d.json" % rev), "rb") as f:
                    meta = json.loads(f.read().decode("utf-8")).get("meta", {})
                item["updatedAt"] = meta.get("updatedAt")
                item["updatedBy"] = meta.get("updatedBy")
            except Exception:
                pass
            out.append(item)
        self.send_json(200, {"revisions": out})

    def api_rollback(self) -> None:
        role = self.require("publisher")
        if not role:
            return
        ok, body = self.parse_json_body()
        if not ok:
            return
        rev = body.get("revision") if isinstance(body, dict) else None
        if not isinstance(rev, int) or isinstance(rev, bool) or rev < 0:
            self.fail(400, "revision 必須是非負整數")
            return
        path = os.path.join(self.ctx.rev_dir, "rev-%d.json" % rev)
        with self.ctx.lock:
            if not os.path.exists(path):
                self.fail(404, "找不到版本 rev-%d" % rev)
                return
            with open(path, "rb") as f:
                doc = json.loads(f.read().decode("utf-8"))
            doc["meta"]["updatedAt"] = now_iso()
            doc["meta"]["updatedBy"] = role
            out = dump_doc(doc)
            atomic_write(self.ctx.draft_path, out)
            self.ctx.audit(role, "rollback", rev, "還原至草稿")
            tag = etag_of(out)
            self.send_json(200, {"ok": True, "revision": rev, "etag": tag}, {"ETag": tag})

    def api_upload(self) -> None:
        role = self.require("editor")
        if not role:
            return
        data = self.read_body(MAX_UPLOAD_BYTES, "檔案超過 3 MB 上限")
        if data is None:
            return
        if not data:
            self.fail(400, "沒有收到檔案內容")
            return
        ext = sniff_image(data)
        if ext is None:
            self.fail(415, "僅接受 JPEG、PNG、WebP 圖片（依檔案內容判斷，非副檔名）")
            return
        name = hashlib.sha256(data).hexdigest()[:16] + "." + ext
        dest = os.path.join(self.ctx.upload_dir, name)
        with self.ctx.lock:
            if not os.path.exists(dest):
                atomic_write(dest, data)
        original = urllib.parse.unquote(self.headers.get("X-Filename", ""))[:200]
        original = re.sub(r"[\x00-\x1f\x7f]", "", original)
        rel = "assets/uploads/" + name
        self.ctx.audit(role, "upload", None, "%s ← %s" % (rel, original))
        self.send_json(201, {"path": rel, "bytes": len(data), "type": ext})

    def api_audit(self) -> None:
        if not self.require("publisher"):
            return
        lines: List[str] = []
        if os.path.exists(self.ctx.audit_path):
            with open(self.ctx.audit_path, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()[-100:]
        entries = []
        for ln in reversed(lines):
            ln = ln.strip()
            if not ln:
                continue
            try:
                entries.append(json.loads(ln))
            except ValueError:
                entries.append({"raw": ln})
        self.send_json(200, {"entries": entries})


def main() -> None:
    ap = argparse.ArgumentParser(description="2027 新春宣傳網站：本機後台上稿伺服器")
    ap.add_argument("--port", type=int, default=8777)
    ap.add_argument("--root", default=os.path.dirname(os.path.abspath(__file__)))
    args = ap.parse_args()

    ctx = Context(args.root, args.port)
    if not os.path.isfile(ctx.content_path):
        raise SystemExit("找不到 %s" % ctx.content_path)
    toks, created = ctx.load_tokens()
    ctx.ensure_baseline()

    httpd = ThreadingHTTPServer(("127.0.0.1", args.port),
                                functools.partial(CMSHandler, directory=ctx.root))
    httpd.daemon_threads = True
    httpd.ctx = ctx  # type: ignore[attr-defined]

    print("網站根目錄：%s" % ctx.root)
    if created:
        print("已產生後台金鑰（只顯示這一次，已存於 .cms-tokens.json，權限 600）：")
        for r in ROLES:
            print("  %-9s %s" % (r, toks[r]))
    else:
        print("沿用既有金鑰檔 .cms-tokens.json")
    print("前台：http://127.0.0.1:%d/" % args.port)
    print("後台：http://127.0.0.1:%d/admin/" % args.port)
    sys.stdout.flush()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
