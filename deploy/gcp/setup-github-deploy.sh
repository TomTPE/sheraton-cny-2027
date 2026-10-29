#!/bin/sh
# 讓 GitHub Actions 以「免金鑰」方式（Workload Identity Federation）部署到 Cloud Run。
# 只允許 TomTPE/sheraton-cny-2027 的 main 分支取得部署權限；不產生、不下載任何長期金鑰。
# 由 GCP 專案擁有者執行：GCLOUD=~/.local/bin/gcloud sh deploy/gcp/setup-github-deploy.sh
set -e
G=${GCLOUD:-gcloud}
P=sheraton-cny-2027-web
REPO=TomTPE/sheraton-cny-2027
POOL=github
PROVIDER=sheraton-cny-2027
SA=github-deployer@$P.iam.gserviceaccount.com
N=$($G projects describe $P --format="value(projectNumber)")

echo "1/4 啟用服務"
$G services enable iamcredentials.googleapis.com sts.googleapis.com iam.googleapis.com --project $P

echo "2/4 部署專用服務帳號（只有 Cloud Run 原始碼部署權限）"
$G iam service-accounts describe $SA --project $P >/dev/null 2>&1 || \
  $G iam service-accounts create github-deployer --project $P --display-name="GitHub Actions 部署 Cloud Run"
for R in roles/run.sourceDeveloper roles/serviceusage.serviceUsageConsumer; do
  $G projects add-iam-policy-binding $P --member="serviceAccount:$SA" --role=$R --condition=None --format=none
done
# 只允許以 Cloud Run 執行身分（預設運算服務帳號）部署，不給其他服務帳號
$G iam service-accounts add-iam-policy-binding $N-compute@developer.gserviceaccount.com --project $P \
  --member="serviceAccount:$SA" --role=roles/iam.serviceAccountUser --format=none

echo "3/4 Workload Identity Federation（只信任 $REPO 的 main 分支）"
$G iam workload-identity-pools describe $POOL --location=global --project $P >/dev/null 2>&1 || \
  $G iam workload-identity-pools create $POOL --location=global --project $P --display-name="GitHub Actions"
$G iam workload-identity-pools providers describe $PROVIDER --workload-identity-pool=$POOL --location=global --project $P >/dev/null 2>&1 || \
  $G iam workload-identity-pools providers create-oidc $PROVIDER --workload-identity-pool=$POOL --location=global --project $P \
    --display-name="sheraton-cny-2027 main" --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository=='$REPO' && assertion.ref=='refs/heads/main'"
$G iam service-accounts add-iam-policy-binding $SA --project $P --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$N/locations/global/workloadIdentityPools/$POOL/attribute.repository/$REPO" --format=none

echo "4/4 寫入 GitHub 儲存庫變數（非機密：只是資源名稱）"
WIF="projects/$N/locations/global/workloadIdentityPools/$POOL/providers/$PROVIDER"
GH=${GH:-gh}
$GH variable set GCP_WIF_PROVIDER -R $REPO --body "$WIF"
$GH variable set GCP_DEPLOY_SA -R $REPO --body "$SA"
$GH variable set GCP_PROJECT -R $REPO --body "$P"
echo "完成：之後推送到 main（含後台發布）會同時部署 GitHub Pages 與 Cloud Run"
