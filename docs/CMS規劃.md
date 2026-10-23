# 後台上稿平台（CMS）規劃

適用專案：台北喜來登 2027 新春宣傳網站（`site-2027/`）
文件日期：2026-10-23
狀態：本機版（Local CMS）已可使用；正式環境方案待選型。

---

## 1. 目標與範圍

**目標**

1. 讓行銷／餐飲窗口不用改程式碼，就能更新活動內容（品項、價格、狀態、CTA、圖片、FAQ）。
2. 以 `data/content.json` 作為唯一資料來源（「資料庫」），前台與後台讀同一份結構，避免內容分散在不同檔案。
3. 讓品牌 CIS（色彩）與資料庫保持一致：前台色彩只能來自資料庫，且只能選核准色。
4. 先存草稿、預覽確認後再發布，保留版本快照，可以回滾。

**範圍（本機版）**

| 項目 | 內容 |
|---|---|
| 後台介面 | `admin/index.html`、`admin/admin.css`、`admin/admin.js`（原生 HTML/CSS/JS，無框架、無 CDN 腳本） |
| 伺服器 | `server.py`（Python 3.9 以上、僅用標準函式庫，只綁定 127.0.0.1） |
| 資料 | `data/content.json`（已發布）、`data/draft.json`（草稿）、`data/revisions/rev-N.json`（快照）、`data/audit.log`（操作紀錄） |
| 不在範圍 | 前台頁面（`index.html`、`assets/css`、`assets/js`，由前台工程師負責）、正式主機部署、SSO 串接 |

---

## 2. 資訊架構與 CMS 模組對照

| 後台模組 | 對應 JSON 鍵 | 前台區塊 | 備註 |
|---|---|---|---|
| 網站設定 | `meta`、`nav`、`ctaTypes` | `<head>`、導覽列、所有 CTA 按鈕的類型定義 | `meta.revision / updatedAt / updatedBy` 由伺服器寫入，後台唯讀 |
| 品牌 CIS | `brand` | 全站 CSS 變數、標誌 | 色彩只能從 `approvedPalette` 選；顯示 WCAG 對比度 |
| 聯絡資訊 | `contacts` | 頁尾、電話 CTA 預設值 | |
| 首頁 Banner | `hero` | 首屏主視覺與情境輪播 | |
| 外帶年菜 | `takeaway` | 外帶年菜卡片與分類篩選 | 販售中品項必須至少有一個 CTA |
| 餐廳內用 | `dining` | 日期／餐期餐價快查、包廂低消 | 十二廚春節僅電話訂位 |
| 宴會廳 | `banquet` | 除夕圍爐宴 | 目前狀態：已售完 |
| 館內活動 | `events` | 活動時間表 | 多數為「示意」 |
| 通路伴手禮 | `gifts` | 禮盒卡片、企業採購 | |
| 須知 FAQ | `faq` | 訂位與購買須知 | |
| 頁尾 | `footer` | 版權、商標、連結、社群、警語 | |
| 版本紀錄 | `data/revisions/` | — | 所有角色可看；發布者可「還原至草稿」 |
| 操作紀錄 | `data/audit.log` | — | 僅發布者可看 |

若日後新增未對應的頂層欄位，後台會自動顯示在「網站設定」模組，並可用「原始 JSON」編輯。

---

## 3. 資料模型

以下依 2026-10-23 的 `data/content.json` 實際欄位整理。「必填」指伺服器驗證會擋下的條件；其他欄位前台可能需要，但目前未強制。

### 3.1 頂層

必填鍵：`meta`、`brand`、`contacts`、`nav`、`hero`、`takeaway`、`dining`、`banquet`、`events`、`gifts`、`faq`、`footer`（`nav` 為陣列，其他為物件）。`ctaTypes` 雖不在清單內，但只要文件中有任何 CTA 就必須存在。整份文件不得超過 2 MB。

### 3.2 meta（網站設定）

