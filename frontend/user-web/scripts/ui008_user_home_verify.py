from __future__ import annotations
import base64, json, os, re, shutil, socket, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path
import requests
import websocket

ROOT=Path(r'D:\Project\MoaWorks'); BACKEND=ROOT/'backend'; sys.path.insert(0,str(BACKEND))
from app.services.postgres_service import PostgresService
RUN_ID=sys.argv[1] if len(sys.argv)>1 else f'verify.ui008.{int(time.time()*1000)}'
PASSWORD=sys.argv[2] if len(sys.argv)>2 else os.environ.get('MOAWORKS_TEST_PASSWORD')
if not PASSWORD: raise RuntimeError('password required')
VERIFY_PASSWORD='Vfy!Ui008-20260719'; API='http://127.0.0.1:8510/api/v1'; WEB='http://127.0.0.1:3520'
EVIDENCE=ROOT/'docs'/'evidence'/f'ui008-user-home-{RUN_ID}'; EVIDENCE.mkdir(parents=True,exist_ok=True)
PROGRESS=EVIDENCE/'progress.jsonl'; NETWORK=[]; RESULT={'runId':RUN_ID,'status':'running','startedAt':time.strftime('%Y-%m-%dT%H:%M:%S%z'),'checks':{}}
STATE={'token':'','scheduleId':'','noticeId':'ntc_'+RUN_ID.encode().hex()[-12:],'userIds':[],'roleIds':[]}
def redact(v,k=''):
 if re.search(r'token|authorization|cookie|password|secret',k,re.I): return '[REDACTED]'
 if isinstance(v,dict): return {a:redact(b,a) for a,b in v.items()}
 if isinstance(v,list): return [redact(x) for x in v]
 if isinstance(v,str): return re.sub(r'([?&](?:token|access_token)=)[^&]+',r'\1[REDACTED]',re.sub(r'Bearer\s+[\w.-]+','Bearer [REDACTED]',v,flags=re.I),flags=re.I)
 return v
def record(step,status,**details):
 with PROGRESS.open('a',encoding='utf-8') as f:f.write(json.dumps(redact({'at':time.time(),'step':step,'status':status,**details}),ensure_ascii=False)+'\n')
def step(name,fn):
 record(name,'start'); started=time.time()
 try:
  out=fn(); record(name,'success',elapsedMs=int((time.time()-started)*1000)); return out
 except Exception as e:
  record(name,'failure',elapsedMs=int((time.time()-started)*1000),message=str(e)); raise
def api(method,path,token=None,payload=None,timeout=20):
 h={};
 if token:h['Authorization']='Bearer '+token
 r=requests.request(method,API+path,headers=h,json=payload,timeout=timeout)
 try: body=r.json()
 except: body={'text':r.text}
 return r.status_code,body
def must(method,path,token=None,payload=None,expected=(200,)):
 status,body=api(method,path,token,payload)
 if status not in expected: raise AssertionError(f'{path}:{status}:{body}')
 return body
def db_seed_notice():
 with PostgresService().connect() as c:
  with c.cursor() as q:
   q.execute("SELECT company_id FROM users WHERE email='admin@moaworks.local'"); company=q.fetchone()['company_id']
   q.execute("INSERT INTO user_notices(id,company_id,title,content,author_name,status,published_at,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,'published',NOW(),NOW(),NOW())",(STATE['noticeId'],company,RUN_ID,RUN_ID+' notice body','UI-008 검수'))
  c.commit()
