# 雲端後台 API（Cloudflare Workers）

後台改用帳號密碼登入，並提供帳號管理功能。前端仍是 `admin/` 的同一套介面，部署在 GitHub Pages。
這個 Worker 負責登入驗證、帳號管理，以及把內容寫進 GitHub 儲存庫。

## 安全設計
| 項目 | 做法 |
|---|---|
| 密碼 | PBKDF2-SHA256 100,000 次（Cloudflare Workers 上限），每個帳號用隨機 16 bytes 鹽，存放在 D1，不保存明文 |
| 密碼規則 | 至少 12 字元，大寫、小寫、數字、符號至少三種，不可包含帳號名稱 |
| 登入失敗 | 錯誤訊息一律為「帳號或密碼錯誤」，不透露帳號是否存在；連續 5 次錯誤鎖定 15 分鐘 |
| 工作階段 | 隨機 32 bytes 權杖，D1 只存它的 SHA-256；8 小時到期；以 Authorization 標頭傳遞（不使用 Cookie，避免 CSRF）；權杖只放在瀏覽器分頁的 sessionStorage |
| 帳號異動 | 改角色、停用、重設密碼時，該帳號的所有登入立即失效；新帳號與重設密碼後，首次登入必須自行改密碼 |
| 防呆 | 不能降低自己的權限、停用或刪除自己；至少保留一位啟用中的管理員 |
| GitHub 金鑰 | 只存在 Worker secret（`GITHUB_TOKEN`），瀏覽器拿不到 |
| 來源限制 | CORS 與請求來源只允許 `ALLOWED_ORIGINS`（https://tomtpe.github.io） |
| 稽核 | 登入、登入失敗、帳號異動、草稿、發布、還原、上傳，都記錄帳號、時間與 IP |
| 內容驗證 | 草稿只檢查 JSON 格式與大小；發布後由 GitHub Actions 以 `server.py` 的相同規則驗證，不通過就不部署 |

## 角色
- **編輯者 editor**：編輯與儲存草稿、上傳圖片、預覽、查看版本紀錄
- **發布者 publisher**：編輯者的權限，再加上發布、還原版本、查看操作紀錄
- **管理員 admin**：發布者的權限，再加上帳號管理

## 版本與授權
| 元件 | 版本 | 授權 |
|---|---|---|
| Node.js（只在部署工具使用） | 24.22.1 LTS | MIT |
| wrangler（Cloudflare 官方 CLI，固定版本） | 4.151.1 | MIT OR Apache-2.0 |
| undici（wrangler 相依，以 overrides 升到修正版） | 7.30.1 | MIT |

wrangler 4.151.1 內附的 undici 7.29.1 有已知漏洞：GHSA-4qv8-2p9j-2685（高風險）、GHSA-f72v-6w45-q472。這個漏洞只影響本機開發工具，Worker 程式本身沒有相依任何套件。已用 `overrides` 把 undici 升到 7.30.1，`npm audit` 結果為 0 個漏洞。

## 部署步驟（第一次）
在 `cms-worker/` 執行：

1. `npx wrangler login`：在瀏覽器授權 Cloudflare 帳號（需由帳號擁有者本人操作）
2. `npx wrangler d1 create sheraton-cny-cms`：把輸出的 `database_id` 填進 `wrangler.toml`
3. `npx wrangler d1 execute sheraton-cny-cms --remote --file schema.sql`
4. `npx wrangler secret put GITHUB_TOKEN`：貼上 fine-grained token
   - 只授權 `TomTPE/sheraton-cny-2027`
   - 權限設為 Contents：Read and write
   - 建議建立一個專用的機器帳號或另開一把金鑰，設定到期日
5. `npx wrangler deploy`：記下輸出的網址，例如 `https://sheraton-cny-cms.<帳號>.workers.dev`
6. `python3 scripts/create_admin.py <帳號> <顯示名稱>`：輸入第一位管理員的密碼（不會顯示在畫面上），接著執行它印出的 `wrangler d1 execute ... --remote --file <檔案>`，最後刪除該檔案
7. 在 GitHub 儲存庫 Settings → Secrets and variables → Actions → Variables，新增 `CMS_API`（值為第 5 步的網址），然後重新執行部署流程
   - 設定之後，`/admin/` 改用帳號密碼登入
   - 沒有設定時，沿用 GitHub 金鑰登入

## 日常維護
- 新增、停用帳號：用後台「帳號管理」
- 管理員忘記密碼：由另一位管理員重設。如果只有一位管理員，請在終端機重新執行 `create_admin.py` 建立新的管理員帳號
- 更換 GitHub 金鑰：重新執行 `npx wrangler secret put GITHUB_TOKEN`
- 免費額度：Workers 每天 10 萬次請求，D1 每天 500 萬次讀取（以 Cloudflare 官方公告為準），後台使用量遠低於此
