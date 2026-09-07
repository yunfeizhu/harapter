import { profileId, type HarnessProfile } from '@harapter/core';
import { describe, expect, it, vi } from 'vitest';
import { resolveGatewayProfile } from '../src/gateway-config.js';
import { DSH_GATEWAY_PROTOCOL } from '../src/gateway-types.js';
import { DSH_PROVIDER_ID } from '../src/protocol.js';

const profile: HarnessProfile = {
  providerId: DSH_PROVIDER_ID,
  profileId: profileId('synthetic'),
  displayName: 'Synthetic',
  connection: {
    kind: 'endpoint',
    url: 'http://127.0.0.1:9999',
    ownership: 'host',
    authRef: { scheme: 'synthetic', id: 'cookie' },
  },
  providerOptions: {
    protocol: DSH_GATEWAY_PROTOCOL,
    storeId: 'synthetic-store',
    exclusiveSessions: true,
  },
};

describe('DSH Gateway host-owned configuration', () => {
  it('resolves a secret reference while binding only non-secret store identity', async () => {
    const resolver = vi.fn(() => 'synthetic=cookie');
    const resolved = await resolveGatewayProfile(profile, {
      resolveGatewayCookie: resolver,
    });
    expect(resolver).toHaveBeenCalledWith(
      { scheme: 'synthetic', id: 'cookie' },
      expect.any(AbortSignal),
    );
    expect(resolved.compatibilityRef).not.toContain('synthetic-store');
    expect(resolved.compatibilityRef).not.toContain('synthetic=cookie');
    expect(resolved.limits.maxSessions).toBe(4);
  });

  it.each([
    { protocol: 'future' },
    { storeId: '' },
    { exclusiveSessions: false },
    { ignored: true },
    { maxMessageBytes: 0 },
    { requestTimeoutMs: -1 },
    { runTimeoutMs: 2_147_483_648 },
    { maxRunEvents: 1 },
    { maxSessions: 17 },
    { maxBufferedEvents: 0.5 },
    { maxMessageBytes: 1_048_576, maxBufferedEvents: 256, maxSessions: 16 },
    {
      maxMessageBytes: 1_048_576,
      maxBufferedEvents: 2,
      maxSessions: 1,
      maxRunEvents: 4096,
    },
  ])(
    'rejects invalid options before resolving credentials %#',
    async (options) => {
      const resolver = vi.fn(() => 'synthetic=cookie');
      await expect(
        resolveGatewayProfile(
          {
            ...profile,
            providerOptions: { ...profile.providerOptions, ...options },
          },
          { resolveGatewayCookie: resolver },
        ),
      ).rejects.toMatchObject({ code: 'profile_invalid' });
      expect(resolver).not.toHaveBeenCalled();
    },
  );

  it.each([
    'not-a-url',
    'http://example.invalid',
    'http://user:secret@localhost',
    'http://localhost/?token=secret',
    'http://localhost/path',
    'file:///synthetic',
    'http://localhost/#fragment',
  ])('rejects a credential-bearing or unsupported endpoint %#', async (url) => {
    await expect(
      resolveGatewayProfile(
        {
          ...profile,
          connection: {
            kind: 'endpoint',
            url,
            ownership: 'external',
            authRef: { scheme: 'synthetic', id: 'cookie' },
          },
        },
        { resolveGatewayCookie: () => 'synthetic=cookie' },
      ),
    ).rejects.toMatchObject({ code: 'profile_invalid' });
  });

  it('contains resolver errors and late rejection after a deadline', async () => {
    const configured = {
      ...profile,
      providerOptions: { ...profile.providerOptions, requestTimeoutMs: 5 },
    };
    await expect(
      resolveGatewayProfile(configured, {
        resolveGatewayCookie: () => {
          throw new Error('synthetic secret');
        },
      }),
    ).rejects.toMatchObject({
      code: 'authentication_failed',
      providerCode: 'cookie_resolution_failed',
    });
    let rejectLate: ((error: Error) => void) | undefined;
    const result = resolveGatewayProfile(configured, {
      resolveGatewayCookie: (_ref, signal) =>
        new Promise<string>((_resolve, reject) => {
          rejectLate = reject;
          signal.addEventListener(
            'abort',
            () => {
              expect(signal.aborted).toBe(true);
            },
            { once: true },
          );
        }),
    });
    await expect(result).rejects.toMatchObject({
      code: 'authentication_failed',
    });
    rejectLate?.(new Error('synthetic secret'));
  });
});
