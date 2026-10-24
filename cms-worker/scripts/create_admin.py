#!/usr/bin/env python3
"""建立第一位管理員（只在您自己的終端機執行，密碼不會顯示、不會寫入檔案或歷史紀錄）。

用法：python3 scripts/create_admin.py <帳號> [顯示名稱]
會輸出一個暫存 SQL 檔路徑，接著執行：
  npx wrangler d1 execute sheraton-cny-cms --remote --file <該檔案>
執行後請刪除該檔案（內含密碼雜湊，非明文）。
"""
import getpass
import hashlib
import os
import re
import sys
import tempfile
from datetime import datetime, timedelta, timezone

ITER = 100000  # 與 Worker 相同（Cloudflare Workers 的 PBKDF2 上限）

if len(sys.argv) < 2 or not re.fullmatch(r"[a-z0-9][a-z0-9._-]{2,31}", sys.argv[1]):
    sys.exit("請提供帳號：3–32 字元小寫英數字，可含 . _ -")
user = sys.argv[1]
name = (sys.argv[2] if len(sys.argv) > 2 else user)[:40].replace("'", "''")
pw = getpass.getpass("設定密碼（至少 12 字元，含大寫、小寫、數字、符號其中三種）：")
if len(pw) < 12 or sum(bool(re.search(r, pw)) for r in (r"[a-z]", r"[A-Z]", r"\d", r"[^A-Za-z0-9]")) < 3 or user in pw.lower():
    sys.exit("密碼強度不足")
if getpass.getpass("再輸入一次：") != pw:
    sys.exit("兩次輸入不同")
salt = os.urandom(16).hex()
h = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), ITER).hex()
now = datetime.now(timezone(timedelta(hours=8))).replace(microsecond=0).isoformat()
sql = ("INSERT INTO users (username, display_name, role, pw_hash, salt, iterations, must_change, created_at, updated_at) "
       "VALUES ('%s', '%s', 'admin', '%s', '%s', %d, 0, '%s', '%s');\n" % (user, name, h, salt, ITER, now, now))
fd, path = tempfile.mkstemp(prefix="cms-admin-", suffix=".sql")
with os.fdopen(fd, "w") as f:
    f.write(sql)
print(path)