| 欄位 | 型別 | 必填 | 說明 |
|---|---|---|---|
| siteVersion | string | | 網站版本字串 |
| revision | integer | 系統 | 發布版本號，伺服器在發布時遞增 |
| updatedAt | string（ISO 8601，+08:00） | 系統 | 最後儲存／發布時間 |
| updatedBy | string | 系統 | 最後操作角色（editor / publisher） |
| stage | string | | 前台階段標記（例：preview），伺服器不會改動 |
| noindex | boolean | | 是否禁止搜尋引擎索引 |
| title / description | string | | 頁面標題與描述 |

### 3.3 brand（品牌 CIS）

| 欄位 | 型別 | 必填 | 說明 |
|---|---|---|---|
| note | string | | 色彩來源與核准狀態說明 |
| approvedPalette[] | array | ✔（非空） | 核准色盤：`name`、`hex`（#RRGGBB，✔）、`source` |
| tokens | object | ✔ | 色彩代號 → 色碼；**每個值都必須存在於 approvedPalette**（不分大小寫）。目前代號：ink、white、champagne、muted、linen、crimson、night、red、ivory、gold |
| fonts | object | | `serif`、`serifWeights[]`、`serifLicense`、`sans` |
| logo | object | | `onDark`、`onLight`（圖片路徑）、`alt`、`rules[]` |

### 3.4 contacts（聯絡資訊）

| 欄位 | 型別 | 說明 |
|---|---|---|
| main / lounge | object | `label`、`tel`（+886 格式，有值時驗證）、`display`（顯示用號碼） |
| fax、email、address、taxId | string | |

### 3.5 nav（導覽列）

陣列，每項 `id`（同時作為頁內錨點 id）、`label`。CTA 類型 `anchor` 的 `target` 必須是其中一個 `id`。

### 3.6 ctaTypes（CTA 類型）

物件，鍵為類型代碼：`phone`、`booking`、`buy`、`inquiry`、`link`、`anchor`；每項含 `label`、`icon`、`note`。

### 3.7 CTA 物件（任何名為 `ctas` 的陣列）

| 欄位 | 型別 | 必填 | 說明 |
|---|---|---|---|
| type | string | ✔ | 必須是 ctaTypes 的鍵 |
| label | string | | 按鈕文字 |
| tel | string | phone / inquiry 時 ✔ | `^\+886\d{8,9}$` |
| url | string | booking / buy / link 時 ✔ | 必須以 `https://` 開頭 |
| target | string | anchor 時 ✔ | 必須是 nav 的 id |
| note | string | | 補充文字（例：轉宴會業務部） |
| preset | object | | 錨點預設值（例：`{date, meal}`） |

### 3.8 hero（首頁 Banner）

| 欄位 | 型別 | 說明 |
|---|---|---|
| eyebrow | string | 眉標 |
| title | string[] | 主標（分行） |
| lead | string | 引言 |
| image / imageAlt / imageStatus | string | 圖片；有圖時 `imageAlt` 必填；`imageStatus` 見 §6 |
| scenes[] | array | `kicker`、`title`、`text`、`target` |

### 3.9 takeaway（外帶年菜）與 gifts（通路伴手禮）

共通：`title`、`lead`；`items[]` 為品項。

| 品項欄位 | 型別 | 必填 | 說明 |
|---|---|---|---|
| id | string | | 唯一識別碼 |
| status | string | ✔ | `onsale` 販售中、`coming` 即將公布、`soldout` 已售完、`confirmed` 已確認、`sample` 示意、`hidden` 隱藏（前台不顯示） |
| venue、name、tag、serve、spec、desc | string | | 品項資訊 |
| price、originalPrice | number | | 新台幣 |
| priceNote、notes、pickup、seal | string | | 價格說明、注意事項、提貨資訊、無圖時的印章字 |
| periods[] | array | | `label`、`value`（外帶年菜） |
| menu[] | string[] | | 菜色 |
| category | string | | takeaway：對應 `categories[].id` |
| channels[] | string[] | | gifts：對應 `gifts.channels[].id` |
| featured | boolean | | 精選 |
| image / imageAlt / imageStatus | string | | 見 §6 |
| officialImage | string | | 官網圖片網址（授權待確認時僅作參考） |
| ctas[] | array | onsale 時 ≥ 1 | 見 §3.7 |
| source / verify | string | | 資料來源 / 待確認事項（後台以「校稿備註」醒目顯示） |

