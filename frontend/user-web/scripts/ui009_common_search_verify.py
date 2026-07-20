from __future__ import annotations
import base64, json, os, re, shutil, socket, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path
import requests
import websocket

ROOT=Path(r"D:\Project\MoaWorks")
BACKEND=ROOT/"backend"
os.chdir(ROOT)
sys.path.insert(0,str(BACKEND))
from app.services.postgres_service import PostgresService

RUN_ID=sys.argv[1] if len(sys.argv)>1 else f"verify.ui009.{int(time.time()*1000)}"
PASSWORD=sys.argv[2] if len(sys.argv)>2 else os.environ.get("MOAWORKS_TEST_PASSWORD")
if not PASSWORD: raise RuntimeError("password required")
VERIFY_PASSWORD="Vfy!Ui009-20260719"
API="http://127.0.0.1:8510/api/v1"
WEB="http://127.0.0.1:3520"
EVIDENCE=ROOT/"docs"/"evidence"/f"ui009-common-search-{RUN_ID}"
EVIDENCE.mkdir(parents=True,exist_ok=True)
PROGRESS=EVIDENCE/"progress.jsonl"
NETWORK=[]
REQUESTS={}
RESULT={"runId":RUN_ID,"status":"running","startedAt":time.strftime("%Y-%m-%dT%H:%M:%S%z"),"checks":{}}
STATE={"token":"","ids":{},"users":[],"roles":[]}

def redact(v,k=""):
    if re.search(r"token|authorization|cookie|password|secret",k,re.I): return "[REDACTED]"
    if isinstance(v,dict): return {a:redact(b,a) for a,b in v.items()}
    if isinstance(v,list): return [redact(x) for x in v]
    if isinstance(v,str):
        v=re.sub(r"Bearer\s+[\w.-]+","Bearer [REDACTED]",v,flags=re.I)
        return re.sub(r"([?&](?:token|access_token)=)[^&]+",r"\1[REDACTED]",v,flags=re.I)
    return v

def record(step,status,**details):
    with PROGRESS.open("a",encoding="utf-8") as f:
        f.write(json.dumps(redact({"at":time.time(),"step":step,"status":status,**details}),ensure_ascii=False)+"\n")

def step(name,fn):
    record(name,"start"); started=time.time()
    try:
        out=fn(); record(name,"success",elapsedMs=int((time.time()-started)*1000)); return out
    except Exception as e:
        record(name,"failure",elapsedMs=int((time.time()-started)*1000),message=str(e)); raise

def api(method,path,token=None,payload=None,files=None,timeout=20):
    headers={}
    if token: headers["Authorization"]="Bearer "+token
    response=requests.request(method,API+path,headers=headers,json=payload,files=files,timeout=timeout)
    try: body=response.json()
    except Exception: body={"text":response.text}
    return response.status_code,body

def must(method,path,token=None,payload=None,files=None,expected=(200,)):
    status,body=api(method,path,token,payload,files)
    if status not in expected: raise AssertionError(f"{path}:{status}:{body}")
    return body

