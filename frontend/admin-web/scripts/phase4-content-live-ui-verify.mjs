import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = new Date().toISOString().replace(/[-:.TZ]/g, "");
const appUrl = process.env.MOAWORKS_ADMIN_URL ?? "http://127.0.0.1:3510/";
const loginId = process.env.MOAWORKS_ADMIN_LOGIN;
const password = process.env.MOAWORKS_ADMIN_PASSWORD;
const chromePath = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "../../..");
const backendPython = process.env.MOAWORKS_BACKEND_PYTHON ?? join(root, "backend", ".venv", "Scripts", "python.exe");
const prefix = `verify.phase4.content.ui.${run}`;
const evidenceDir = join(root, "docs", "evidence", `trust-recovery-phase4-content-ui-${run}`);
const execFileAsync = promisify(execFile);
const network = [];

function assert(value, message) { if (!value) throw new Error(message); }
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close((error) => error ? rejectPort(error) : resolvePort(address.port)); });
  });
}

async function main() {
  assert(loginId && password, "MOAWORKS_ADMIN_LOGIN and MOAWORKS_ADMIN_PASSWORD are required.");
  assert(existsSync(backendPython), `Backend Python was not found: ${backendPython} (cwd: ${process.cwd()})`);
  await mkdir(evidenceDir, { recursive: true });
  const port = await freePort();
  const chrome = spawn(chromePath, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${join(evidenceDir, "chrome-profile")}`, "--no-first-run", "--no-default-browser-check", "--window-size=1920,1080", "about:blank"], { stdio: "ignore", windowsHide: true });
  let socket;
  let inspect;
  const result = { run, prefix, runtime: { root, backendPython, cwd: process.cwd() }, menus: {}, api: {}, database: {}, measurements: {}, network: [] };
  try {
    let version;
    for (let attempt = 0; attempt < 80; attempt += 1) { try { version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json()); break; } catch { await sleep(100); } }
    assert(version?.webSocketDebuggerUrl, "Chrome CDP unavailable");
    const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
    socket = new WebSocket(target.webSocketDebuggerUrl);
    const pending = new Map(); let sequence = 0;
    await new Promise((resolveOpen, rejectOpen) => { socket.addEventListener("open", resolveOpen, { once: true }); socket.addEventListener("error", rejectOpen, { once: true }); });
    socket.addEventListener("message", async (event) => { const message = JSON.parse(typeof event.data === "string" ? event.data : await event.data.text()); if (message.id) { const waiter = pending.get(message.id); if (!waiter) return; pending.delete(message.id); message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result ?? {}); } else if (message.method === "Network.requestWillBeSent") network.push({ url: message.params.request.url, method: message.params.request.method }); });
    const send = (method, params = {}) => { const id = ++sequence; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolveResult, rejectResult) => { pending.set(id, { resolve: resolveResult, reject: rejectResult }); setTimeout(() => { if (pending.has(id)) { pending.delete(id); rejectResult(new Error(`CDP timeout ${method}`)); } }, 15000); }); };
    await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable"); await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    const evaluate = async (expression) => { const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text); return response.result.value; };
    const waitFor = async (expression, label) => { for (let attempt = 0; attempt < 300; attempt += 1) { if (await evaluate(expression)) return; await sleep(100); } throw new Error(`Timeout: ${label}`); };
    const point = async (expression) => evaluate(`(() => { const item = ${expression}; if (!item || item.disabled || item.offsetParent === null) throw new Error('target unavailable'); item.scrollIntoView({block:'center'}); const box=item.getBoundingClientRect(); return {x:box.left+box.width/2,y:box.top+box.height/2}; })()`);
    const mouse = async (target, count = 1) => { await send("Input.dispatchMouseEvent", { type: "mousePressed", x: target.x, y: target.y, button: "left", buttons: 1, clickCount: count }); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: target.x, y: target.y, button: "left", buttons: 0, clickCount: count }); };
    const button = async (text, root = "document") => evaluate(`(() => { const item=[...(${root}).querySelectorAll('button')].find((candidate)=>candidate.textContent.trim()===${JSON.stringify(text)}); if(!item || item.disabled || item.offsetParent===null) throw new Error('target unavailable'); item.scrollIntoView({block:'center'}); item.click(); })()`);
    const setValue = (label, value) => evaluate(`(() => { const label=[...document.querySelectorAll('.content-editor-modal label')].find((item)=>item.textContent.includes(${JSON.stringify(label)})); const field=label?.querySelector('input,textarea,select'); if(!field) throw new Error('missing field'); const prototype=field instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:field instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype,'value').set.call(field,${JSON.stringify(value)}); field.dispatchEvent(new Event('input',{bubbles:true})); field.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    const screenshot = async (name) => { const image = await send("Page.captureScreenshot", { format: "png" }); const file = join(evidenceDir, `${name}.png`); await writeFile(file, Buffer.from(image.data, "base64")); return file; };
    const metrics = () => evaluate(`(() => { const page=document.scrollingElement; const list=document.querySelector('.content-list-scroll'); return {viewport:{width:innerWidth,height:innerHeight},scrollHeight:page.scrollHeight,clientHeight:page.clientHeight,pageHasScroll:page.scrollHeight>page.clientHeight+1,listOverflow:list?getComputedStyle(list).overflow:null,listScrollable:list?list.scrollHeight>list.clientHeight:false}; })()`);
    const api = (path, options = {}) => evaluate(`fetch(${JSON.stringify(`/api/v1${path}`)},${JSON.stringify(options)}).then(async response=>({status:response.status,body:await response.json().catch(()=>({}))}))`);
    const openMenu = async (label) => { await button(label, "document.querySelector('.console-sidebar')"); await sleep(250); };
    const create = async (kind, suffix) => {
      const createLabel = kind === "message" ? "새 메시지" : "새 정책";
      await waitFor(`[...document.querySelectorAll('button')].some((item) => item.textContent.trim() === ${JSON.stringify(createLabel)} && !item.disabled && item.offsetParent !== null)`, "content create action");
      await button(createLabel); await waitFor("document.querySelector('.content-editor-modal')!==null", "content modal");
      if (kind === "message") { await setValue("메시지 키", `${prefix}.${suffix}`); await setValue("분류", "verify"); await setValue("번역 내용", `검수 메시지 ${suffix}`); }
      else { await setValue("정책 코드", `${prefix}.${suffix}`); await setValue("제목", `검수 정책 ${suffix}`); await setValue("분류", "verify"); await setValue("본문", `검수 정책 본문 ${suffix}`); }
      await button("등록", "document.querySelector('.content-editor-modal')");
      await waitFor("[...document.querySelectorAll('.content-editor-modal button')].some((item) => item.textContent.trim() === '수정 저장')", "saved content detail");
      await button("닫기", "document.querySelector('.content-editor-modal')"); await waitFor(`document.body.innerText.includes(${JSON.stringify(`${prefix}.${suffix}`)})`, "created list row");
    };
    const selectRows = async (values) => {
      await evaluate(`(() => { for (const value of ${JSON.stringify(values)}) { const row=[...document.querySelectorAll('.management-list-row')].find((item)=>item.innerText.includes(value)); const checkbox=row?.querySelector('input[type=checkbox]'); if(!checkbox || checkbox.disabled) throw new Error('selection unavailable '+value); checkbox.click(); } })()`);
      await waitFor(`[...document.querySelectorAll('.management-list-row input[type=checkbox]:checked')].length >= ${values.length}`, "selected content rows");
    };
    const openRow = async (value) => { const target = await point(`[...document.querySelectorAll('.management-list-row')].find((item)=>item.innerText.includes(${JSON.stringify(value)}))`); await mouse(target, 2); await waitFor("document.querySelector('.content-editor-modal')!==null", "row detail modal"); };

    await send("Page.navigate", { url: appUrl }); await waitFor("document.querySelector('input[type=password]')!==null", "login");
    await evaluate(`(() => { const inputs=[...document.querySelectorAll('input')]; const login=inputs.find((item)=>item.type==='text'||item.type==='email'); const secret=inputs.find((item)=>item.type==='password'); const set=(field,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));}; set(login,${JSON.stringify(loginId)});set(secret,${JSON.stringify(password)});document.querySelector('.login-card form button[type=submit]').click();})()`);
    await waitFor("document.querySelector('.console-layout')!==null", "console"); const token = await evaluate("localStorage.getItem('moaworks.adminToken')||''"); assert(token, "login token missing"); const auth = { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } };

    await openMenu("다국어/메시지"); await create("message", "message-a"); await create("message", "message-b"); await openRow(`${prefix}.message-a`); await setValue("번역 내용", "검수 메시지 수정됨"); await button("수정 저장", "document.querySelector('.content-editor-modal')"); await waitFor("[...document.querySelectorAll('.content-editor-modal button')].some((item) => item.textContent.trim() === '닫기')", "message save complete"); await button("닫기", "document.querySelector('.content-editor-modal')"); await waitFor("document.querySelector('.content-editor-modal')===null", "message modal close"); await selectRows([`${prefix}.message-a`, `${prefix}.message-b`]); await waitFor("[...document.querySelectorAll('.management-list-toolbar button')].some((item) => item.textContent.trim() === '비활성화' && !item.disabled)", "message bulk action enabled"); await button("비활성화", "document.querySelector('.management-list-toolbar')"); await waitFor("document.querySelector('.management-confirm-modal')!==null", "message bulk confirm"); await button("확인", "document.querySelector('.management-confirm-modal')"); await waitFor("document.querySelector('.management-confirm-modal')===null", "message status completion"); await selectRows([`${prefix}.message-a`, `${prefix}.message-b`]); await waitFor("[...document.querySelectorAll('.management-list-toolbar button')].some((item) => item.textContent.trim() === '삭제' && !item.disabled)", "message delete enabled"); await button("삭제", "document.querySelector('.management-list-toolbar')"); await waitFor("document.querySelector('.management-confirm-modal')!==null", "message delete confirm"); await button("확인", "document.querySelector('.management-confirm-modal')"); await waitFor("document.querySelector('.management-confirm-modal')===null", "message delete completion"); result.menus.messages = { screenshot: await screenshot("messages"), metrics: await metrics() };

    await openMenu("도움말/정책"); await create("help", "help-a"); await create("help", "help-b"); await openRow(`${prefix}.help-a`); await setValue("본문", "검수 정책 본문 수정됨"); await button("수정 저장", "document.querySelector('.content-editor-modal')"); await waitFor("[...document.querySelectorAll('.content-editor-modal button')].some((item) => item.textContent.trim() === '닫기')", "help save complete"); await button("닫기", "document.querySelector('.content-editor-modal')"); await waitFor("document.querySelector('.content-editor-modal')===null", "help modal close"); await selectRows([`${prefix}.help-a`, `${prefix}.help-b`]); await waitFor("[...document.querySelectorAll('.management-list-toolbar button')].some((item) => item.textContent.trim() === '발행' && !item.disabled)", "help bulk action enabled"); await button("발행", "document.querySelector('.management-list-toolbar')"); await waitFor("document.querySelector('.management-confirm-modal')!==null", "help bulk confirm"); await button("확인", "document.querySelector('.management-confirm-modal')"); await waitFor("document.querySelector('.management-confirm-modal')===null", "help status completion"); await selectRows([`${prefix}.help-a`, `${prefix}.help-b`]); await waitFor("[...document.querySelectorAll('.management-list-toolbar button')].some((item) => item.textContent.trim() === '삭제' && !item.disabled)", "help delete enabled"); await button("삭제", "document.querySelector('.management-list-toolbar')"); await waitFor("document.querySelector('.management-confirm-modal')!==null", "help delete confirm"); await button("확인", "document.querySelector('.management-confirm-modal')"); await waitFor("document.querySelector('.management-confirm-modal')===null", "help delete completion"); result.menus.help = { screenshot: await screenshot("help"), metrics: await metrics() };

    const unauthenticated = await api("/admin/content/messages"); const allMessages = await api("/admin/content/messages?status=all", auth); const allHelp = await api("/admin/content/help-policies?status=all", auth); const systemItem = allMessages.body.items.find((item) => item.is_system); const protectedResponse = await api("/admin/content/messages/bulk-status", { ...auth, method: "POST", body: JSON.stringify({ids:[systemItem.id],status:"inactive"}) }); const messages = allMessages.body.items.filter((item) => item.key.startsWith(prefix)); const help = allHelp.body.items.filter((item) => item.code.startsWith(prefix)); result.api={unauthenticated:unauthenticated.status,systemProtected:protectedResponse.status,messages:messages.map((item)=>({id:item.id,status:item.status})),help:help.map((item)=>({id:item.id,status:item.status}))}; assert(unauthenticated.status===401,"401 check failed");assert(protectedResponse.status===409,"system 409 check failed");assert(messages.length===2&&messages.every((item)=>item.status==="deleted"),"message delete failed");assert(help.length===2&&help.every((item)=>item.status==="deleted"),"help delete failed");
    const ids=JSON.stringify({messages:messages.map((item)=>item.id),help:help.map((item)=>item.id)}); const source=`import json\nfrom app.services.postgres_service import PostgresService\nd=json.loads(${JSON.stringify(ids)})\nwith PostgresService().connect() as c:\n with c.cursor() as q:\n  q.execute("SELECT id,status FROM message_keys WHERE id=ANY(%s)",(d['messages'],));m=q.fetchall()\n  q.execute("SELECT id,status FROM help_policy_documents WHERE id=ANY(%s)",(d['help'],));h=q.fetchall()\n  q.execute("SELECT target_id,event,status_after FROM audit_logs WHERE target_id=ANY(%s)",(d['messages']+d['help'],));a=q.fetchall()\nprint(json.dumps({'messages':m,'help':h,'audit':a},default=str))`; const db=JSON.parse((await execFileAsync(backendPython,["-c",source],{cwd:join(root,"backend")})).stdout); result.database=db;assert(db.messages.every((item)=>item.status==="deleted")&&db.help.every((item)=>item.status==="deleted"),"DB deleted check failed");assert(db.audit.filter((item)=>item.status_after==="deleted").length>=4,"audit check failed");
    result.network=network.filter((item)=>item.url.includes("/api/v1/")).map((item)=>item.url);assert(result.network.every((url)=>url.startsWith("http://127.0.0.1:3510/api/v1/")),"same-origin request violation"); result.measurements={messages:result.menus.messages.metrics,help:result.menus.help.metrics}; await writeFile(join(evidenceDir,"measurements.json"),JSON.stringify(result.measurements,null,2));await writeFile(join(evidenceDir,"network.json"),JSON.stringify({urls:result.network},null,2));await writeFile(join(evidenceDir,"api-db-result.json"),JSON.stringify(result,null,2)); console.log(JSON.stringify({result:"passed",evidenceDir}));
  } catch (error) { await writeFile(join(evidenceDir,"failure.json"),JSON.stringify({run,error:String(error),network},null,2)); throw error; } finally { socket?.close(); chrome.kill(); }
}

main().catch((error) => { console.error(error.stack||error.message); process.exitCode=1; });
