// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import type { MailListQuery } from './api';
const state = vi.hoisted(() => ({ unread: 34, starred: 67, calls: [] as MailListQuery[], failCount: false, failSidebar: false, failStarred: false, total: 102, countLoader: null as null | (() => Promise<number>), sidebarLoader: null as null | (() => Promise<void>) }));
vi.mock('./api', async (original) => {
    const actual = await original<typeof import('./api')>();
    const empty = { mails: [], total: 0, limit: 50, offset: 0, hasMore: false };
    return { ...actual,
        getUserToken: () => localStorage.getItem('moaworks.userToken'),
        fetchMe: async () => ({ user: { userId: 'fixture-user', companyId: 'c', userName: 'Tester', userEmail: 'test@example.test', roleId: 'r', roleName: 'User', userType: 'employee', status: 'active', permissions: ['mail:send'], mustChangePassword: false } }),
        fetchUiContract: async () => ({}), fetchWorkspacePreferences: async () => ({ locale: 'ko', timezone: 'Asia/Seoul', startPage: 'mail', version: 1 }),
        fetchInbox: async (_token: string, q: MailListQuery) => { state.calls.push(q); if (q.limit === 1 && q.starred === 'starred') { if (state.failStarred) throw Error('offline'); return { ...empty, total: state.starred }; } if (q.limit === 1) {
            if (state.failCount)
                throw Error('offline');
            return { ...empty, total: state.countLoader ? await state.countLoader() : state.unread };
        } const total = q.q ? 3 : state.total; return { mails: Array.from({ length: Math.max(0, Math.min(q.limit ?? 50, total - (q.offset ?? 0))) }, (_, n) => ({ mailId: `mail-${n + (q.offset ?? 0)}`, senderEmail: 'sender@example.test', senderDisplayName: 'Sender', subject: `메일 ${n + (q.offset ?? 0)}`, isRead: !((n + (q.offset ?? 0)) < 10 || ((n + (q.offset ?? 0)) >= 50 && (n + (q.offset ?? 0)) < 82)), isStarred: false, category: 'primary', attachmentCount: 0, sentAt: '2026-09-27T00:00:00Z' })), total, limit: q.limit, offset: q.offset, hasMore: (q.offset ?? 0) + (q.limit ?? 50) < total }; },
        bulkMailAction: async (_token: string, _ids: string[], action: string) => { if (action === 'read') state.unread--; if (action === 'star') state.starred++; return { changedCount: 1, unchangedCount: 0 }; },
        fetchSentMail: async () => empty, fetchDraftMail: async () => empty, fetchScheduledMail: async () => empty,
        fetchMailFolders: async () => ({ folders: [] }), fetchMailTags: async () => ({ tags: [] }),
        fetchMailboxSettings: async () => { if (state.sidebarLoader) await state.sidebarLoader(); if (state.failSidebar) throw Error('offline'); return { mailboxes: [
            { mailboxKey: 'system:inbox', totalCount: state.total }, { mailboxKey: 'system:sent', totalCount: 76 },
            { mailboxKey: 'system:draft', totalCount: 55 }, { mailboxKey: 'system:scheduled', totalCount: 43 },
        ], tags: [], storage: { usedBytes: 0, quotaBytes: 1, usagePercent: 0 }, backupJobs: [] }; },
        fetchMailDetail: async () => ({ mailId: 'mail-0', subject: '상세', bodyText: '본문', senderDisplayName: 'Sender', senderEmail: 'sender@example.test', recipients: [], attachments: [], externalDeliveries: [] }),
        markMailRead: async () => { state.unread--; return { isRead: true }; },
        fetchMailBasicPreferences: async () => ({}), fetchMailSignatures: async () => ({ signatures: [] }),
        fetchTranslationStatus: async () => ({ available: false, enabled: false }), fetchMailDeliveryStatus: async () => ({ provider: { enabled: false } })
    };
});
beforeEach(() => { localStorage.clear(); localStorage.setItem('moaworks.userToken', 'fixture'); state.calls = []; state.unread = 34; state.starred = 67; state.failCount = false; state.failSidebar = false; state.failStarred = false; state.total = 102; state.countLoader = null; state.sidebarLoader = null; vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('받은편지함 전체 102건과 즐겨찾기 미읽음 34건을 구분하고 검색/페이지 변경에도 유지한다', async () => {
    render(<App />);
    expect(await screen.findByRole('button', { name: '받은편지함 102' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '안 읽은 메일 34' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '3페이지' }));
    await waitFor(() => expect(state.calls.some(q => q.offset === 100 && q.limit === 50)).toBe(true));
    fireEvent.change(screen.getByLabelText('메일 검색'), { target: { value: '검색' } });
    fireEvent.click(screen.getByRole('button', { name: '검색' }));
    await screen.findByText('선택 0 / 전체 3');
    expect(screen.getByRole('button', { name: '받은편지함 102' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '안 읽은 메일 34' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '보낸편지함 76' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '임시보관함 55' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '예약메일함 43' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '중요 67' })).toBeTruthy();
    const count = state.calls.filter(q => q.limit === 1 && q.read === 'unread');
    expect(count.every(q => q.q === '' && q.category === 'all' && q.read === 'unread' && q.starred === 'all' && q.offset === 0)).toBe(true);
    fireEvent.click(screen.getByText('메일 0').closest('button')!);
    await screen.findByRole('button', { name: '안 읽은 메일 33' });
    expect(screen.getByRole('button', { name: '받은편지함 102' })).toBeTruthy();
});
it('메일함은 각 전체 건수이고 중요는 별표 조회 전체 건수이며 실패 시 0으로 표시하지 않는다', async () => {
    const view = render(<App />);
    await screen.findByRole('button', { name: '받은편지함 102' });
    expect(screen.getByRole('button', { name: '보낸편지함 76' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '임시보관함 55' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '예약메일함 43' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '중요 67' })).toBeTruthy();
    expect(state.calls.some(q => q.limit === 1 && q.starred === 'starred' && q.category === 'all' && q.read === 'all' && q.q === '')).toBe(true);
    fireEvent.change(screen.getByLabelText('페이지당 메일 수'), { target: { value: '25' } });
    await waitFor(() => expect(state.calls.some(q => q.limit === 25 && q.offset === 0)).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: '도구모음 설정' }));
    fireEvent.change(screen.getByLabelText('도구모음 표시 방식'), { target: { value: 'text' } });
    view.unmount();
    render(<App />);
    await screen.findByRole('button', { name: '받은편지함 102' });
    expect((screen.getByLabelText('페이지당 메일 수') as HTMLSelectElement).value).toBe('25');
    expect(screen.getByRole('button', { name: '새로고침' }).textContent).toBe('새로고침');
    state.failCount = true;
    state.failSidebar = true;
    state.failStarred = true;
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }));
    await screen.findByRole('button', { name: '받은편지함 —' });
    expect(screen.getByRole('button', { name: '안 읽은 메일 —' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '중요 —' })).toBeTruthy();
});
it('일괄 읽음 후 전체 unread를 갱신하고 마지막 페이지가 없어지면 유효 페이지로 이동한다', async () => {
    render(<App />);
    await screen.findByRole('button', { name: '받은편지함 102' });
    fireEvent.click(screen.getByLabelText('메일 선택: 메일 0'));
    fireEvent.click(screen.getByRole('button', { name: '읽음' }));
    await screen.findByRole('button', { name: '안 읽은 메일 33' });
    fireEvent.click(screen.getByRole('button', { name: '3페이지' }));
    await screen.findByText('메일 100');
    state.total = 100;
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }));
    await screen.findByText('메일 50');
    expect(screen.getByRole('button', { name: '받은편지함 100' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '2페이지' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('button', { name: '3페이지' })).toBeNull();
});
it('중요 표시 변경 후 첫 페이지의 별표 수가 아닌 중요 바로가기 전체 건수를 다시 읽는다', async () => {
    render(<App />);
    await screen.findByRole('button', { name: '중요 67' });
    fireEvent.click(screen.getByLabelText('메일 선택: 메일 0'));
    fireEvent.click(screen.getByRole('button', { name: '중요' }));
    await screen.findByRole('button', { name: '중요 68' });
});
it('늦게 끝난 이전 집계가 새 집계를 덮지 않는다', async () => {
    render(<App />);
    await screen.findByRole('button', { name: '받은편지함 102' });
    let finish!: (value: number) => void;
    state.countLoader = () => new Promise<number>(resolve => { finish = resolve; });
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }));
    await waitFor(() => expect(finish).toBeTruthy());
    state.countLoader = null;
    state.unread = 40;
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }));
    await screen.findByRole('button', { name: '안 읽은 메일 40' });
    await act(async () => { finish(99); });
    expect(screen.queryByRole('button', { name: '안 읽은 메일 99' })).toBeNull();
    expect(screen.getByRole('button', { name: '안 읽은 메일 40' })).toBeTruthy();
});

it('늦게 온 이전 메일함 전체 집계가 최신 숫자를 덮지 않는다', async () => {
    render(<App />);
    await screen.findByRole('button', { name: '받은편지함 102' });
    let finish!: () => void;
    state.sidebarLoader = () => new Promise<void>(resolve => { finish = resolve; });
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }));
    await waitFor(() => expect(finish).toBeTruthy());
    state.sidebarLoader = null;
    state.total = 103;
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }));
    await screen.findByRole('button', { name: '받은편지함 103' });
    state.total = 99;
    await act(async () => { finish(); });
    expect(screen.getByRole('button', { name: '받은편지함 103' })).toBeTruthy();
});
