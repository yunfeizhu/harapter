import { describe, expect, it, vi } from 'vitest';

import {
  createClaudeNativeClient,
  isClaudeSdkBinding,
  loadOfficialClaudeSdkBinding,
  parseClaudeSdkSessionInfo,
  type ClaudeSdkBinding,
  type ClaudeSdkQuery,
} from '../src/sdk.js';

describe('Claude Agent SDK boundary', () => {
  it('dynamically adapts host-installed official functions', async () => {
    const official = {
      getSessionInfo: vi.fn(),
      query: vi.fn(),
    };
    const nativeQuery: ClaudeSdkQuery = {
      [Symbol.asyncIterator]: () =>
        ({
          next: () => Promise.resolve({ done: true, value: undefined }),
        }) as AsyncIterator<unknown>,
      interrupt: () => Promise.resolve({}),
      close: () => undefined,
    };
    official.getSessionInfo.mockResolvedValue({
      sessionId: '00000000-0000-4000-8000-000000000001',
    });
    official.query.mockReturnValue(nativeQuery);

    const binding = await loadOfficialClaudeSdkBinding(() =>
      Promise.resolve(official),
    );
    await expect(
      binding.getSessionInfo('00000000-0000-4000-8000-000000000001', {
        dir: '/synthetic/workspace',
      }),
    ).resolves.toMatchObject({
      sessionId: '00000000-0000-4000-8000-000000000001',
    });
    const prompt = {
      [Symbol.asyncIterator](): AsyncIterator<
        Readonly<Record<string, unknown>>
      > {
        let done = false;
        return {
          next: () => {
            if (done) return Promise.resolve({ done: true, value: undefined });
            done = true;
            return Promise.resolve({ done: false, value: { type: 'user' } });
          },
        };
      },
    };
    expect(
      binding.query({
        prompt,
        options: {
          abortController: new AbortController(),
          canUseTool: () =>
            Promise.resolve({ behavior: 'deny', message: 'Synthetic deny.' }),
          includePartialMessages: true,
          permissionMode: 'default',
          settingSources: [],
        },
      }),
    ).toBe(nativeQuery);
    expect(official.getSessionInfo).toHaveBeenCalledOnce();
    expect(official.query).toHaveBeenCalledOnce();

    const native = createClaudeNativeClient('synthetic-runtime', binding);
    expect(Object.keys(native.official ?? {}).sort()).toEqual([
      'getSessionInfo',
      'query',
    ]);
  });

  it('fails closed without retaining dynamic import diagnostics', async () => {
    await expect(
      loadOfficialClaudeSdkBinding(() =>
        Promise.reject(new Error('sensitive provider diagnostic')),
      ),
    ).rejects.toMatchObject({
      code: 'runtime_not_found',
      cause: undefined,
      providerCode: 'sdk_peer_missing',
    });
    await expect(
      loadOfficialClaudeSdkBinding(() =>
        Promise.resolve({ query: () => undefined }),
      ),
    ).rejects.toMatchObject({
      code: 'provider_api_incompatible',
      cause: undefined,
      providerCode: 'sdk_peer_shape',
    });
  });

  it('narrows host bindings and keeps injected bindings explicit', () => {
    const binding: ClaudeSdkBinding = {
      sdkVersion: 'synthetic',
      getSessionInfo: () => Promise.resolve(undefined),
      query: () => {
        throw new Error('Synthetic query is not used.');
      },
    };
    expect(isClaudeSdkBinding(binding)).toBe(true);
    expect(createClaudeNativeClient('synthetic-runtime', binding)).toEqual({
      runtimeIdentity: 'synthetic-runtime',
      binding,
    });

    for (const value of [
      undefined,
      null,
      {},
      { ...binding, sdkVersion: '' },
      { ...binding, sdkVersion: 'x'.repeat(129) },
      { ...binding, getSessionInfo: undefined },
      { ...binding, query: undefined },
    ]) {
      expect(isClaudeSdkBinding(value)).toBe(false);
    }
  });

  it('validates only the documented SessionInfo subset', () => {
    expect(parseClaudeSdkSessionInfo(undefined)).toBeUndefined();
    expect(parseClaudeSdkSessionInfo(null)).toBeUndefined();
    expect(parseClaudeSdkSessionInfo([])).toBeUndefined();
    expect(parseClaudeSdkSessionInfo({})).toBeUndefined();
    expect(parseClaudeSdkSessionInfo({ sessionId: '' })).toBeUndefined();
    expect(
      parseClaudeSdkSessionInfo({ sessionId: 'x'.repeat(4_097) }),
    ).toBeUndefined();
    expect(
      parseClaudeSdkSessionInfo({ sessionId: 'synthetic', cwd: 1 }),
    ).toBeUndefined();
    expect(
      parseClaudeSdkSessionInfo({
        sessionId: 'synthetic',
        cwd: 'x'.repeat(4_097),
      }),
    ).toBeUndefined();
    expect(parseClaudeSdkSessionInfo({ sessionId: 'synthetic' })).toEqual({
      sessionId: 'synthetic',
    });
    expect(
      parseClaudeSdkSessionInfo({
        sessionId: 'synthetic',
        cwd: '/synthetic/workspace',
      }),
    ).toEqual({
      sessionId: 'synthetic',
      cwd: '/synthetic/workspace',
    });
  });
});