其他：`takeaway.categories[]`（`id`、`label`）；`gifts.channels[]`（`id`、`label`、`url`）；`gifts.corporate`（`title`、`text`、`ctas`）。

### 3.10 dining（餐廳內用）

| 欄位 | 型別 | 說明 |
|---|---|---|
| restaurants[] | array | `id`、`name`、`type`、`booking{url, cnyPhoneOnly}`、`tel`、`telDisplay`、`page` |
| dates[] | array | `id`（MMDD）、`md`、`wd`、`lunar` |
| meals[] | array | `id`、`label` |
| defaultDate / defaultMeal | string | 預設選取 |
| offers[] | array | `id`、`restaurant`（✔ 須對應餐廳 id）、`title`、`dates[]`、`meal`、`slots[]{time, adult, child}`、`note`、`deposit`、`extra`、`booking`（✔ `phone` 或 `online`）、`bookingNote`、`bookingTel`、`noDiscount` |
| discounts | object | 日期 id → 優惠說明 |
| rooms | object | `title`、`columns[]`、`rows[][]`、`verify` |
| source / verify | string | |

### 3.11 banquet（宴會廳）

`status`、`title`、`venue`、`date`、`statusLabel`、`text`、`prices[]{label, value, verify}`、`menu[]`、`ctas[]`、`source`。

### 3.12 events（館內活動）

`title`、`lead`、`days[]{id, label}`、`items[]{id, status, days[], time, place, title, desc, image, imageStatus, tag, ctas[]}`、`verify`。

### 3.13 faq 與 footer

- `faq`：`title`、`items[]{q, a, verify}`。
- `footer`：`company`、`hotel`、`copyright`、`trademark`、`links[]{label, url}`、`social[]{id, label, url}`、`legal`、`drinkWarning`。

### 3.14 全文件通用驗證

- 任何名為 `url` 的欄位：留空或 `https://` 開頭（防止 `javascript:` 等連結）。
- 任何名為 `tel`、`bookingTel` 的欄位：留空或 `+886` 國際格式。
- 任何名為 `status` 的欄位：必須是 §3.9 的六種狀態之一。
- 任何名為 `imageStatus` 的欄位：`official`、`reference`、`placeholder`、`none`。
- 任何名為 `image`、`onDark`、`onLight` 的欄位：留空、`assets/` 底下的相對路徑（不可含 `..`），或 `https://` 網址。

---

## 4. CTA 規則

| 情境 | CTA 類型 | 規則 |
|---|---|---|
| 電話訂購 | `phone` | `tel` 必填，國際格式 `+886…`；畫面顯示號碼放在 `note` 或 `display` |
| 電話洽詢 | `inquiry` | 同上；用於「即將公布」品項、企業採購 |
| 線上訂位 | `booking` | `url` 必填且為 https（例：TableCheck） |
| 線上購買 | `buy` | `url` 必填且為 https（官方線上購物） |
| 了解更多 | `link` | `url` 必填且為 https（官網頁面） |
| 頁內錨點 | `anchor` | `target` 必須是導覽列 `nav` 的 id；可帶 `preset` |

業務規則（伺服器與後台皆會檢查）：

1. **販售中（onsale）的外帶年菜與伴手禮至少要有一個 CTA。**
2. **十二廚除夕及春節只能電話訂位**：`dining.restaurants` 中 `booking.cnyPhoneOnly = true` 的餐廳，其所有 `offers[].booking` 必須是 `phone`（依 `dining.verify` 所述 MEMO 內容）。
3. **已售完（soldout）的項目不得出現「線上購買（buy）」按鈕**；可改放錨點導引至其他選項（如目前宴會廳的做法）。
4. 狀態為 `hidden` 的項目前台不顯示，可用來暫存未公開內容。

