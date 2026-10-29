# 台北喜來登 2027 新春網站｜Cloud Run 靜態主機（nginx 官方穩定版）
# 用法見 deploy/cloud-run/README.md：先以 scripts/build.py 建置到 public/，再 gcloud run deploy --source
FROM nginx:1.30.6-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY public /usr/share/nginx/html
EXPOSE 8080
