#!/bin/sh
# 台北喜來登 2027 新春網站｜GCP 設定：建置權限＋費用上限（每專案 NT$300，達 100% 自動停用計費）
# 由專案擁有者執行：sh deploy/gcp/setup.sh
set -e
G=${GCLOUD:-gcloud}
WEB=sheraton-cny-2027-web
DEMO=sheraton-cny-2027-demo
BILLING=${BILLING_ACCOUNT:?請先設定帳單帳戶 ID，例如 BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX sh deploy/gcp/setup.sh（可用 gcloud billing accounts list 查詢）}
REGION=asia-east1
LIMIT=300
HERE=$(cd "$(dirname "$0")" && pwd)

echo "1/5 建置權限（Cloud Run 原始碼部署）"
for P in $WEB $DEMO; do
  N=$($G projects describe $P --format="value(projectNumber)")
  $G projects add-iam-policy-binding $P --member="serviceAccount:$N-compute@developer.gserviceaccount.com" --role="roles/run.builder" --condition=None --format=none
done

echo "2/5 啟用服務"
$G services enable cloudfunctions.googleapis.com eventarc.googleapis.com pubsub.googleapis.com cloudbilling.googleapis.com billingbudgets.googleapis.com run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project $WEB

echo "3/5 Pub/Sub 主題與專用服務帳號"
$G pubsub topics describe sheraton-cny-budget --project $WEB >/dev/null 2>&1 || $G pubsub topics create sheraton-cny-budget --project $WEB
$G iam service-accounts describe billing-cap@$WEB.iam.gserviceaccount.com --project $WEB >/dev/null 2>&1 || \
  $G iam service-accounts create billing-cap --project $WEB --display-name="費用上限：超支自動停用計費"
for P in $WEB $DEMO; do
  for R in roles/billing.projectManager roles/browser; do
    $G projects add-iam-policy-binding $P --member="serviceAccount:billing-cap@$WEB.iam.gserviceaccount.com" --role=$R --condition=None --format=none
  done
done

echo "4/5 部署費用上限函式"
$G functions deploy sheraton-cny-billing-cap --gen2 --region=$REGION --project=$WEB --runtime=python312 \
  --source="$HERE/billing-cap" --entry-point=stop_billing --trigger-topic=sheraton-cny-budget \
  --service-account=billing-cap@$WEB.iam.gserviceaccount.com --max-instances=1 --memory=256Mi \
  --set-env-vars="^;^ALLOWED_PROJECTS=$WEB,$DEMO" --quiet

echo "5/5 建立預算（50%、90%、100% 通知；100% 自動停用計費）"
for P in $WEB $DEMO; do
  NAME="$P 上限 NT\$$LIMIT"
  if ! $G billing budgets list --billing-account=$BILLING --format="value(displayName)" | grep -qx "$NAME"; then
    N=$($G projects describe $P --format="value(projectNumber)")
    $G billing budgets create --billing-account=$BILLING --display-name="$NAME" --budget-amount=${LIMIT}TWD \
      --filter-projects=projects/$N --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0 \
      --notifications-rule-pubsub-topic=projects/$WEB/topics/sheraton-cny-budget
  fi
done
echo "完成"
