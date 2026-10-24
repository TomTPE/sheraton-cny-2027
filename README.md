# 台北喜來登 2027 新春餐飲網站（團圓有席）v2.0

2026-10-23 建置。資料驅動的靜態前台＋本機 CMS 後台；頁面帶 `noindex`，未發布。

## 結構
```
index.html              前台外殼（內容全部由資料渲染）
assets/css/site.css     手機優先樣式、金箔按鈕、絲緞／噪點材質
assets/js/site.js       內容渲染、CTA、查價、捲動敘事首屏、金箔微粒
assets/img/             料理照（往年，示意）、標誌、羊角雲紋底紋
assets/fake/            館內活動示意圖（SVG 假圖）
data/content.json       唯一資料來源（CIS tokens、內容、CTA、版本）
admin/                  CMS 後台
server.py               CMS 伺服器（Python 標準函式庫）
docs/                   資訊架構與設計規範、CMS 規劃
```

## 啟動
```bash
python3 server.py --port 8777
```
- 前台：http://127.0.0.1:8777/
- 後台：http://127.0.0.1:8777/admin/ （首次啟動會在終端機印出 editor／publisher 權杖）
- 校稿模式：網址加 `?review`；CMS 草稿預覽：`?stage=draft`
- 前台需經伺服器開啟（以 fetch 讀取 data/content.json），直接雙擊 index.html 會顯示載入失敗。

## 建置與部署
`python3 scripts/build.py --env test` 產生 `dist/`（排除後台、移除校稿欄位、強制 noindex）。部署方式與上線檢核見 [docs/上線部署規劃.md](docs/上線部署規劃.md)。

## 資料來源
| 內容 | 來源 |
|---|---|
| 吉羊納福冷凍年菜 | 台北喜來登官網年節專區（2026/10/23 讀取） |
| 金雪絮餅禮盒、線上購物連結 | 官網「線上禮遇．人氣伴手禮推薦」（2026/10/23 讀取） |
| 十二廚、大廳酒吧餐價、包廂、優惠、取消 | MEMO SFB-26-072（2026/08/18 簽核） |
| 宴會廳幸福啟航 | MEMO SMC-26-008；售完狀態由專案窗口告知（2026/10/23） |
| TableCheck 訂位連結、聯絡資訊、統編、社群、版權格式 | 官網餐廳頁與頁尾（2026/10/23 讀取） |
| 標誌使用規範 | Sheraton Digital Guidelines（2019） |
| 其他餐廳年菜與禮盒 | 2026 品項，僅列名稱規格，2027 待公布 |

未採用：礁溪寒沐、台北寒舍艾美（寒舍食譜）文件，屬其他飯店。

## 上線前須確認
執行 `?review` 查看完整清單。重點：宴會廳六人桌價格、包廂低消所屬餐廳、取消政策日期、吉羊納福宅配日期筆誤與正式圖片授權、金雪絮餅提貨期限、館內活動（除除夕晚會外皆示意）、所有示意圖替換、Google Fonts 對外連線、商標聲明文字（需法務確認）、正式部署與品牌發布授權。

## 雲端後台與資料盤點（2026-10-24）

- 雲端後台：https://tomtpe.github.io/sheraton-cny-2027/admin/（以 GitHub fine-grained token 登入）
- 資料來源、電話、訂位連結、照片、SEO 與 GA4 設定：見 [docs/資料盤點與雲端後台.md](docs/資料盤點與雲端後台.md)
- 本機後台（server.py）仍可使用，未設定 CMS_CONFIG 時自動使用本機 API。
