// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import type { MailListQuery } from './api';
const state = vi.hoisted(() => ({ unread: 42, calls: [] as MailListQuery[], failCount: false, total: 102, countLoader: null as null | (() => Promise<number>) }));
vi.mock('./api', async (original) => {
    const actual = await original<typeof import('./api')>();
    const empty = { mails: [], total: 0, limit: 50, offset: 0, hasMore: false };
    return { ...actual,
        getUserToken: () => localStorage.getItem('moaworks.userToken'),
        fetchMe: async () => ({ user: { userId: 'fixture-user', companyId: 'c', userName: 'Tester', userEmail: 'test@example.test', roleId: 'r', roleName: 'User', userType: 'employee', status: 'active', permissions: ['mail:send'], mustChangePassword: false } }),
        fetchUiContract: async () => ({}), fetchWorkspacePreferences: async () => ({ locale: 'ko', timezone: 'Asia/Seoul', startPage: 'mail', version: 1 }),
        fetchInbox: async (_token: string, q: MailListQuery) => { state.calls.push(q); if (q.limit === 1) {
            if (state.failCount)
                throw Error('offline');
            return { ...empty, total: state.countLoader ? await state.countLoader() : state.unread };
        } const total = q.q ? 3 : state.total; return { mails: Array.from({ length: Math.max(0, Math.min(q.limit ?? 50, total - (q.offset ?? 0))) }, (_, n) => ({ mailId: `mail-${n + (q.offset ?? 0)}`, senderEmail: 'sender@example.test', senderDisplayName: 'Sender', subject: `메일 ${n + (q.offset ?? 0)}`, isRead: !((n + (q.offset ?? 0)) < 10 || ((n + (q.offset ?? 0)) >= 50 && (n + (q.offset ?? 0)) < 82)), isStarred: false, category: 'primary', attachmentCount: 0, sentAt: '2026-09-27T00:00:00Z' })), total, limit: q.limit, offset: q.offset, hasMore: (q.offset ?? 0) + (q.limit ?? 50) < total }; },
        bulkMailAction: async () => { state.unread--; return { changedCount: 1, unchangedCount: 0 }; },
        fetchSentMail: async () => empty, fetchDraftMail: async () => empty, fetchScheduledMail: async () => empty,
        fetchMailFolders: async () => ({ folders: [] }), fetchMailTags: async () => ({ tags: [] }),
        fetchMailDetail: async () => ({ mailId: 'mail-0', subject: '상세', bodyText: '본문', senderDisplayName: 'Sender', senderEmail: 'sender@example.test', recipients: [], attachments: [], externalDeliveries: [] }),
        markMailRead: async () => { state.unread--; return { isRead: true }; },
        fetchMailBasicPreferences: async () => ({}), fetchMailSignatures: async () => ({ signatures: [] }),
        fetchTranslationStatus: async () => ({ available: false, enabled: false }), fetchMailDeliveryStatus: async () => ({ provider: { enabled: false } })
    };
});
beforeEach(() => { localStorage.clear(); localStorage.setItem('moaworks.userToken', 'fixture'); state.calls = []; state.unread = 42; state.failCount = false; state.total = 102; state.countLoader = null; vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('첫 페이지의 미읽음 10건 대신 전체 미읽음 42건을 표시하고 검색/페이지 변경에 독립적이다', async () => {
    render(<App />);
    expect(await screen.findByRole('button', { name: '받은편지함 42' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '3페이지' }));
    await waitFor(() => expect(state.calls.some(q => q.offset === 100 && q.limit === 50)).toBe(true));
    fireEvent.change(screen.getByLabelText('메일 검색'), { target: { value: '검색' } });
    fireEvent.click(screen.getByRole('button', { name: '검색' }));
    await screen.findByText('선택 0 / 전체 3');
    expect(screen.getByRole('button', { name: '받은편지함 42' })).toBeTruthy();
    const count = state.calls.filter(q => q.limit === 1);
    expect(count.every(q => q.q === '' && q.category === 'all' && q.read === 'unread' && q.starred === 'all' && q.offset === 0)).toBe(true);
    fireEvent.click(screen.getByText('메일 0').closest('button')!);
    await screen.findByRole('button', { name: '받은편지함 41' });
});
it('페이지당 크기와 도구모음 모드를 유지하며 카운트 실패를 0으로 표시하지 않는다', async () => {
    const view = render(<App />);
    await screen.findByRole('button', { name: '받은편지함 42' });
    fireEvent.change(screen.getByLabelText('페이지당 메일 수'), { target: { value: '25' } });
    await waitFor(() => expect(state.calls.some(q => q.limit === 25 && q.offset === 0)).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: '도구모음 설정' }));
    fireEvent.change(screen.getByLabelText('도구모음 표시 방식'), { target: { value: 'text' } });
    view.unmount();
    render(<App />);
    await screen.findByRole('button', { name: '받은편지함 42' });
    expect((screen.getByLabelText('페이지당 메일 수') as HTMLSelectElement).value).toBe('25');
    expect(screen.getByRole('button', { name: '새로고침' }).textContent).toBe('새로고침');
    state.failCount = true;
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }));
    await screen.findByRole('button', { name: '받은편지함 —' });
});
it('일괄 읽음 후 전체 unread를 갱신하고 마지막 페이지가 없어지면 유효 페이지로 이동한다', async () => {
    render(<App />);
    await screen.findByRole('button', { name: '받은편지함 42' });
    fireEvent.click(screen.getByLabelText('메일 선택: 메일 0'));
    fireEvent.click(screen.getByRole('button', { name: '읽음' }));
    await screen.findByRole('button', { name: '받은편지함 41' });
    fireEvent.click(screen.getByRole('button', { name: '3페이지' }));
    await screen.findByText('메일 100');
    state.total = 100;
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }));
    await screen.findByText('메일 50');
    expect(screen.getByRole('button', { name: '2페이지' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('button', { name: '3페이지' })).toBeNull();
});
it('늦게 끝난 이전 집계가 새 집계를 덮지 않는다', async () => {
    render(<App />);
    await screen.findByRole('button', { name: '받은편지함 42' });
    let finish!: (value: number) => void;
    state.countLoader = () => new Promise<number>(resolve => { finish = resolve; });
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }));
    await waitFor(() => expect(finish).toBeTruthy());
    state.countLoader = null;
    state.unread = 40;
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }));
    await screen.findByRole('button', { name: '받은편지함 40' });
    await act(async () => { finish(99); });
    expect(screen.queryByRole('button', { name: '받은편지함 99' })).toBeNull();
    expect(screen.getByRole('button', { name: '받은편지함 40' })).toBeTruthy();
});
