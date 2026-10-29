# Cloud Run 部署（GCP）

| 項目 | 值 |
|---|---|
| GCP 專案 | `sheraton-cny-2027-web` |
| 服務 | `sheraton-cny-web`（asia-east1，台灣） |
| 主機 | nginx 1.30.6-alpine（BSD-2-Clause） |
| 存取 | 預設**不公開**；開放需由專案擁有者執行 IAM 指令 |

## 部署步驟
```bash
python3 scripts/build.py --env test --out /tmp/cr/public --with-admin --repo TomTPE/sheraton-cny-2027 --cms-api https://sheraton-cny-cms.sheraton-cny-cms-worker.workers.dev
python3 scripts/check_dist.py /tmp/cr/public --allow-admin
cp deploy/cloud-run/Dockerfile deploy/cloud-run/nginx.conf /tmp/cr/
gcloud run deploy sheraton-cny-web --source /tmp/cr --project sheraton-cny-2027-web --region asia-east1 --no-allow-unauthenticated --port 8080 --memory 256Mi --max-instances 5
```
- 正式上線時改用 `--env prod`（需先在後台關閉「禁止索引」並設定正式網址）。
- 後台發布只會自動更新 GitHub Pages；Cloud Run 版本需重新執行上述步驟，或另行設定 GitHub Actions 自動部署。
- Worker 的 `ALLOWED_ORIGINS`（cms-worker/wrangler.toml）需包含 Cloud Run 網址，後台才能登入。