def db_summary():
    ids=[value for value in STATE["ids"].values() if isinstance(value,str) and value]
    with PostgresService().connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT id,subject,status,deleted_at FROM mail_messages WHERE subject LIKE %s ORDER BY created_at",(RUN_ID+"%",)); mails=cursor.fetchall()
        cursor.execute("SELECT id,title,status FROM approval_documents WHERE title LIKE %s ORDER BY created_at",(RUN_ID+"%",)); approvals=cursor.fetchall()
        cursor.execute("SELECT id,room_name FROM messenger_rooms WHERE room_name LIKE %s ORDER BY created_at",(RUN_ID+"%",)); rooms=cursor.fetchall()
        cursor.execute("SELECT id,title,status FROM user_schedule_events WHERE title LIKE %s ORDER BY created_at",(RUN_ID+"%",)); schedules=cursor.fetchall()
        cursor.execute("SELECT id,name,status FROM personal_contacts WHERE name LIKE %s ORDER BY created_at",(RUN_ID+"%",)); contacts=cursor.fetchall()
        cursor.execute("SELECT id,file_name,status FROM workspace_files WHERE file_name LIKE %s ORDER BY created_at",(RUN_ID+"%",)); files=cursor.fetchall()
        if ids:
            cursor.execute("SELECT target_id,event,status_before,status_after FROM audit_logs WHERE target_id=ANY(%s) ORDER BY created_at",(ids,)); audit=cursor.fetchall()
        else: audit=[]
        cursor.execute("SELECT email,status FROM users WHERE email IN ('admin@moaworks.local','cyhuh@moaworks.local','ysla@moaworks.local') ORDER BY email"); protected=cursor.fetchall()
        cursor.execute("SELECT COUNT(*) AS count FROM users WHERE name LIKE %s AND status<>'deleted'",(RUN_ID+"%",)); active_users=cursor.fetchone()["count"]
        cursor.execute("SELECT COUNT(*) AS count FROM roles WHERE name LIKE %s AND status<>'deleted'",(RUN_ID+"%",)); active_roles=cursor.fetchone()["count"]
    return {"mails":mails,"approvals":approvals,"rooms":rooms,"schedules":schedules,"contacts":contacts,"files":files,"audit":audit,"protected":protected,"activeUsers":active_users,"activeRoles":active_roles}

def prepare():
    status,login=api("POST","/auth/login",payload={"email":"admin@moaworks.local","password":PASSWORD})
    assert status==200,status
    token=login["accessToken"]; STATE["token"]=token
    me=must("GET","/auth/me",token)
    mail=must("POST","/mail/send",token,{"to":["admin@moaworks.local"],"subject":RUN_ID+".mail","bodyText":RUN_ID+".mail.body"})
    STATE["ids"]["mail"]=mail["mailId"]
    approval=must("POST","/approvals",token,{"title":RUN_ID+".approval","content":RUN_ID+".approval.body","approverUserIds":[]})
    STATE["ids"]["approval"]=approval["documentId"]
    room=must("POST","/messenger/rooms",token,{"roomName":RUN_ID+".messenger","roomType":"group","participantUserIds":[]})
    STATE["ids"]["messenger"]=room["roomId"]
    now=time.time()+1800
    schedule=must("POST","/workspace/schedules",token,{"title":RUN_ID+".schedule","startsAt":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime(now)),"endsAt":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime(now+3600)),"description":RUN_ID+".schedule.body"})
    STATE["ids"]["schedule"]=schedule["id"]
    contact=must("POST","/workspace/contacts",token,{"name":RUN_ID+".contact","email":RUN_ID.replace(".","")+"@moaworks.local","phone":"010-0000-0000","companyName":"MoaWorks","memo":RUN_ID})
    STATE["ids"]["contacts"]=contact["id"]
    file_item=must("POST","/workspace/files",token,files={"file":(RUN_ID+".txt",RUN_ID.encode("utf-8"),"text/plain")})
    STATE["ids"]["files"]=file_item["id"]
    directory=must("GET","/admin/directory",token)
    department=next(x for x in directory["departments"] if x["status"]=="active")
    def create_role(suffix,permissions):
        item=must("POST","/admin/roles",token,{"name":RUN_ID+"."+suffix,"permissions":permissions}); STATE["roles"].append(item["id"]); return item
    forbidden_role=create_role("forbidden-role",["messenger:read"])
    inactive_user_role=create_role("inactive-user-role",["profile:read"])
    inactive_role=create_role("inactive-role",["profile:read"])
    def create_user(suffix,role_id,status_value):
        login_id="u9"+str(int(time.time()*1000))[-8:]+str(len(STATE["users"]))
        item=must("POST","/admin/users",token,{"name":RUN_ID+"."+suffix,"loginId":login_id,"password":VERIFY_PASSWORD,"departmentId":department["id"],"roleId":role_id,"status":status_value,"userType":"user"})
        STATE["users"].append(item["userId"])
        if status_value=="active": must("PATCH","/admin/users/"+item["userId"],token,{"password":VERIFY_PASSWORD})
        item["loginId"]=login_id
        return item
    forbidden=create_user("forbidden",forbidden_role["id"],"active")
    inactive_user=create_user("inactive-user",inactive_user_role["id"],"inactive")
    inactive_role_user=create_user("inactive-role-user",inactive_role["id"],"active")
    must("PATCH","/admin/roles/"+inactive_role["id"],token,{"status":"inactive"})
    return {"me":me,"forbidden":forbidden,"inactiveUser":inactive_user,"inactiveRoleUser":inactive_role_user}

