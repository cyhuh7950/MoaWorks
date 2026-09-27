// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MailPagination, MailToolButton, MailToolMenu, readMailDisplay, saveMailDisplay } from './MailToolbar';
import { Envelope } from '@phosphor-icons/react';
afterEach(() => { cleanup(); localStorage.clear(); });
it('102건을 선택한 크기로 나누고 직접 페이지 이동한다', () => {
    for (const limit of [10, 25, 50, 100]) {
        const change = vi.fn();
        const size = vi.fn();
        const view = render(<MailPagination total={102} limit={limit} offset={0} loading={false} onPage={change} onSize={size}/>);
        fireEvent.click(screen.getByRole('button', { name: '마지막 페이지' }));
        expect(change).toHaveBeenCalledWith(Math.floor(101 / limit) * limit);
        expect(screen.getByRole('button', { name: '첫 페이지' }).getAttribute('disabled')).not.toBeNull();
        fireEvent.change(screen.getByLabelText('페이지당 메일 수'), { target: { value: '25' } });
        expect(size).toHaveBeenCalledWith(25);
        view.unmount();
    }
});
it('큰 페이지 수도 제한된 번호만 렌더하고 빈 결과도 이동하지 않는다', () => {
    const v = render(<MailPagination total={100000} limit={10} offset={50000} loading={false} onPage={() => { }} onSize={() => { }}/>);
    expect(screen.getAllByRole('button').length).toBeLessThan(13);
    v.rerender(<MailPagination total={0} limit={50} offset={0} loading={false} onPage={() => { }} onSize={() => { }}/>);
    expect(screen.getByRole('button', { name: '다음 페이지' }).getAttribute('disabled')).not.toBeNull();
});
it('아이콘과 글자 모드는 같은 액션이며 메뉴는 Escape로 닫고 포커스를 돌려준다', () => {
    const action = vi.fn();
    const v = render(<MailToolButton label="읽음" icon={Envelope} mode="icons" onClick={action}/>);
    fireEvent.click(screen.getByRole('button', { name: '읽음' }));
    v.rerender(<MailToolButton label="읽음" icon={Envelope} mode="text" onClick={action}/>);
    fireEvent.click(screen.getByRole('button', { name: '읽음' }));
    expect(action).toHaveBeenCalledTimes(2);
    v.rerender(<MailToolMenu label="조회 필터" icon={Envelope} mode="icons"><button>조건</button></MailToolMenu>);
    const trigger = screen.getByRole('button', { name: '조회 필터' });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
});
it('설정은 사용자별로 유지하며 저장소 실패 시 기본값을 사용한다', () => {
    saveMailDisplay('u1', { mode: 'text', pageSize: 25 });
    expect(readMailDisplay('u1')).toEqual({ mode: 'text', pageSize: 25 });
    expect(readMailDisplay('u2')).toEqual({ mode: 'icons', pageSize: 50 });
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error('denied'); });
    expect(readMailDisplay('u1').pageSize).toBe(50);
    spy.mockRestore();
});
