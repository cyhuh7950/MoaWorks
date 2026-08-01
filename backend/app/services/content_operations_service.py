from __future__ import annotations
from uuid import uuid4
from fastapi import HTTPException
from app.services.postgres_service import PostgresService

class ContentOperationsService:
 def __init__(self): self.db=PostgresService(); self.db.ensure_migrations_applied()
 def _err(self,code,msg,admin): raise HTTPException(409,detail={'code':code,'userMessage':msg,'adminMessage':admin})
 def _audit(self,c,actor,target,event,before,after,reason=None):
  c.execute('SELECT company_id,name FROM users WHERE id=%s',(actor,)); u=c.fetchone(); c.execute('INSERT INTO audit_logs (id,company_id,actor_user_id,actor_user_name,target_type,target_id,event,status_before,status_after,reason,created_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW())',(f'log_{uuid4().hex[:12]}',u['company_id'],actor,u['name'],'content',target,event,before,after,reason))
 def messages(self,actor,search='',locale=None,category=None,status='visible'):
  q='SELECT m.*,COALESCE(json_agg(json_build_object(\'locale\',t.locale,\'content\',t.content)) FILTER (WHERE t.id IS NOT NULL),\'[]\') translations FROM message_keys m LEFT JOIN message_translations t ON t.message_key_id=m.id WHERE (%s=\'\' OR m.key ILIKE %s)'; p=[search,f'%{search}%']
  if category: q+=' AND m.category=%s';p.append(category)
  if status!='all': q+=' AND m.status IN (\'active\',\'inactive\')' if status=='visible' else ' AND m.status=%s'; p+=[] if status=='visible' else [status]
  q+=' GROUP BY m.id ORDER BY m.updated_at DESC'
  with self.db.connect() as x:
   with x.cursor() as c:c.execute(q,p); rows=c.fetchall()
  return {'items':[dict(r,canDelete=not r['is_system'] and r['status']!='deleted',canChangeStatus=not r['is_system'] and r['status']!='deleted') for r in rows],'total':len(rows)}
 def create_message(self,actor,p):
  i=f'msg_{uuid4().hex[:12]}'
  with self.db.connect() as x:
   with x.cursor() as c:
    c.execute('INSERT INTO message_keys(id,key,default_locale,category,status,is_system,created_at,updated_at) VALUES(%s,%s,%s,%s,\'active\',%s,NOW(),NOW())',(i,p.key,p.defaultLocale,p.category,p.isSystem));c.execute('INSERT INTO message_translations(id,message_key_id,locale,content,created_at,updated_at) VALUES(%s,%s,%s,%s,NOW(),NOW())',(f'mtr_{uuid4().hex[:12]}',i,p.translation.locale,p.translation.content));self._audit(c,actor,i,'content.message.created',None,'active');x.commit()
  return self.message(i)
 def message(self,i):
  with self.db.connect() as x:
   with x.cursor() as c:c.execute('SELECT * FROM message_keys WHERE id=%s',(i,));r=c.fetchone();c.execute('SELECT locale,content FROM message_translations WHERE message_key_id=%s',(i,));t=c.fetchall()
  if not r: raise HTTPException(404,detail='not found')
  return dict(r,translations=t,canDelete=not r['is_system'] and r['status']!='deleted',canChangeStatus=not r['is_system'] and r['status']!='deleted')
 def bulk_message(self,actor,ids,status=None):
  with self.db.connect() as x:
   with x.cursor() as c:
    c.execute('SELECT id,status,is_system FROM message_keys WHERE id=ANY(%s)',(ids,));rows=c.fetchall()
    for r in rows:
     if r['is_system']:self._err('CONTENT_SYSTEM_PROTECTED','시스템 항목은 변경할 수 없습니다.','is_system=true')
     if r['status']=='deleted' and status!='deleted':self._err('CONTENT_DELETED_LOCKED','삭제된 항목은 다시 수정할 수 없습니다.','deleted item')
     nxt=status or 'deleted';c.execute('UPDATE message_keys SET status=%s,updated_at=NOW() WHERE id=%s',(nxt,r['id']));self._audit(c,actor,r['id'],'content.message.status',r['status'],nxt)
    x.commit()
  return self.messages(actor,status='all')
 def help_list(self,actor,search='',category=None,audience=None,status='visible'):
  q='SELECT * FROM help_policy_documents WHERE (%s=\'\' OR title ILIKE %s OR code ILIKE %s)';p=[search,f'%{search}%',f'%{search}%']
  if category:q+=' AND category=%s';p.append(category)
  if audience:q+=' AND audience=%s';p.append(audience)
  if status!='all':q+=' AND status IN (\'draft\',\'published\',\'inactive\')' if status=='visible' else ' AND status=%s';p+=[] if status=='visible' else [status]
  q+=' ORDER BY updated_at DESC'
  with self.db.connect() as x:
   with x.cursor() as c:c.execute(q,p);rows=c.fetchall()
  return {'items':[dict(r,canDelete=not r['is_system'] and r['status']!='deleted',canChangeStatus=not r['is_system'] and r['status']!='deleted') for r in rows],'total':len(rows)}
 def create_help(self,actor,p):
  i=f'hpd_{uuid4().hex[:12]}'
  with self.db.connect() as x:
   with x.cursor() as c:c.execute('INSERT INTO help_policy_documents(id,code,title,category,audience,status,is_system,content,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,\'draft\',%s,%s,NOW(),NOW())',(i,p.code,p.title,p.category,p.audience,p.isSystem,p.content));self._audit(c,actor,i,'content.help.created',None,'draft');x.commit()
  return self.help(i)
 def help(self,i):
  with self.db.connect() as x:
   with x.cursor() as c:c.execute('SELECT * FROM help_policy_documents WHERE id=%s',(i,));r=c.fetchone()
  if not r:raise HTTPException(404,detail='not found')
  return dict(r,canDelete=not r['is_system'] and r['status']!='deleted',canChangeStatus=not r['is_system'] and r['status']!='deleted')
 def bulk_help(self,actor,ids,status=None):
  with self.db.connect() as x:
   with x.cursor() as c:
    c.execute('SELECT id,status,is_system FROM help_policy_documents WHERE id=ANY(%s)',(ids,))
    for r in c.fetchall():
     if r['is_system']:self._err('CONTENT_SYSTEM_PROTECTED','시스템 정책은 변경할 수 없습니다.','is_system=true')
     if r['status']=='deleted' and status!='deleted':self._err('CONTENT_DELETED_LOCKED','삭제된 정책은 다시 수정할 수 없습니다.','deleted document')
     nxt=status or 'deleted';c.execute('UPDATE help_policy_documents SET status=%s,published_at=CASE WHEN %s=\'published\' THEN NOW() ELSE published_at END,updated_at=NOW() WHERE id=%s',(nxt,nxt,r['id']));self._audit(c,actor,r['id'],'content.help.status',r['status'],nxt)
    x.commit()
  return self.help_list(actor,status='all')
 def patch_message(self,actor,i,p):
  current=self.message(i)
  if current['is_system']:self._err('CONTENT_SYSTEM_PROTECTED','시스템 항목은 수정할 수 없습니다.','is_system=true')
  if current['status']=='deleted':self._err('CONTENT_DELETED_LOCKED','삭제된 항목은 수정할 수 없습니다.','deleted item')
  with self.db.connect() as x:
   with x.cursor() as c:
    c.execute('UPDATE message_keys SET key=COALESCE(%s,key),default_locale=COALESCE(%s,default_locale),category=COALESCE(%s,category),updated_at=NOW() WHERE id=%s',(p.key,p.defaultLocale,p.category,i))
    for t in p.translations or []:c.execute('INSERT INTO message_translations(id,message_key_id,locale,content,created_at,updated_at) VALUES(%s,%s,%s,%s,NOW(),NOW()) ON CONFLICT(message_key_id,locale) DO UPDATE SET content=EXCLUDED.content,updated_at=NOW()',(f'mtr_{uuid4().hex[:12]}',i,t.locale,t.content))
    self._audit(c,actor,i,'content.message.updated',current['status'],current['status']);x.commit()
  return self.message(i)
 def patch_help(self,actor,i,p):
  current=self.help(i)
  if current['is_system']:self._err('CONTENT_SYSTEM_PROTECTED','시스템 정책은 수정할 수 없습니다.','is_system=true')
  if current['status']=='deleted':self._err('CONTENT_DELETED_LOCKED','삭제된 정책은 수정할 수 없습니다.','deleted document')
  with self.db.connect() as x:
   with x.cursor() as c:c.execute('UPDATE help_policy_documents SET title=COALESCE(%s,title),category=COALESCE(%s,category),audience=COALESCE(%s,audience),content=COALESCE(%s,content),status=COALESCE(%s,status),version=version+CASE WHEN %s IS NULL THEN 0 ELSE 1 END,published_at=CASE WHEN %s=\'published\' THEN NOW() ELSE published_at END,updated_at=NOW() WHERE id=%s',(p.title,p.category,p.audience,p.content,p.status,p.content,p.status,i));self._audit(c,actor,i,'content.help.updated',current['status'],p.status or current['status']);x.commit()
  return self.help(i)