class CDP:
    def __init__(self): self.n=0; self.ws=None
    def call(self,method,params=None,timeout=10):
        self.n+=1; target=self.n; self.ws.settimeout(timeout)
        self.ws.send(json.dumps({"id":target,"method":method,"params":params or {}}))
        while True:
            msg=json.loads(self.ws.recv())
            if msg.get("method")=="Network.requestWillBeSent":
                p=msg["params"]; req=p["request"]; REQUESTS[p["requestId"]]={"method":req["method"],"url":redact(req["url"])}
            elif msg.get("method")=="Network.responseReceived":
                p=msg["params"]; row=REQUESTS.get(p["requestId"])
                if row and "/api/v1/" in row["url"]:
                    NETWORK.append({**row,"status":p["response"]["status"]})
            if msg.get("id")==target:
                if "error" in msg: raise RuntimeError(msg["error"])
                return msg.get("result",{})
    def eval(self,expr,await_promise=False):
        result=self.call("Runtime.evaluate",{"expression":expr,"returnByValue":True,"awaitPromise":await_promise})
        return result.get("result",{}).get("value")
    def wait(self,expr,timeout=15):
        end=time.time()+timeout
        while time.time()<end:
            try:
                if self.eval(expr): return
            except Exception: pass
            time.sleep(.15)
        raise TimeoutError(expr)
    def click(self,expr):
        box=self.eval(f"""(()=>{{const e={expr};if(!e)return null;const r=e.getBoundingClientRect();return {{x:r.x+r.width/2,y:r.y+r.height/2}}}})()""")
        if not box: raise AssertionError("click target missing "+expr)
        for event,extra in [("mouseMoved",{}),("mousePressed",{"button":"left","clickCount":1}),("mouseReleased",{"button":"left","clickCount":1})]:
            self.call("Input.dispatchMouseEvent",{"type":event,"x":box["x"],"y":box["y"],**extra})
    def fill(self,expr,value):
        okay=self.eval(f"""(()=>{{const e={expr};if(!e)return false;const p=Object.getPrototypeOf(e);const setter=Object.getOwnPropertyDescriptor(p,'value')?.set;setter?setter.call(e,{json.dumps(value)}):e.value={json.dumps(value)};e.dispatchEvent(new Event('input',{{bubbles:true}}));e.dispatchEvent(new Event('change',{{bubbles:true}}));return true}})()""")
        if not okay: raise AssertionError("fill target missing "+expr)
    def key(self,key):
        virtual_key={"Escape":27}.get(key,0)
        payload={"key":key,"code":key,"windowsVirtualKeyCode":virtual_key,"nativeVirtualKeyCode":virtual_key}
        self.call("Input.dispatchKeyEvent",{"type":"keyDown",**payload})
        self.call("Input.dispatchKeyEvent",{"type":"keyUp",**payload})
    def screenshot(self,path):
        data=self.call("Page.captureScreenshot",{"format":"png"})["data"]; Path(path).write_bytes(base64.b64decode(data))