---

## 5. CIS 與資料庫一致的機制

1. **單一來源**：所有色彩只寫在 `brand.tokens`，前台以 CSS 變數讀取（例：`--ink`、`--crimson`），不在 CSS 內硬寫色碼。
2. **只能選核准色**：後台的色彩欄位是下拉選單，選項只來自 `brand.approvedPalette`，並顯示色塊；若資料中出現不在色盤的值，會標示「不在核准色盤」。
3. **伺服端驗證**：`PUT /api/draft` 與 `POST /api/publish` 會檢查每個 token 值是否存在於 approvedPalette（不分大小寫），不符即回 422，無法存檔或發布。
4. **對比度檢查**：品牌模組即時計算 WCAG 對比度（墨色／暖象牙、白／深緋紅、香檳／夜緋紅），一般文字需 ≥ 4.5:1。
5. **色盤治理**：approvedPalette 中標示「2027 活動提案色（待核准）」者仍待品牌窗口核准。新增或修改核准色應先取得品牌核准，再由發布者調整；建議正式環境把色盤編輯權限限縮給發布者或品牌管理者。

---

## 6. 角色權限與審核發布流程

| 能力 | 編輯者（editor） | 發布者（publisher） |
|---|---|---|
| 讀取草稿、預覽 | ✔ | ✔ |
| 儲存草稿 | ✔ | ✔ |
| 上傳圖片 | ✔ | ✔ |
| 檢視版本紀錄 | ✔ | ✔ |
| 發布 | | ✔ |
| 還原版本至草稿 | | ✔ |
| 檢視操作紀錄 | | ✔ |

**流程**

1. **編輯**：編輯者登入後台修改內容，表單即時驗證並列出錯誤（點選可跳到欄位）。
2. **存草稿**：按「儲存草稿」→ `PUT /api/draft`，附 `If-Match`（草稿 ETag = 檔案內容 SHA-256）。若他人已先存檔，回 409，後台提示「重新載入」或「下載我的版本」，不會互相覆蓋。
3. **預覽**：按「預覽」開啟 `index.html?stage=draft`（桌機為右側窗格，手機為新分頁），前台以 `X-Admin-Token` 讀取草稿。預覽的是「已儲存」的草稿。
4. **發布**：發布者按「發布」，對話框列出與線上版本的差異數量與欄位 → `POST /api/publish`。伺服器再驗證一次，遞增 `meta.revision`，將草稿複製為 `content.json`，並存快照 `data/revisions/rev-N.json`。
5. **回滾**：在「版本紀錄」選擇版本 →「還原至草稿」，快照內容放回草稿（**不會直接上線**），確認後再次發布。
6. **稽核**：儲存、發布、還原、上傳、金鑰驗證失敗都會寫入 `data/audit.log`（時間、角色、動作、版本、說明）。

---

## 7. 圖片上傳規範

| 項目 | 規範 |
|---|---|
| 格式 | JPEG、PNG、WebP；伺服器以檔頭（magic bytes）判斷，不信任副檔名。SVG、GIF、HEIC 等一律拒絕（415） |
| 大小 | 單檔 ≤ 3 MB（超過回 413）。建議：主視覺寬 2400 px 以內、卡片 1200 px 以內，並先壓縮 |
| 存放 | `assets/uploads/<SHA-256 前 16 碼>.<副檔名>`，同內容不重複存檔、不會覆蓋他人檔案 |
| 替代文字 | 欄位有 `imageAlt` 時，設定圖片後必填；描述圖片內容，示意或往年影像需註明 |
| 授權狀態 `imageStatus` | `official` 正式（已取得授權）、`reference` 參考（往年或官網影像，授權待確認）、`placeholder` 示意、`none` 無圖 |
| 注意 | 上傳後檔案立即可從網站路徑存取（即使尚未發布）。未取得授權的影像不應上傳到正式環境 |

---

## 8. 安全

**本機版的限制（目前做法）**