def db_evidence():
 with PostgresService().connect() as c:
  with c.cursor() as q:
   q.execute('SELECT id,title,status FROM user_notices WHERE id=%s',(STATE['noticeId'],)); notices=q.fetchall()
   q.execute('SELECT notice_id,user_id,read_at FROM user_notice_reads WHERE notice_id=%s',(STATE['noticeId'],)); reads=q.fetchall()
   q.execute('SELECT id,title,status FROM user_schedule_events WHERE id=%s',(STATE['scheduleId'],)); schedules=q.fetchall()
   q.execute('SELECT target_id,event,status_before,status_after FROM audit_logs WHERE target_id IN (%s,%s) ORDER BY created_at',(STATE['noticeId'],STATE['scheduleId'])); audit=q.fetchall()
   q.execute("SELECT email,status FROM users WHERE email IN ('admin@moaworks.local','cyhuh@moaworks.local','ysla@moaworks.local') ORDER BY email"); protected=q.fetchall()
   q.execute("SELECT COUNT(*) AS count FROM users WHERE name LIKE %s AND status<>'deleted'",(RUN_ID+'%',)); active_users=q.fetchone()['count']
   q.execute("SELECT COUNT(*) AS count FROM roles WHERE name LIKE %s AND status<>'deleted'",(RUN_ID+'%',)); active_roles=q.fetchone()['count']
 return {'notices':notices,'reads':reads,'schedules':schedules,'audit':audit,'protected':protected,'activeUsers':active_users,'activeRoles':active_roles}
def prepare():
 status,login=api('POST','/auth/login',payload={'email':'admin@moaworks.local','password':PASSWORD}); assert status==200,status
 STATE['token']=login['accessToken']; db_seed_notice()
 now=time.time()+1800; starts=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(now)); ends=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(now+3600))
 schedule=must('POST','/workspace/schedules',STATE['token'],{'title':RUN_ID,'startsAt':starts,'endsAt':ends,'description':RUN_ID}); STATE['scheduleId']=schedule['id']
 directory=must('GET','/admin/directory',STATE['token']); department=next(x for x in directory['departments'] if x['status']=='active')
 def role(suffix,permissions):
  item=must('POST','/admin/roles',STATE['token'],{'name':RUN_ID+'.'+suffix,'permissions':permissions}); STATE['roleIds'].append(item['id']); return item
 forbidden_role=role('forbidden-role',['messenger:read']); inactive_user_role=role('inactive-user-role',['profile:read']); inactive_role=role('inactive-role',['profile:read'])
 def user(suffix,role_id,status):
  login_id='u8'+str(int(time.time()*1000))[-8:]+str(len(STATE['userIds']))
  item=must('POST','/admin/users',STATE['token'],{'name':RUN_ID+'.'+suffix,'loginId':login_id,'password':VERIFY_PASSWORD,'departmentId':department['id'],'roleId':role_id,'status':status,'userType':'user'}); STATE['userIds'].append(item['userId'])
  if status=='active': must('PATCH','/admin/users/'+item['userId'],STATE['token'],{'password':VERIFY_PASSWORD})
  item['loginId']=login_id; return item
 forbidden=user('forbidden',forbidden_role['id'],'active'); inactive_user=user('inactive-user',inactive_user_role['id'],'inactive'); inactive_role_user=user('inactive-role',inactive_role['id'],'active')
 must('PATCH','/admin/roles/'+inactive_role['id'],STATE['token'],{'status':'inactive'})
 return {'forbidden':forbidden,'inactiveUser':inactive_user,'inactiveRoleUser':inactive_role_user}