def launch_chrome():
    sock=socket.socket(); sock.bind(("127.0.0.1",0)); port=sock.getsockname()[1]; sock.close()
    profile=Path(tempfile.gettempdir())/f"ui009-{RUN_ID}"; shutil.rmtree(profile,ignore_errors=True)
    chrome=r"C:\Program Files\Google\Chrome\Application\chrome.exe"
    proc=subprocess.Popen([chrome,"--headless=new",f"--remote-debugging-port={port}","--remote-debugging-address=127.0.0.1","--remote-allow-origins=*",f"--user-data-dir={profile}","--no-first-run","--disable-gpu","about:blank"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    end=time.time()+10; info=None
    while time.time()<end:
        try: info=json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version",timeout=1)); break
        except Exception: time.sleep(.2)
    if not info: proc.kill(); raise RuntimeError("Chrome CDP startup timeout")
    pages=json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list",timeout=2)); page=next(x for x in pages if x["type"]=="page")
    cdp=CDP(); cdp.ws=websocket.create_connection(page["webSocketDebuggerUrl"],timeout=5,origin=f"http://127.0.0.1:{port}")
    for method in ["Page.enable","Runtime.enable","Network.enable"]: cdp.call(method)
    cdp.call("Emulation.setDeviceMetricsOverride",{"width":1920,"height":1080,"deviceScaleFactor":1,"mobile":False})
    return proc,profile,cdp

def login_ui(cdp,login_id,password):
    cdp.call("Page.navigate",{"url":WEB}); cdp.wait("document.readyState==='complete'||document.readyState==='interactive'")
    cdp.eval("localStorage.clear()"); cdp.call("Page.reload"); cdp.wait("!!document.querySelector('input[type=password]')",20)
    cdp.click("document.querySelector('input')")
    cdp.fill("document.querySelector('input')",login_id)
    cdp.click("document.querySelector('input[type=password]')")
    cdp.fill("document.querySelector('input[type=password]')",password)
    time.sleep(.2)
    cdp.click("[...document.querySelectorAll('button')].find(e=>e.type==='submit')")

def search_dialog(cdp,query):
    cdp.click("document.querySelector('.user-global-search')")
    cdp.fill("document.querySelector('.user-global-search')",query)
    cdp.wait("!!document.querySelector('.user-search-panel[role=dialog]')",15)

def search_result_expr(result_type,title):
    return f"""[...document.querySelectorAll('.user-search-result')].find(e=>e.querySelector('span')?.textContent.trim()==={json.dumps(result_type)}&&e.textContent.includes({json.dumps(title)}))"""

def verify_chrome(access):
    proc=profile=cdp=None
    try:
        proc,profile,cdp=launch_chrome(); login_ui(cdp,"admin",PASSWORD)
        cdp.wait("!!document.querySelector('.user-global-search')",25)
        cdp.call("Network.emulateNetworkConditions",{"offline":False,"latency":600,"downloadThroughput":-1,"uploadThroughput":-1})
        started=time.time(); search_dialog(cdp,RUN_ID+".schedule")
        cdp.wait("document.querySelector('.user-search-state')?.textContent.includes('검색 중')",5)
        debounce_ms=int((time.time()-started)*1000)
        cdp.call("Network.emulateNetworkConditions",{"offline":False,"latency":0,"downloadThroughput":-1,"uploadThroughput":-1})
        cdp.wait(f"!!({search_result_expr('schedule',RUN_ID+'.schedule')})",15)
        cdp.click("document.querySelector('.user-search-panel-header button')"); cdp.wait("!document.querySelector('.user-search-panel')")
        search_dialog(cdp,RUN_ID+".missing")
        cdp.wait("document.querySelector('.user-search-state')?.textContent.includes('검색 결과가 없습니다')",15)
        cdp.key("Escape"); cdp.wait("!document.querySelector('.user-search-panel')")
        targets=[
            ("mail",RUN_ID+".mail"),
            ("approval",RUN_ID+".approval"),
            ("messenger",RUN_ID+".messenger"),
            ("schedule",RUN_ID+".schedule"),
            ("contacts",RUN_ID+".contact"),
            ("files",RUN_ID+".txt"),
            ("org",access["me"]["user"]["userName"]),
        ]
        navigation={}
        previews={}
        for result_type,title in targets:
            search_dialog(cdp,title)
            filter_expr=f"document.querySelector('[data-search-filter={json.dumps(result_type)}]')"
            cdp.click(filter_expr)
            cdp.wait(f"{filter_expr}.getAttribute('aria-pressed')==='true'")
            result_expr=search_result_expr(result_type,title)
            cdp.wait(f"!!({result_expr})",20)
            previews[result_type]=cdp.eval(f"({result_expr}).textContent")
            cdp.click(result_expr)
            cdp.wait("!document.querySelector('.user-search-panel')",10)
            cdp.wait(f"[...document.querySelectorAll('h2')].some(e=>e.textContent.trim()==={json.dumps(title)})",25)
            navigation[result_type]=True
        search_dialog(cdp,RUN_ID)
        filter_count=cdp.eval("document.querySelectorAll('[data-search-filter]').length")
        assert filter_count==8,filter_count
        layout=cdp.eval("({width:innerWidth,height:innerHeight,pageHasScroll:document.documentElement.scrollHeight>document.documentElement.clientHeight,panel:document.querySelector('.user-search-panel').getBoundingClientRect().toJSON()})")
        assert layout["width"]==1920 and layout["height"]==1080 and not layout["pageHasScroll"],layout
        cdp.screenshot(EVIDENCE/"search-1920x1080.png")
        cdp.click("document.querySelector('.user-search-panel-header button')")
        messages={}
        login_ui(cdp,"admin","wrong-password-ui009"); cdp.wait("!!document.querySelector('[role=alert]')",15); messages["401"]=cdp.eval("document.querySelector('[role=alert]').textContent")
        login_ui(cdp,access["forbidden"]["loginId"],VERIFY_PASSWORD); cdp.wait("!!document.querySelector('.user-global-search')",25); search_dialog(cdp,RUN_ID)
        cdp.wait("!!document.querySelector('.user-search-panel [role=alert]')",25); messages["403"]=cdp.eval("document.querySelector('.user-search-panel [role=alert]').textContent"); cdp.screenshot(EVIDENCE/"search-403.png")
        login_ui(cdp,access["inactiveUser"]["loginId"],VERIFY_PASSWORD); cdp.wait("!!document.querySelector('[role=alert]')",15); messages["inactiveUser423"]=cdp.eval("document.querySelector('[role=alert]').textContent")
        login_ui(cdp,access["inactiveRoleUser"]["loginId"],VERIFY_PASSWORD); cdp.wait("!!document.querySelector('[role=alert]')",15); messages["inactiveRole423"]=cdp.eval("document.querySelector('[role=alert]').textContent")
        return {"debounceMs":debounce_ms,"filterCount":filter_count,"navigation":navigation,"previews":previews,"states":{"loading":True,"empty":True,"error":True,"close":True},"layout":layout,"accessScreens":messages}
    finally:
        if cdp and cdp.ws:
            try: (EVIDENCE/"dom.txt").write_text(str(cdp.eval("document.body.innerText")),encoding="utf-8")
            except Exception: pass
            cdp.ws.close()
        if proc:
            proc.kill(); proc.wait(timeout=5)
        if profile: shutil.rmtree(profile,ignore_errors=True)

def verify_api_db(access):
    status,_=api("GET","/workspace/files"); assert status==401,status
    status,_=api("POST","/auth/login",payload={"email":"admin@moaworks.local","password":"wrong-password-ui009"}); assert status==401,status
    status,login=api("POST","/auth/login",payload={"email":access["forbidden"]["loginId"]+"@moaworks.local","password":VERIFY_PASSWORD}); assert status==200,status
    status,_=api("GET","/workspace/files",login["accessToken"]); assert status==403,status
    status,_=api("POST","/auth/login",payload={"email":access["inactiveUser"]["loginId"]+"@moaworks.local","password":VERIFY_PASSWORD}); assert status==423,status
    status,_=api("POST","/auth/login",payload={"email":access["inactiveRoleUser"]["loginId"]+"@moaworks.local","password":VERIFY_PASSWORD}); assert status==423,status
    db=db_summary()
    assert all(db[k] for k in ["mails","approvals","rooms","schedules","contacts","files"]),db
    assert db["audit"],db
    assert sum(1 for x in db["protected"] if x["status"]=="active")==3
    api_network=[x for x in NETWORK if "/api/v1/" in x["url"]]
    assert api_network and all(x["url"].startswith(WEB+"/api/v1/") for x in api_network),api_network
    return {"access":{"401":401,"403":403,"inactiveUser":423,"inactiveRole":423},"db":db,"network":{"count":len(api_network),"allSameOrigin":True}}

def cleanup():
    errors=[]; token=STATE["token"]; ids=STATE["ids"]
    if ids.get("mail"):
        status,_=api("POST","/mail/bulk",token,{"mailIds":[ids["mail"]],"action":"delete","mailbox":"sent"})
        if status!=200: errors.append(f"mail:{status}")
    for key,path in [("schedule","/workspace/schedules/"),("contacts","/workspace/contacts/"),("files","/workspace/files/")]:
        if ids.get(key):
            status,_=api("DELETE",path+ids[key],token)
            if status not in (200,204): errors.append(f"{key}:{status}")
    for user_id in STATE["users"]:
        status,_=api("DELETE","/admin/users/"+user_id,token)
        if not 200<=status<300: errors.append(f"user:{status}")
    for role_id in STATE["roles"]:
        status,_=api("DELETE","/admin/roles/"+role_id,token)
        if not 200<=status<300: errors.append(f"role:{status}")
    with PostgresService().connect() as connection, connection.cursor() as cursor:
        cursor.execute("UPDATE mail_messages SET deleted_at=COALESCE(deleted_at,NOW()),updated_at=NOW() WHERE subject LIKE %s",(RUN_ID+"%",))
        cursor.execute("DELETE FROM approval_documents WHERE title LIKE %s",(RUN_ID+"%",))
        cursor.execute("DELETE FROM messenger_rooms WHERE room_name LIKE %s",(RUN_ID+"%",))
        cursor.execute("UPDATE user_schedule_events SET status='deleted',updated_at=NOW() WHERE title LIKE %s",(RUN_ID+"%",))
        cursor.execute("UPDATE personal_contacts SET status='deleted',updated_at=NOW() WHERE name LIKE %s",(RUN_ID+"%",))
        cursor.execute("UPDATE workspace_files SET status='deleted',updated_at=NOW() WHERE file_name LIKE %s",(RUN_ID+"%",))
        if ids:
            cursor.execute("DELETE FROM audit_logs WHERE target_id=ANY(%s)",([v for v in ids.values() if isinstance(v,str)],))
        connection.commit()
    db=db_summary()
    active=sum(1 for x in db["mails"] if x["deleted_at"] is None)+len(db["approvals"])+len(db["rooms"])+sum(1 for x in db["schedules"] if x["status"]!="deleted")+sum(1 for x in db["contacts"] if x["status"]!="deleted")+sum(1 for x in db["files"] if x["status"]!="deleted")
    assert not errors and active==0 and db["activeUsers"]==0 and db["activeRoles"]==0 and sum(1 for x in db["protected"] if x["status"]=="active")==3,{"errors":errors,"active":active,"db":db}
    return {"errors":errors,"activeRunData":active,"db":db}

access=None; failure=None
try:
    def g0():
        rows=[]
        for url in [API+"/health",WEB+"/api/v1/health"]:
            response=requests.get(url,timeout=10); body=response.json(); assert response.status_code==200 and body.get("initialized") is True,(url,response.status_code,body); rows.append({"url":url,"status":response.status_code,"initialized":body["initialized"]})
        return rows
    RESULT["checks"]["g0"]=step("g0",g0)
    access=step("prepare",prepare)
    RESULT["checks"]["chrome"]=step("chrome-search-access",lambda:verify_chrome(access))
    RESULT["checks"]["apiDbNetwork"]=step("api-db-network",lambda:verify_api_db(access))
    RESULT["status"]="passed"
except Exception as error:
    failure=error; RESULT["status"]="failed"; RESULT["error"]=str(error)
finally:
    try: RESULT["cleanup"]=step("cleanup",cleanup)
    except Exception as error:
        failure=failure or error; RESULT["status"]="failed"; RESULT["cleanup"]={"error":str(error)}
    RESULT["finishedAt"]=time.strftime("%Y-%m-%dT%H:%M:%S%z")
    (EVIDENCE/"network.json").write_text(json.dumps(redact(NETWORK),ensure_ascii=False,indent=2),encoding="utf-8")
    (EVIDENCE/"result.json").write_text(json.dumps(redact(RESULT),ensure_ascii=False,indent=2,default=str),encoding="utf-8")
if failure: raise failure
print(json.dumps({"runId":RUN_ID,"status":RESULT["status"],"evidenceDir":str(EVIDENCE)},ensure_ascii=False))