- 只綁定 `127.0.0.1`，並檢查 `Host` 標頭（降低 DNS rebinding 風險）。不應改綁 `0.0.0.0` 或直接對外開放。
- 金鑰：首次啟動以 `secrets.token_urlsafe` 產生 editor / publisher 兩組金鑰，寫入 `.cms-tokens.json`（權限 600）並只在主控台顯示一次；比對使用 `hmac.compare_digest`。金鑰存在瀏覽器 `sessionStorage`，關閉分頁即清除。要更換金鑰：停止伺服器、刪除 `.cms-tokens.json` 後重新啟動。
- 靜態檔案拒絕存取（404）：`server.py` 與所有 `.py`、`data/draft.json`、`data/revisions/`、`data/audit.log`、`.cms-tokens.json` 及所有點開頭檔案；不提供目錄列表。
- 安全標頭：`X-Content-Type-Options: nosniff`、`Referrer-Policy: same-origin`；`/admin/` 另加 CSP（僅允許 self，字型／樣式另允許 fonts.googleapis.com / fonts.gstatic.com，圖片允許 self、https:、data:）。
- 寫檔一律「暫存檔 + `os.replace`」原子寫入，避免寫到一半損毀。
- 後台以 `textContent` 寫入資料，不使用 `innerHTML`；所有 `url` 欄位限 https，避免 `javascript:` 連結。
- 這是單機、少人使用的工具，**沒有**帳號系統、密碼原則、登入次數限制或 HTTPS。

**正式環境必要條件**

1. 全站 HTTPS（含後台與 API），HSTS。
2. 以 SSO（例如集團的 Azure AD / Entra ID、Google Workspace 或 Okta，依集團現況）登入，取代共用金鑰；每人一個帳號，角色由伺服端判斷。
3. 權限檢查一律在伺服端執行；前台公開內容與後台 API 分離（不同網域或路徑，並加 WAF / IP 限制）。
4. 稽核紀錄集中保存（不可被編輯者修改），定期檢視。
5. 備份與還原：每日備份內容與上傳檔案，至少每季做一次「還原演練」並記錄結果。
6. 依《個人資料保護法》：本網站目前不蒐集個資；若未來加入表單或會員功能，需另行評估告知義務、保存期限與存取控管。
7. 相依套件需鎖定版本並定期掃描弱點（例：`npm audit`、Dependabot）。

---

## 9. 本機啟動方式

需求：macOS / Windows / Linux，Python 3.9 以上（不需安裝其他套件）。

```bash
cd site-2027
python3 server.py --port 8777
# 或指定網站根目錄
python3 server.py --port 8777 --root /path/to/site-2027
```

- 首次啟動會在主控台印出 editor 與 publisher 金鑰（只顯示一次），請交給對應人員，勿貼到公開頻道或文件。
- 前台：`http://127.0.0.1:8777/`
- 後台：`http://127.0.0.1:8777/admin/`（貼上金鑰登入）
- 草稿預覽：`http://127.0.0.1:8777/index.html?stage=draft`（需在已登入後台的同一分頁或由後台開啟的分頁）
- 停止：在主控台按 `Ctrl + C`。

**API 一覽**

| 方法與路徑 | 權限 | 說明 |
|---|---|---|
| `GET /api/whoami` | editor+ | 回傳 `{role}` |
| `GET /api/content?stage=published` | 公開 | 已發布內容 |
| `GET /api/content?stage=draft` | editor+ | 草稿（回傳 `ETag`；不存在時由 content.json 複製） |
| `PUT /api/draft` | editor+ | 儲存草稿；需 `If-Match`，不符 409，驗證失敗 422 |
| `POST /api/publish` | publisher | 發布；可帶 `If-Match` |
| `GET /api/revisions` | editor+ | 版本清單 |
| `POST /api/rollback` `{revision}` | publisher | 快照還原至草稿 |
| `POST /api/upload` | editor+ | 原始檔案本文 + `X-Filename`；回 `{path}` |
| `GET /api/audit` | publisher | 最近 100 筆操作紀錄 |

---

