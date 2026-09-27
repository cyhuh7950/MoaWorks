import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export async function installMailFixture(page) {
    const mails = Array.from({ length: 102 }, (_, i) => ({ mailId: `mail-${i}`, accountId: 'a', senderEmail: 'sender@example.test', senderDisplayName: '테스트 발신자', subject: `합성 메일 ${i + 1}`, bodyText: '내부 스크롤 검증용 본문\n'.repeat(200), bodyHtml: '<h1>긴 메일 본문</h1>' + '<p>내부 스크롤 검증용 합성 본문입니다.</p>'.repeat(100), previewText: '합성 본문', status: 'sent', isRead: i < 40, isStarred: i < 67, category: 'primary', attachmentCount: 0, sentAt: '2026-09-27T00:00:00Z', createdAt: '2026-09-27T00:00:00Z', recipients: [], attachments: [], externalDeliveries: [] }));
    const mailboxLists = { '/mail/sent': mails.slice(0, 76), '/mail/drafts': mails.slice(0, 55), '/mail/scheduled': mails.slice(0, 43) };
    const mailboxRow = (key, name, type, total) => ({ mailboxKey: `system:${key}`, name, mailboxType: type, retentionDays: null, retentionEditable: key !== 'scheduled', unreadCount: key === 'inbox' ? 62 : null, totalCount: total, usedBytes: 0, version: 1 });
    const calls = [];
    await page.addInitScript(() => localStorage.setItem('moaworks.userToken', 'synthetic-fixture'));
    await page.route('**/api/**', async (route) => {
        const u = new URL(route.request().url());
        const p = u.pathname.replace('/api/v1', '');
        calls.push({ path: p, query: Object.fromEntries(u.searchParams) });
        const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
        if (p.includes('branding') || p.includes('logo'))
            return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" rx="12" fill="#0f766e"/><text x="6" y="30" fill="white">MO</text></svg>' });
        if (p === '/auth/me')
            return reply({ user: { userId: 'fixture-user', companyId: 'c', userName: 'Tester', userEmail: 'test@example.test', roleId: 'r', roleName: 'User', userType: 'employee', status: 'active', permissions: ['mail:send'], mustChangePassword: false } });
        if (p === '/workspace/preferences')
            return reply({ locale: 'ko', timezone: 'Asia/Seoul', startPage: 'mail', version: 1 });
        if (p === '/mail/mailbox-settings')
            return reply({ mailboxes: [mailboxRow('inbox', '받은편지함', 'inbox', 102), mailboxRow('sent', '보낸편지함', 'sent', 76), mailboxRow('draft', '임시보관함', 'draft', 55), mailboxRow('scheduled', '예약메일함', 'scheduled', 43)], tags: [], storage: { usedBytes: 1000, quotaBytes: 2000000000, usagePercent: 0 }, backupJobs: [] });
        if (p === '/mail/inbox') {
            let list = mails.filter(m => u.searchParams.get('read') === 'unread' ? !m.isRead : u.searchParams.get('read') === 'read' ? m.isRead : true);
            if (u.searchParams.get('starred') === 'starred')
                list = list.filter(m => m.isStarred);
            if (u.searchParams.get('q'))
                list = list.filter(m => m.subject.includes(u.searchParams.get('q')));
            const limit = Number(u.searchParams.get('limit') || 50), offset = Number(u.searchParams.get('offset') || 0);
            return reply({ mails: list.slice(offset, offset + limit), total: list.length, limit, offset, hasMore: offset + limit < list.length });
        }
        if (p in mailboxLists) {
            const list = mailboxLists[p];
            const limit = Number(u.searchParams.get('limit') || 50), offset = Number(u.searchParams.get('offset') || 0);
            return reply({ mails: list.slice(offset, offset + limit), total: list.length, limit, offset, hasMore: offset + limit < list.length });
        }
        if (p === '/mail/folders')
            return reply({ folders: [{ folderId: 'f1', name: '업무' }] });
        if (p === '/mail/tags')
            return reply({ tags: [{ tagId: 't1', name: '확인' }] });
        if (/^\/mail\/mail-\d+\/read$/.test(p)) {
            mails.find(m => p.includes('/' + m.mailId + '/')).isRead = true;
            return reply({ isRead: true });
        }
        if (/^\/mail\/mail-\d+$/.test(p))
            return reply(mails.find(m => p.endsWith('/' + m.mailId)));
        if (p === '/mail/preferences/basic')
            return reply({ senderDisplayMode: 'name', blockRemoteImages: true, disableRiskyTags: true });
        if (p === '/mail/signatures')
            return reply({ signatures: [] });
        if (p === '/mail/storage')
            return reply({ usedBytes: 1000, quotaBytes: 2000000000, usagePercent: 0 });
        if (p.includes('translation/status'))
            return reply({ available: false, enabled: false });
        return reply({}, 404);
    });
    return { mails, calls };
}
async function assertSidebarCounts(page) {
    for (const label of ['받은편지함 102', '안 읽은 메일 62', '중요 67', '보낸편지함 76', '임시보관함 55', '예약메일함 43'])
        await page.getByRole('button', { name: label, exact: true }).waitFor();
}
export async function verifyMailBrowser(base = 'http://127.0.0.1:3520', out = '../../docs/work-progress/mail-toolbar-20260927/browser') {
    await mkdir(out, { recursive: true });
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const results = [];
    try {
        for (const height of [1080, 960]) {
            const page = await browser.newPage({ viewport: { width: 1920, height } });
            await installMailFixture(page);
            await page.goto(base);
            await assertSidebarCounts(page);
            await page.getByRole('button', { name: '중요 67', exact: true }).click();
            await page.getByText('선택 0 / 전체 67', { exact: true }).waitFor();
            await page.getByRole('button', { name: '받은편지함 102', exact: true }).click();
            await page.getByText('선택 0 / 전체 102', { exact: true }).waitFor();
            for (const mode of ['icons', 'text']) {
                await page.getByRole('button', { name: '도구모음 설정', exact: true }).click();
                await page.getByLabel('도구모음 표시 방식').selectOption(mode);
                await page.keyboard.press('Escape');
                const metrics = await page.evaluate(() => ({ outer: document.documentElement.scrollHeight <= innerHeight, panes: [...document.querySelectorAll('.user-mail-list-panel,.user-mail-detail-panel,.user-mail-detail-content,.user-split-view__pane,.user-split-view,.user-mail-workbench,.user-shell-content')].map(e => ({ class: e.className, overflow: e.scrollHeight > e.clientHeight + 1 })), listScrollable: document.querySelector('.mail-list-scroll').scrollHeight > document.querySelector('.mail-list-scroll').clientHeight }));
                assert.equal(metrics.outer, true);
                assert.ok(metrics.panes.every(p => !p.overflow), JSON.stringify(metrics));
                assert.equal(metrics.listScrollable, true);
                await page.getByRole('button', { name: '조회 필터·정렬', exact: true }).click();
                const bounds = await page.getByRole('dialog', { name: '조회 필터·정렬' }).boundingBox();
                assert.ok(bounds.x >= 0 && bounds.y + bounds.height <= height);
                await page.keyboard.press('Escape');
                const toolbar = page.locator('.user-mail-toolbar');
                const pager = page.locator('.mail-pagination');
                const before = { toolbar: await toolbar.boundingBox(), pager: await pager.boundingBox() };
                await page.locator('.mail-list-scroll').evaluate(e => { e.scrollTop = 500; });
                assert.ok(await page.locator('.mail-list-scroll').evaluate(e => e.scrollTop) > 0);
                const frame = page.frames().find(f => f !== page.mainFrame());
                await frame.waitForLoadState();
                await frame.evaluate(() => { document.scrollingElement.scrollTop = 500; });
                assert.ok(await frame.evaluate(() => document.scrollingElement.scrollTop) > 0);
                assert.deepEqual(await toolbar.boundingBox(), before.toolbar);
                assert.deepEqual(await pager.boundingBox(), before.pager);
                await page.locator('.mail-list-scroll').evaluate(e => { e.scrollTop = 0; });
                await frame.evaluate(() => { document.scrollingElement.scrollTop = 0; });
                await page.getByRole('button', { name: '조회 필터·정렬', exact: true }).click();
                const sort = page.getByLabel('정렬', { exact: true });
                assert.equal(await sort.evaluate(e => { const r = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true);
                await sort.selectOption('date_asc');
                await page.keyboard.press('Escape');
                await page.screenshot({ path: `${out}/${height}-${mode}.png` });
                results.push({ height, mode, ...metrics });
            }
            await page.getByLabel('페이지당 메일 수').selectOption('25');
            await page.getByRole('button', { name: '5페이지', exact: true }).click();
            await page.getByText('합성 메일 101', { exact: true }).waitFor();
            assert.equal(await page.locator('.user-mail-row').count(), 2);
            await assertSidebarCounts(page);
            await page.reload();
            await assertSidebarCounts(page);
            assert.equal(await page.getByLabel('페이지당 메일 수').inputValue(), '25');
            await page.close();
        }
        const narrow = await browser.newPage({ viewport: { width: 1024, height: 768 } });
        await installMailFixture(narrow);
        await narrow.goto(base);
        await assertSidebarCounts(narrow);
        for (const name of ['조회 필터·정렬','분류 변경','메일함 이동','태그 관리','도구모음 설정']) {
            await narrow.locator('.user-mail-toolbar').getByRole('button',{name,exact:true}).click();
            const dialog = narrow.getByRole('dialog',{name,exact:true});
            assert.equal(await dialog.evaluate(e=>{const r=e.getBoundingClientRect(); return e.contains(document.elementFromPoint(r.right-8,r.top+30));}),true,name);
            await narrow.keyboard.press('Escape');
        }
        results.push({width:1024,height:768,allMenusReachable:true});
        await narrow.close();
        const receipt = await browser.newPage({ viewport: {width:1920,height:960} });
        const fixture = await installMailFixture(receipt);
        fixture.mails[0].canViewReadReceipts=true;
        fixture.mails[0].recipients=Array.from({length:20},(_,i)=>({recipientEmail:`recipient${i}@example.test`,recipientUserId:`u${i}`,recipientKind:'to',isRead:false,readAt:null}));
        await receipt.route('**/api/v1/mail/sent?**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({mails:[fixture.mails[0]],total:1,limit:50,offset:0,hasMore:false})}));
        await receipt.goto(base);
        await receipt.getByRole('button',{name:/^보낸편지함/}).click();
        await receipt.getByRole('button',{name:/수신 확인 ·/}).click();
        assert.ok((await receipt.locator('iframe[title="메일 HTML 본문"]').boundingBox()).height>=100);
        const expanded=receipt.locator('.user-mail-read-receipt');
        assert.ok(await expanded.evaluate(e=>e.scrollHeight>e.clientHeight));
        await expanded.evaluate(e=>{e.scrollTop=e.scrollHeight;});
        assert.ok(await expanded.evaluate(e=>e.scrollTop)>0);
        assert.ok(await receipt.locator('.user-mail-detail-content').evaluate(e=>e.scrollHeight<=e.clientHeight+1));
        results.push({expandedReceipt20:true,bodyReachable:true});
        await receipt.close();
        console.log(JSON.stringify(results, null, 2));
        return results;
    }
    finally {
        await browser.close();
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    await verifyMailBrowser(process.argv[2], process.argv[3]);
