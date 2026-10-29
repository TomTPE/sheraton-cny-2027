"""預算達上限時自動停用 GCP 專案計費（與 ITF2026 相同機制）。

Cloud Billing 預算通知 → Pub/Sub → 本函式。
預算名稱開頭必須是專案 ID（例：「sheraton-cny-2027-web 上限 NT$300」），
且該專案在 ALLOWED_PROJECTS 白名單內，才會動作。
停用計費後，專案內所有付費服務（Cloud Run 等）會停止；恢復需由擁有者重新綁定帳單帳戶。
"""
import base64
import json
import os

import functions_framework
from google.cloud import billing_v1

ALLOWED = {p.strip() for p in os.environ.get("ALLOWED_PROJECTS", "").split(",") if p.strip()}


@functions_framework.cloud_event
def stop_billing(cloud_event):
    data = json.loads(base64.b64decode(cloud_event.data["message"]["data"]).decode("utf-8"))
    name = str(data.get("budgetDisplayName", ""))
    cost = float(data.get("costAmount", 0))
    budget = float(data.get("budgetAmount", 0))
    project = name.split(" ")[0] if name else ""
    print(json.dumps({"budget": name, "cost": cost, "limit": budget, "project": project}, ensure_ascii=False))
    if project not in ALLOWED:
        print("略過：專案不在白名單")
        return
    if budget <= 0 or cost < budget:
        print("未達上限，不動作")
        return
    client = billing_v1.CloudBillingClient()
    resource = "projects/" + project
    info = client.get_project_billing_info(name=resource)
    if not info.billing_enabled:
        print("計費已停用")
        return
    client.update_project_billing_info(name=resource, project_billing_info=billing_v1.ProjectBillingInfo(billing_account_name=""))
    print("已停用計費：" + project)