## 10. 正式上線的後端選型建議

> 下表授權資訊依撰寫者既有知識整理，**未於撰寫時上網查證目前版本與授權條款**。選型時請至各專案官方網站與原始碼庫重新確認版本、授權、維護狀態與已知弱點（CVE），並由法務確認商用條件。

| 方案 | 類型 | 授權（需再查證） | 商用注意事項 | 適合情境 |
|---|---|---|---|---|
| Strapi | Node.js Headless CMS，自架 | Community Edition 為 MIT；部分企業功能（如進階 SSO、稽核紀錄）屬付費 Enterprise 授權 | MIT 可商用；若需要 SSO / 稽核等功能，需確認是否落在付費版 | 需要完整後台、角色權限、REST/GraphQL API |
| Payload CMS | Node.js / TypeScript Headless CMS，自架 | MIT | MIT 可商用 | 團隊熟悉 TypeScript，想以程式碼定義資料模型（可直接對應本專案 content.json 結構） |
| Directus | 資料庫優先的 Headless CMS，自架 | **BSL 1.1（Business Source License）** | **有商用限制**：依其授權條款，年度營收／資金超過一定門檻（據了解為 500 萬美元）的組織用於正式環境需購買商業授權；集團規模很可能超過門檻，選用前務必請法務確認 | 已有 SQL 資料庫、需要資料表式管理 |
| Decap CMS（前身 Netlify CMS） | Git-based CMS，內容存在 Git | MIT | MIT 可商用；需搭配 Git 平台與驗證服務 | 保持純靜態網站、內容版本由 Git 管理、編輯人數少 |

**建議方向**（供討論，非最終決定）：

- 若希望維持「靜態網站 + JSON 單一來源」的架構，Decap CMS（Git 版本管理即快照與回滾）或 Payload CMS（以程式碼定義本專案的資料模型）較貼近現況。
- 不論選哪一套，都應把本文件 §3–§5 的驗證規則（CIS 色盤、CTA、狀態、圖片）實作在伺服端，而不只在前端表單。
- 選型前請 IT／資安確認：SSO 整合方式、主機與資料存放地點、備份機制、弱點更新流程。

---

## 11. 待辦與風險

**待辦**

1. 品牌窗口核准 2027 活動提案色（深緋紅、夜緋紅、朱砂紅、暖象牙、金箔），核准後更新 `approvedPalette[].source`。
2. 取得 MAL 正式標誌檔（建議 SVG），確認安全空間規範。
3. 逐項清除內容中的 `verify` 待確認事項（後台以「校稿備註」顯示），例如宴會廳六人桌價格、包廂低消所屬餐廳、取消規定日期等。
4. 影像授權確認後，將 `imageStatus` 由 `reference` / `placeholder` 改為 `official`。
5. 正式環境選型、SSO、HTTPS、備份還原演練。
6. 與前台工程師確認：`hidden` 狀態不渲染、`?stage=draft` 預覽時顯示「草稿」標記、前台以 CSS 變數讀取 `brand.tokens`。

**風險**

| 風險 | 影響 | 因應 |
|---|---|---|
| 本機版使用共用金鑰，無個人帳號 | 無法追溯到個人；金鑰外流即可操作 | 只在本機使用；外流時刪除 `.cms-tokens.json` 重新產生；正式環境改 SSO |
| 上傳圖片在發布前即可被存取 | 未公開影像可能被看到 | 本機版僅限本機；正式環境把上傳區與公開區分開 |
| 授權未確認的影像被發布 | 著作權爭議 | 以 `imageStatus` 標示，發布前檢查非 `official` 的影像 |
| 多人同時編輯 | 互相覆蓋 | 已用 ETag / If-Match（409）防止；仍建議分工編輯不同模組 |
| 驗證規則只涵蓋已知欄位 | 新欄位可能未被檢查 | 新增欄位時同步更新 `server.py` 與 `admin.js` 的驗證 |
| Directus 等 BSL 授權產品 | 可能需付費商業授權 | 選型時由法務確認（本文件非法律意見） |
