#!/bin/sh
# 從剪貼簿設定 Worker 的 GITHUB_TOKEN（避免在隱藏輸入框貼上失敗）。不會把金鑰顯示在畫面上。
# 用法：先在 GitHub 複製 github_pat_ 開頭的金鑰，再執行 sh scripts/set_github_token.sh
T=$(pbpaste | tr -d '\r\n ')
case "$T" in
  github_pat_*) ;;
  *) echo "剪貼簿裡不是 github_pat_ 開頭的金鑰，請到 GitHub 複製後再執行一次"; exit 1 ;;
esac
printf '%s' "$T" | npx wrangler secret put GITHUB_TOKEN >/dev/null && echo "TOKEN-SET-OK（長度 ${#T} 字元）"
T=""
pbcopy < /dev/null
echo "已清空剪貼簿"
