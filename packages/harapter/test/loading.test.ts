import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HarapterOptions, HarnessName } from 'harapter';

afterEach(() => {
  vi.doUnmock('@harapter/adapter-dsh');
  vi.resetModules();
});

describe('selected adapter loading', () => {
  it.each([
    null,
    'dsh',
    {},
    { harnesses: 'dsh' },
    { harnesses: ['dsh', 'unknown'] },
    { harnesses: ['__proto__'] },
    { harnesses: [1] },
  ])('rejects invalid selection before loading code', async (input) => {
    const load = vi.fn(() => {
      throw new Error('must not load');
    });
    vi.doMock('@harapter/adapter-dsh', load);
    const { createHarapter } = await import('harapter');
    await expect(
      createHarapter(input as unknown as HarapterOptions),
    ).rejects.toMatchObject({ code: 'invalid_request', retryable: false });
    expect(load).not.toHaveBeenCalled();
  });

  it('does not import an unselected protocol implementation', async () => {
    const load = vi.fn(() => {
      throw new Error('must not load');
    });
    vi.doMock('@harapter/adapter-dsh', load);
    const { createHarapter } = await import('harapter');
    const registry = await createHarapter({ harnesses: ['pi'] });
    expect(registry.listProviders().map((value) => value.providerId)).toEqual([
      'pi.agent',
    ]);
    expect(load).not.toHaveBeenCalled();
  });

  it('snapshots selection and leaves host secrets untouched until connection', async () => {
    const { createHarapter } = await import('harapter');
    const harnesses: HarnessName[] = ['dsh', 'hermes'];
    const resolveGatewayCookie = vi.fn(() => 'synthetic-cookie');
    const resolveAuthHeaders = vi.fn(() => ({
      authorization: 'synthetic-token',
    }));
    const pending = createHarapter({
      harnesses,
      resolveGatewayCookie,
      resolveAuthHeaders,
    });
    harnesses.splice(0, 2, 'pi');
    const registry = await pending;
    expect(
      registry
        .listProviders()
        .map((entry) => entry.providerId)
        .sort(),
    ).toEqual(['deepseek.harness', 'nous.hermes-agent']);
    expect(resolveGatewayCookie).not.toHaveBeenCalled();
    expect(resolveAuthHeaders).not.toHaveBeenCalled();
  });

  it('redacts failures from adapter initialization', async () => {
    vi.doMock('@harapter/adapter-dsh', () => ({
      createDshProviderFactory: () => {
        throw new Error('synthetic-private-path-and-token');
      },
    }));
    const { createHarapter } = await import('harapter');
    const failure = await createHarapter({ harnesses: ['dsh'] }).catch(
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({
      code: 'provider_api_incompatible',
      retryable: false,
      details: { harness: 'dsh' },
      cause: undefined,
    });
    expect(String(failure)).not.toContain('synthetic-private');
  });
});
