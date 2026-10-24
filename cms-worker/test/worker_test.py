# 本機整合測試：先 `npx wrangler dev --local --port 8799`，並在本機 D1 建一個 admin 測試帳號，
# 把帳號密碼寫進一個 JSON 檔（{"username": "...", "password": "..."}，勿提交），再執行：
#   python3 -I test/worker_test.py <該 JSON 檔>
# .dev.vars 需設定 ALLOWED_ORIGINS="http://localhost:8777,https://tomtpe.github.io"
import json, sys, urllib.request, urllib.error
B='http://127.0.0.1:8799'; O='http://localhost:8777'
cred=json.load(open(sys.argv[1]))
def call(m, p, body=None, tok=None, origin=O):
    h={'Origin':origin}
    if tok: h['Authorization']='Bearer '+tok
    data=None
    if body is not None: h['Content-Type']='application/json'; data=json.dumps(body).encode()
    req=urllib.request.Request(B+p, data=data, method=m, headers=h)
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b'null'), dict(r.headers)
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null'), dict(e.headers)
ok=lambda c,msg: print(('PASS ' if c else 'FAIL ')+msg)
s,d,h=call('POST','/api/login',{'username':cred['username'],'password':'wrong-password'}); ok(s==401 and d['error']=='帳號或密碼錯誤','錯誤密碼 401 且訊息不洩漏帳號是否存在')
s,d,h=call('POST','/api/login',{'username':'nobody','password':'x'}); ok(s==401 and d['error']=='帳號或密碼錯誤','不存在帳號同樣訊息')
s,d,h=call('POST','/api/login',cred,origin='https://evil.example'); ok(s==403,'不允許的來源網域被拒')
s,d,h=call('POST','/api/login',cred); ok(s==200 and d['user']['role']=='admin' and len(d['token'])==64,'管理員登入成功'); A=d['token']
ok(h.get('Access-Control-Allow-Origin')==O,'CORS 只回應允許來源')
s,d,h=call('GET','/api/whoami',tok=A); ok(s==200 and d['role']=='admin','whoami')
s,d,h=call('GET','/api/users'); ok(s==401,'未登入不能看帳號')
s,d,h=call('POST','/api/users',{'username':'Amy Chen','role':'editor','password':'Abcdefgh1234!'},A); ok(s==422,'帳號格式錯誤被擋')
s,d,h=call('POST','/api/users',{'username':'amy.chen','role':'editor','password':'short1A!'},A); ok(s==422,'弱密碼被擋：'+str(d.get('error')))
TMP='Temp-Pass-2027!x'
s,d,h=call('POST','/api/users',{'username':'amy.chen','displayName':'陳小姐','role':'editor','password':TMP},A); ok(s==201,'建立編輯者')
s,d,h=call('POST','/api/users',{'username':'amy.chen','role':'editor','password':TMP},A); ok(s==409,'重複帳號被擋')
s,d,h=call('POST','/api/login',{'username':'amy.chen','password':TMP}); E=d['token']; ok(s==200 and d['user']['mustChange'],'新帳號登入需變更密碼')
s,d,h=call('GET','/api/content?stage=draft',tok=E); ok(s==403 and d.get('mustChange'),'未變更密碼前不能讀內容')
s,d,h=call('POST','/api/password',{'current':TMP,'next':'New-Pass-2027!yz'},E); ok(s==200,'變更密碼')
s,d,h=call('GET','/api/users',tok=E); ok(s==403,'編輯者不能管帳號')
s,d,h=call('POST','/api/publish',tok=E); ok(s==403,'編輯者不能發布')
s,d,h=call('GET','/api/users',tok=A); users={u['username']:u for u in d['users']}; ok(s==200 and 'amy.chen' in users,'管理員看到帳號清單')
uid=users['amy.chen']['id']; me=users[cred['username']]['id']
s,d,h=call('PATCH','/api/users/%d'%uid,{'role':'publisher'},A); ok(s==200,'改角色為發布者')
s,d,h=call('GET','/api/whoami',tok=E); ok(s==401,'改角色後舊登入失效')
for i in range(5): call('POST','/api/login',{'username':'amy.chen','password':'bad-%d'%i})
s,d,h=call('POST','/api/login',{'username':'amy.chen','password':'New-Pass-2027!yz'}); ok(s==423,'連錯 5 次後鎖定')
s,d,h=call('PATCH','/api/users/%d'%uid,{'unlock':True},A); ok(s==200,'管理員解除鎖定')
s,d,h=call('POST','/api/login',{'username':'amy.chen','password':'New-Pass-2027!yz'}); ok(s==200 and d['user']['role']=='publisher','解鎖後登入')
s,d,h=call('PATCH','/api/users/%d'%uid,{'disabled':True},A); ok(s==200,'停用帳號')
s,d,h=call('POST','/api/login',{'username':'amy.chen','password':'New-Pass-2027!yz'}); ok(s==403,'停用帳號不能登入')
s,d,h=call('PATCH','/api/users/%d'%me,{'role':'editor'},A); ok(s==422,'不能降低自己權限')
s,d,h=call('DELETE','/api/users/%d'%me,tok=A); ok(s==422,'不能刪除自己')
s,d,h=call('DELETE','/api/users/%d'%uid,tok=A); ok(s==200,'刪除帳號')
s,d,h=call('GET','/api/audit',tok=A); acts=[e['action'] for e in d['entries']]; ok(s==200 and {'login','login_fail','user_create','user_update','user_delete','password_change'}<=set(acts),'稽核紀錄完整：%d 筆'%len(acts))
s,d,h=call('POST','/api/logout',tok=A); s,d,h=call('GET','/api/whoami',tok=A); ok(s==401,'登出後權杖失效')
