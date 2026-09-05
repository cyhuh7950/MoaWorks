import { afterEach, expect, it, vi } from 'vitest';
import * as api from './api';

afterEach(() => vi.unstubAllGlobals());
const item = { queueId: 'q1', mailId: 'm1', recipientEmail: 'recipient@example.invalid', subject: '큐', status: 'result_unknown', attemptCount: 1, nextAttemptAt: null, leaseExpiresAt: null, createdAt: '2026-09-05T00:00:00Z' };
const detail = { item, attempts: [{ attemptNumber: 1, result: 'result_unknown', errorMessage: '결과 확인 필요', relayResponse: null, startedAt: item.createdAt, finishedAt: item.createdAt }], audits: [] };

it('관리자 status 경로와 queue items/total을 사용한다', async () => {
  const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/queue') ? { items: [item], total: 1 } : { provider: {}, worker: { status: 'idle' }, summary: { result_unknown: 1 } })));
  vi.stubGlobal('fetch', fetcher);
  await api.fetchMailDeliveryStatus('fixture');
  expect(fetcher.mock.calls[0][0]).toMatch(/\/admin\/mail-delivery\/status$/);
  expect(await api.fetchMailDeliveryQueue('fixture')).toEqual({ items: [item], total: 1 });
});

it('잘못된 큐 응답을 빈 정상목록으로 숨기지 않는다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ queue: [] }))));
  await expect(api.fetchMailDeliveryQueue('fixture')).rejects.toThrow();
});

it('재시도 실제 경로와 strict 중복위험 확인 및 detail 응답을 사용한다', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(detail)));
  vi.stubGlobal('fetch', fetcher);
  const result = await api.retryMailDelivery('fixture', 'q1', true);
  expect(fetcher).toHaveBeenCalledWith(expect.stringMatching(/\/admin\/mail-delivery\/queue\/q1\/retry$/), expect.objectContaining({ method: 'POST', body: JSON.stringify({ confirmDuplicateRisk: true }) }));
  expect(result).toEqual(detail);
});

it('상세를 실제 queue ID 경로로 읽는다', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(detail)));
  vi.stubGlobal('fetch', fetcher);
  expect(await api.fetchMailDeliveryDetail('fixture', 'q1')).toEqual(detail);
  expect(fetcher).toHaveBeenCalledWith(expect.stringMatching(/\/admin\/mail-delivery\/queue\/q1$/), expect.any(Object));
});
