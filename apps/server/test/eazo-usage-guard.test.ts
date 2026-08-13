import { describe, expect, it, vi } from 'vitest';

import {
  EazoUsageGuard,
  RemoteUsageGuard
} from '../src/eazo-usage-guard.js';

describe('RemoteUsageGuard', () => {
  it('returns a retry delay after the public request window is full and resets later', () => {
    let now = 1_000;
    const guard = new EazoUsageGuard({
      maxRequestsPerMinute: 2,
      maxConcurrentRequests: 2,
      maxModelRequestsPerDay: 10,
      now: () => now,
      fetch: vi.fn()
    });

    const first = guard.beginPublicRequest();
    const second = guard.beginPublicRequest();
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    if (first.allowed) first.release();
    if (second.allowed) second.release();
    expect(guard.beginPublicRequest()).toEqual({ allowed: false, retryAfterSeconds: 60 });

    now += 60_000;
    expect(guard.beginPublicRequest().allowed).toBe(true);
  });

  it('limits concurrent public inference requests before request bodies are processed', () => {
    const guard = new EazoUsageGuard({
      maxRequestsPerMinute: 10,
      maxConcurrentRequests: 1,
      maxModelRequestsPerDay: 10,
      fetch: vi.fn()
    });

    const first = guard.beginPublicRequest();
    expect(first.allowed).toBe(true);
    expect(guard.beginPublicRequest()).toEqual({ allowed: false, retryAfterSeconds: 1 });
    if (first.allowed) first.release();
    expect(guard.beginPublicRequest().allowed).toBe(true);
  });

  it('caps actual model attempts while leaving the upstream fetch uncalled', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
    const guard = new EazoUsageGuard({
      maxRequestsPerMinute: 10,
      maxConcurrentRequests: 2,
      maxModelRequestsPerDay: 2,
      fetch: fetchMock
    });

    await guard.guardedFetch('https://eazo.example/one');
    await guard.guardedFetch('https://eazo.example/two');
    await expect(guard.guardedFetch('https://eazo.example/three')).rejects.toMatchObject({
      code: 'request_budget_exceeded'
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the EazoUsageGuard export as a backward-compatible alias', () => {
    expect(EazoUsageGuard).toBe(RemoteUsageGuard);
  });
});