class CDP:
 def __init__(self): self.n=0; self.ws=None
 def call(self,method,params=None,timeout=10):
  self.n+=1; target=self.n; self.ws.settimeout(timeout); self.ws.send(json.dumps({'id':target,'method':method,'params':params or {}}))
  while True:
   msg=json.loads(self.ws.recv())
   if msg.get('method')=='Network.requestWillBeSent':
    req=msg['params']['request']; u=req['url']
    if '/api/v1/' in u: NETWORK.append({'method':req['method'],'url':redact(u)})
   if msg.get('id')==target:
    if 'error' in msg: raise RuntimeError(msg['error'])
    return msg.get('result',{})
 def eval(self,expr,await_promise=False):
  r=self.call('Runtime.evaluate',{'expression':expr,'returnByValue':True,'awaitPromise':await_promise}); return r.get('result',{}).get('value')
 def wait(self,expr,timeout=15):
  end=time.time()+timeout
  while time.time()<end:
   try:
    if self.eval(expr): return
   except: pass
   time.sleep(.2)
  raise TimeoutError(expr)
 def click(self,expr):
  box=self.eval(f'''(()=>{{const e={expr};if(!e)return null;const r=e.getBoundingClientRect();return {{x:r.x+r.width/2,y:r.y+r.height/2}}}})()''');
  if not box: raise AssertionError('click target missing '+expr)
  for typ,extra in [('mouseMoved',{}),('mousePressed',{'button':'left','clickCount':1}),('mouseReleased',{'button':'left','clickCount':1})]: self.call('Input.dispatchMouseEvent',{'type':typ,'x':box['x'],'y':box['y'],**extra})
 def fill(self,expr,value):
  self.eval(f'''(()=>{{const e={expr};if(!e)return false;const p=Object.getPrototypeOf(e);const s=Object.getOwnPropertyDescriptor(p,'value')?.set;s?s.call(e,{json.dumps(value)}):e.value={json.dumps(value)};e.dispatchEvent(new Event('input',{{bubbles:true}}));e.dispatchEvent(new Event('change',{{bubbles:true}}));return true}})()''')
 def screenshot(self,path):
  data=self.call('Page.captureScreenshot',{'format':'png'})['data']; Path(path).write_bytes(base64.b64decode(data))

def button_expr(pattern):
 return f'''[...document.querySelectorAll('button')].find(e=>/{pattern}/i.test((e.getAttribute('aria-label')||'')+' '+(e.textContent||'')))'''
def login_ui(cdp,login_id,password):
 cdp.call('Page.navigate',{'url':WEB}); cdp.wait("document.readyState==='complete'||document.readyState==='interactive'"); cdp.eval('localStorage.clear()'); cdp.call('Page.reload'); cdp.wait("!!document.querySelector('input[type=password]')",20)
 cdp.fill("document.querySelector('input')",login_id); cdp.fill("document.querySelector('input[type=password]')",password); cdp.click(button_expr('로그인'))
def launch_chrome():
 sock=socket.socket(); sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]; sock.close(); profile=Path(tempfile.gettempdir())/f'ui008-{RUN_ID}'; shutil.rmtree(profile,ignore_errors=True)
 chrome=r'C:\Program Files\Google\Chrome\Application\chrome.exe'; proc=subprocess.Popen([chrome,'--headless=new',f'--remote-debugging-port={port}','--remote-debugging-address=127.0.0.1','--remote-allow-origins=*',f'--user-data-dir={profile}','--no-first-run','--disable-gpu','about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 end=time.time()+10; info=None
 while time.time()<end:
  try: info=json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json/version',timeout=1)); break
  except: time.sleep(.2)
 if not info: proc.kill(); raise RuntimeError('Chrome CDP startup timeout')
 pages=json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json/list',timeout=2)); page=next(x for x in pages if x['type']=='page')
 cdp=CDP(); cdp.ws=websocket.create_connection(page['webSocketDebuggerUrl'],timeout=5,origin=f'http://127.0.0.1:{port}'); cdp.call('Page.enable'); cdp.call('Runtime.enable'); cdp.call('Network.enable'); cdp.call('Emulation.setDeviceMetricsOverride',{'width':1920,'height':1080,'deviceScaleFactor':1,'mobile':False})
 return proc,profile,cdp

def chrome_check(access):
 proc=profile=cdp=None
 try:
  proc,profile,cdp=launch_chrome(); login_ui(cdp,'admin',PASSWORD); cdp.wait("document.querySelectorAll('[data-home-card]').length===5",25)
  keys=cdp.eval("[...document.querySelectorAll('[data-home-card]')].map(e=>e.dataset.homeCard)"); assert set(keys)=={'mail','approval','schedule','messenger','notices'},keys
  home_button="document.querySelectorAll('.user-app-rail-item')[0]"
  notice_button=f'''[...document.querySelectorAll('[data-home-card="notices"] .ui008-home-items button')].find(e=>e.textContent.includes({json.dumps(RUN_ID)}))'''; cdp.wait(f'!!({notice_button})'); cdp.click(notice_button); cdp.wait(f'''[...document.querySelectorAll('h2')].some(e=>e.textContent.trim()==={json.dumps(RUN_ID)})''')
  cdp.click(home_button); cdp.wait("document.querySelectorAll('[data-home-card]').length===5")
  schedule_button=f'''[...document.querySelectorAll('[data-home-card="schedule"] .ui008-home-items button')].find(e=>e.textContent.includes({json.dumps(RUN_ID)}))'''; cdp.wait(f'!!({schedule_button})'); cdp.click(schedule_button); cdp.wait(f'''[...document.querySelectorAll('h2')].some(e=>e.textContent.trim()==={json.dumps(RUN_ID)})''')
  for key,label in [('mail','메일'),('approval','결재'),('messenger','메신저')]:
   cdp.click(home_button); cdp.wait("document.querySelectorAll('[data-home-card]').length===5"); cdp.click(f'''document.querySelector('[data-home-card="{key}"] > header button')'''); cdp.wait("!!document.querySelector('.user-app-rail-item[aria-current=\"page\"]')"); active=cdp.eval("document.querySelector('.user-app-rail-item[aria-current=\"page\"]').textContent"); assert label in active,(key,active)
  cdp.click(home_button); cdp.wait("document.querySelectorAll('[data-home-card]').length===5")
  cdp.fill("document.querySelector('.user-global-search')",'admin'); cdp.wait("!!document.querySelector('[role=dialog]')",10); cdp.fill("document.querySelector('.user-global-search')",'')
  cdp.click("document.querySelector('.user-notification-entry')"); cdp.wait("!!document.querySelector('[role=dialog]')"); cdp.click("document.querySelector('.user-notification-entry')")
  layout=cdp.eval("({width:innerWidth,height:innerHeight,pageHasScroll:document.documentElement.scrollHeight>document.documentElement.clientHeight,cards:[...document.querySelectorAll('[data-home-card]')].map(e=>({key:e.dataset.homeCard,rect:e.getBoundingClientRect().toJSON()}))})"); assert layout['width']==1920 and layout['height']==1080 and not layout['pageHasScroll'],layout
  cdp.screenshot(EVIDENCE/'home-1920x1080.png')
  messages={}
  login_ui(cdp,'admin','wrong-password-ui008'); cdp.wait("document.querySelector('[role=alert]')?.textContent.includes('비밀번호')",15); messages['401']=cdp.eval("document.querySelector('[role=alert]').textContent")
  login_ui(cdp,access['forbidden']['loginId'],VERIFY_PASSWORD); cdp.wait("document.querySelector('[role=alert]')?.textContent.includes('권한')",25); messages['403']=cdp.eval("document.querySelector('[role=alert]').textContent"); cdp.screenshot(EVIDENCE/'access-403.png')
  login_ui(cdp,access['inactiveUser']['loginId'],VERIFY_PASSWORD); cdp.wait("document.querySelector('[role=alert]')?.textContent.includes('비활성화된 사용자')",15); messages['inactiveUser423']=cdp.eval("document.querySelector('[role=alert]').textContent")
  login_ui(cdp,access['inactiveRoleUser']['loginId'],VERIFY_PASSWORD); cdp.wait("document.querySelector('[role=alert]')?.textContent.includes('권한 역할이 비활성화')",15); messages['inactiveRole423']=cdp.eval("document.querySelector('[role=alert]').textContent")
  return {'cards':keys,'layout':layout,'navigation':True,'search':True,'notifications':True,'accessScreens':messages}
 finally:
  if cdp and cdp.ws:
   (EVIDENCE/'dom.txt').write_text(str(cdp.eval('document.body.innerText')),encoding='utf-8')
   cdp.ws.close()
  if proc:
   proc.kill(); proc.wait(timeout=5)
  if profile: shutil.rmtree(profile,ignore_errors=True)

def cleanup():
 errors=[]
 if STATE['scheduleId']:
  s,_=api('DELETE','/workspace/schedules/'+STATE['scheduleId'],STATE['token']);
  if s!=204: errors.append(f'schedule:{s}')
 for i in STATE['userIds']:
  s,_=api('DELETE','/admin/users/'+i,STATE['token']);
  if not 200<=s<300: errors.append(f'user:{i}:{s}')
 for i in STATE['roleIds']:
  s,_=api('DELETE','/admin/roles/'+i,STATE['token']);
  if not 200<=s<300: errors.append(f'role:{i}:{s}')
 with PostgresService().connect() as c:
  with c.cursor() as q:q.execute("UPDATE user_notices SET status='deleted',updated_at=NOW() WHERE id=%s",(STATE['noticeId'],))
  c.commit()
 return {'errors':errors,'db':db_evidence()}

access=None; failure=None
try:
 step('g0',lambda:[(lambda r: (_ for _ in ()).throw(AssertionError((u,r.status_code))) if not(r.status_code==200 and r.json().get('initialized') is True) else None)(requests.get(u,timeout=15)) for u in [API+'/health',WEB+'/api/v1/health']]); RESULT['checks']['g0']=True
 access=step('prepare',prepare)
 RESULT['checks']['chrome']=step('chrome-home-access',lambda:chrome_check(access))
 def verify_api_db():
  s,_=api('GET','/workspace/notices'); assert s==401,s
  s,_=api('POST','/auth/login',payload={'email':'admin@moaworks.local','password':'wrong-password-ui008'}); assert s==401,s
  s,l=api('POST','/auth/login',payload={'email':access['forbidden']['loginId']+'@moaworks.local','password':VERIFY_PASSWORD}); assert s==200,s
  s,_=api('GET','/workspace/notices',l['accessToken']); assert s==403,s
  s,_=api('POST','/auth/login',payload={'email':access['inactiveUser']['loginId']+'@moaworks.local','password':VERIFY_PASSWORD}); assert s==423,s
  s,_=api('POST','/auth/login',payload={'email':access['inactiveRoleUser']['loginId']+'@moaworks.local','password':VERIFY_PASSWORD}); assert s==423,s
  db=db_evidence(); assert any(x['status']=='published' for x in db['notices']); assert len(db['reads'])==1; assert any(x['status']=='active' for x in db['schedules']); assert any(x['event']=='workspace.notice.read' for x in db['audit']); assert any(x['event']=='workspace.schedule.created' for x in db['audit']); assert len([x for x in db['protected'] if x['status']=='active'])==3
  assert NETWORK and all(x['url'].startswith(WEB+'/api/v1/') for x in NETWORK),NETWORK
  return {'access':{'401':401,'403':403,'inactiveUser':423,'inactiveRole':423},'db':db,'network':{'count':len(NETWORK),'allSameOrigin':True}}
 RESULT['checks']['apiDbNetwork']=step('api-db-network',verify_api_db); RESULT['status']='passed'
except Exception as e:
 failure=e; RESULT['status']='failed'; RESULT['error']=str(e)
finally:
 try:
  RESULT['cleanup']=step('cleanup',cleanup); assert not RESULT['cleanup']['errors'],RESULT['cleanup']['errors']; db=RESULT['cleanup']['db']; assert db['activeUsers']==0 and db['activeRoles']==0; assert all(x['status']=='deleted' for x in db['notices']); assert all(x['status']=='deleted' for x in db['schedules']); assert len([x for x in db['protected'] if x['status']=='active'])==3
 except Exception as e:
  failure=failure or e; RESULT['status']='failed'; RESULT['cleanup']={'error':str(e)}
 RESULT['finishedAt']=time.strftime('%Y-%m-%dT%H:%M:%S%z'); (EVIDENCE/'network.json').write_text(json.dumps(redact(NETWORK),ensure_ascii=False,indent=2),encoding='utf-8'); (EVIDENCE/'result.json').write_text(json.dumps(redact(RESULT),ensure_ascii=False,indent=2,default=str),encoding='utf-8')
if failure: raise failure
print(json.dumps({'runId':RUN_ID,'status':RESULT['status'],'evidenceDir':str(EVIDENCE)},ensure_ascii=False))
