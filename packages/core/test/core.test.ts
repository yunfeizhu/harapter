import { describe, expect, it, vi } from 'vitest';
import {
  ExtensionRegistry,
  HarnessError,
  HarnessRegistry,
  assertSessionCompatibility,
  assertSessionOwnership,
  isHarnessError,
  profileId,
  providerId,
  providerSessionId,
  type CapabilityManifest,
  type HarnessClient,
  type HarnessProfile,
  type ProviderAdapterFactory,
  type ProviderDescriptor,
} from '../src/index.js';

const testProviderId = providerId('test.provider');
const testProfileId = profileId('test-profile');

function descriptor(
  overrides: Partial<ProviderDescriptor> = {},
): ProviderDescriptor {
  return {
    providerId: testProviderId,
    displayName: 'Test Provider',
    connectionKinds: ['sdk'],
    ...overrides,
  };
}

function profile(overrides: Partial<HarnessProfile> = {}): HarnessProfile {
  return {
    profileId: testProfileId,
    displayName: 'Test Profile',
    providerId: testProviderId,
    connection: { kind: 'sdk', ownership: 'host', client: {} },
    ...overrides,
  };
}

function manifest(
  overrides: Partial<CapabilityManifest> = {},
): CapabilityManifest {
  return {
    providerId: testProviderId,
    profileId: testProfileId,
    capabilities: {
      'session.create': { mode: 'native', source: 'schema' },
      'session.close': { mode: 'adapter_controlled' },
      'event.usage': { mode: 'emulated', source: 'configuration' },
      'session.fork': { mode: 'unknown', source: 'handshake' },
    },
    observedAt: '2026-08-27T00:00:00.000Z',
    ...overrides,
  };
}

function client(
  overrides: Partial<HarnessClient> = {},
): HarnessClient & { close: ReturnType<typeof vi.fn> } {
  const close =
    overrides.close === undefined
      ? vi.fn(() => Promise.resolve())
      : vi.fn(overrides.close);
  return {
    descriptor: () =>
      Promise.resolve({
        providerId: testProviderId,
        profileId: testProfileId,
        displayName: 'Test Client',
        connectionKind: 'sdk',
        compatibility: 'supported',
      }),
    capabilities: () => Promise.resolve(manifest()),
    createSession: () => Promise.reject(new Error('not used by this test')),
    resumeSession: () => Promise.reject(new Error('not used by this test')),
    extensions: () => new ExtensionRegistry(testProviderId),
    native: () => undefined,
    ...overrides,
    close,
  };
}

function factory(
  adapterClient: HarnessClient,
  adapterDescriptor: ProviderDescriptor = descriptor(),
): ProviderAdapterFactory & { connect: ReturnType<typeof vi.fn> } {
  return {
    descriptor: () => adapterDescriptor,
    connect: vi.fn(() => Promise.resolve(adapterClient)),
  };
}

describe('opaque identifiers', () => {
  it('preserves valid identifiers and rejects ambiguous values', () => {
    expect(providerId('dynamic.provider')).toBe('dynamic.provider');
    expect(profileId('profile-a')).toBe('profile-a');
    expect(providerSessionId('native-session')).toBe('native-session');

    for (const invalid of ['', ' ', ' padded']) {
      expect(() => providerId(invalid)).toThrow(HarnessError);
    }
  });
});

describe('HarnessError', () => {
  it('retains stable diagnostics without inferring retryability', () => {
    const cause = new Error('redacted provider cause');
    const error = new HarnessError('connection_failed', 'Connection failed', {
      retryable: true,
      providerId: testProviderId,
      profileId: testProfileId,
      providerCode: 'E_CONNECT',
      details: { stage: 'handshake' },
      cause,
    });

    expect(error).toMatchObject({
      name: 'HarnessError',
      code: 'connection_failed',
      retryable: true,
      providerId: testProviderId,
      profileId: testProfileId,
      providerCode: 'E_CONNECT',
      details: { stage: 'handshake' },
      cause,
    });
    expect(isHarnessError(error)).toBe(true);
    expect(isHarnessError(new Error('ordinary error'))).toBe(false);
  });
});

describe('HarnessRegistry', () => {
  it('registers dynamic providers and connects multiple profiles', async () => {
    const registry = new HarnessRegistry();
    const adapterClient = client();
    const adapter = factory(adapterClient);
    registry.register(adapter);

    expect(registry.listProviders()).toEqual([descriptor()]);
    expect(registry.getProvider(testProviderId)).toEqual(descriptor());
    expect(await registry.connect(profile())).toBe(adapterClient);

    const secondProfileId = profileId('test-profile-2');
    const secondClient = client({
      descriptor: () =>
        Promise.resolve({
          providerId: testProviderId,
          profileId: secondProfileId,
          displayName: 'Second Client',
          connectionKind: 'sdk',
          compatibility: 'supported',
        }),
      capabilities: () =>
        Promise.resolve(manifest({ profileId: secondProfileId })),
    });
    adapter.connect.mockResolvedValueOnce(secondClient);
    expect(
      await registry.connect(profile({ profileId: secondProfileId })),
    ).toBe(secondClient);
    expect(adapter.connect.mock.calls).toHaveLength(2);

    registry.unregister(testProviderId);
    expect(registry.listProviders()).toEqual([]);
    expect(registry.getProvider(testProviderId)).toBeUndefined();
  });

  it('rejects duplicate, missing, and unsupported registrations', async () => {
    const registry = new HarnessRegistry();
    const adapter = factory(client());
    registry.register(adapter);

    expect(() => {
      registry.register(adapter);
    }).toThrow(HarnessError);
    await expect(
      new HarnessRegistry().connect(profile()),
    ).rejects.toMatchObject({ code: 'provider_not_found' });
    await expect(
      registry.connect(
        profile({
          connection: {
            kind: 'endpoint',
            url: 'https://example.invalid',
            ownership: 'external',
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'profile_invalid' });
    expect(adapter.connect.mock.calls).toHaveLength(0);
  });

  it('validates descriptors and Profiles at their runtime entry points', async () => {
    const registry = new HarnessRegistry();
    expect(() => {
      registry.register(factory(client(), descriptor({ displayName: ' ' })));
    }).toThrow(HarnessError);
    expect(() => {
      registry.register(factory(client(), descriptor({ connectionKinds: [] })));
    }).toThrow(HarnessError);

    registry.register(factory(client()));
    await expect(
      registry.connect(profile({ displayName: ' ' })),
    ).rejects.toMatchObject({ code: 'profile_invalid' });
  });

  it('preserves mapped connection errors and safely categorizes unknown errors', async () => {
    const mapped = new HarnessError(
      'authentication_failed',
      'Authentication failed.',
      { retryable: false },
    );
    const mappedRegistry = new HarnessRegistry();
    mappedRegistry.register({
      descriptor,
      connect: () => Promise.reject(mapped),
    });
    await expect(mappedRegistry.connect(profile())).rejects.toBe(mapped);

    const unknownRegistry = new HarnessRegistry();
    unknownRegistry.register({
      descriptor,
      connect: () => Promise.reject(new Error('unsafe upstream details')),
    });
    await expect(unknownRegistry.connect(profile())).rejects.toMatchObject({
      code: 'connection_failed',
      cause: undefined,
    });
  });

  it('isolates validation identity and requirements from Adapter mutation', async () => {
    const registry = new HarnessRegistry();
    const requestedProfile = profile({
      requiredCapabilities: [{ name: 'session.create' }],
    });
    const changedProviderId = providerId('mutated.provider');
    const changedProfileId = profileId('mutated-profile');
    const mutatedClient = client({
      descriptor: () =>
        Promise.resolve({
          providerId: changedProviderId,
          profileId: changedProfileId,
          displayName: 'Mutated Client',
          connectionKind: 'sdk',
          compatibility: 'supported',
        }),
    });
    registry.register({
      descriptor,
      connect: (receivedProfile) => {
        Object.assign(receivedProfile, {
          providerId: changedProviderId,
          profileId: changedProfileId,
          requiredCapabilities: [],
        });
        return Promise.resolve(mutatedClient);
      },
    });

    await expect(registry.connect(requestedProfile)).rejects.toMatchObject({
      code: 'provider_api_incompatible',
    });
    expect(requestedProfile).toMatchObject({
      providerId: testProviderId,
      profileId: testProfileId,
      requiredCapabilities: [{ name: 'session.create' }],
    });
    expect(mutatedClient.close.mock.calls).toHaveLength(1);
  });

  it('isolates structured process connection fields passed to an Adapter', async () => {
    const registry = new HarnessRegistry();
    const processClient = client({
      descriptor: () =>
        Promise.resolve({
          providerId: testProviderId,
          profileId: testProfileId,
          displayName: 'Process Client',
          connectionKind: 'process',
          compatibility: 'supported',
        }),
    });
    let receivedProfile: HarnessProfile | undefined;
    registry.register({
      descriptor: () => descriptor({ connectionKinds: ['process'] }),
      connect: (received) => {
        receivedProfile = received;
        return Promise.resolve(processClient);
      },
    });
    const requestedProfile = profile({
      connection: {
        kind: 'process',
        command: 'synthetic-runtime',
        args: ['--machine'],
        envRefs: {
          SYNTHETIC_TOKEN: { scheme: 'test-secret', id: 'synthetic-token' },
        },
        ownership: 'adapter',
      },
      providerOptions: { mode: 'synthetic' },
      metadata: { purpose: 'clone-test' },
    });

    await expect(registry.connect(requestedProfile)).resolves.toBe(
      processClient,
    );
    expect(receivedProfile).toBeDefined();
    expect(receivedProfile).not.toBe(requestedProfile);
    expect(receivedProfile?.connection).not.toBe(requestedProfile.connection);
    if (
      receivedProfile?.connection.kind !== 'process' ||
      requestedProfile.connection.kind !== 'process'
    ) {
      throw new Error('Expected process Profiles for clone evidence.');
    }
    expect(receivedProfile.connection.args).not.toBe(
      requestedProfile.connection.args,
    );
    expect(receivedProfile.connection.envRefs).not.toBe(
      requestedProfile.connection.envRefs,
    );
    expect(receivedProfile.providerOptions).not.toBe(
      requestedProfile.providerOptions,
    );
    expect(receivedProfile.metadata).not.toBe(requestedProfile.metadata);
    await processClient.close();
  });

  it('closes a connected Client and redacts unknown probe failures', async () => {
    const descriptorFailureClient = client({
      descriptor: () =>
        Promise.reject(new Error('unsafe descriptor provider details')),
    });
    const descriptorRegistry = new HarnessRegistry();
    descriptorRegistry.register(factory(descriptorFailureClient));

    const descriptorError = await descriptorRegistry
      .connect(profile())
      .catch((error: unknown) => error);
    expect(descriptorError).toMatchObject({
      code: 'provider_api_incompatible',
      cause: undefined,
    });
    expect(String(descriptorError)).not.toContain('unsafe descriptor');
    expect(descriptorFailureClient.close.mock.calls).toHaveLength(1);

    const capabilityFailureClient = client({
      capabilities: () =>
        Promise.reject(new Error('unsafe capability provider details')),
    });
    const capabilityRegistry = new HarnessRegistry();
    capabilityRegistry.register(factory(capabilityFailureClient));

    const capabilityError = await capabilityRegistry
      .connect(profile())
      .catch((error: unknown) => error);
    expect(capabilityError).toMatchObject({
      code: 'provider_api_incompatible',
      cause: undefined,
    });
    expect(String(capabilityError)).not.toContain('unsafe capability');
    expect(capabilityFailureClient.close.mock.calls).toHaveLength(1);
  });

  it('closes clients whose descriptor or capability identity is invalid', async () => {
    const wrongProvider = providerId('wrong.provider');
    const wrongDescriptorClient = client({
      descriptor: () =>
        Promise.resolve({
          providerId: wrongProvider,
          profileId: testProfileId,
          displayName: 'Wrong Client',
          connectionKind: 'sdk',
          compatibility: 'unsupported',
        }),
    });
    const registry = new HarnessRegistry();
    registry.register(factory(wrongDescriptorClient));

    await expect(registry.connect(profile())).rejects.toMatchObject({
      code: 'provider_api_incompatible',
    });
    expect(wrongDescriptorClient.close.mock.calls).toHaveLength(1);

    const wrongManifestClient = client({
      capabilities: () =>
        Promise.resolve(manifest({ providerId: wrongProvider })),
    });
    const secondRegistry = new HarnessRegistry();
    secondRegistry.register(factory(wrongManifestClient));
    await expect(secondRegistry.connect(profile())).rejects.toMatchObject({
      code: 'provider_api_incompatible',
    });
    expect(wrongManifestClient.close.mock.calls).toHaveLength(1);

    const wrongProfileId = profileId('wrong-profile');
    const wrongIdentityClient = client({
      descriptor: () =>
        Promise.resolve({
          providerId: testProviderId,
          profileId: wrongProfileId,
          displayName: 'Wrong Profile Client',
          connectionKind: 'endpoint',
          compatibility: 'unsupported',
        }),
    });
    const thirdRegistry = new HarnessRegistry();
    thirdRegistry.register(factory(wrongIdentityClient));
    await expect(thirdRegistry.connect(profile())).rejects.toMatchObject({
      code: 'provider_api_incompatible',
    });
  });

  it('surfaces cleanup failure when rejecting an invalid Client', async () => {
    const invalidClient = client({
      descriptor: () =>
        Promise.resolve({
          providerId: providerId('wrong.provider'),
          profileId: testProfileId,
          displayName: 'Invalid Client',
          connectionKind: 'sdk',
          compatibility: 'unsupported',
        }),
      close: () => Promise.reject(new Error('cleanup failed')),
    });
    const registry = new HarnessRegistry();
    registry.register(factory(invalidClient));

    await expect(registry.connect(profile())).rejects.toMatchObject({
      code: 'connection_failed',
      details: { validationCode: 'provider_api_incompatible' },
    });
  });

  it('enforces required capability modes before returning a client', async () => {
    const rejectedClient = client();
    const rejectedRegistry = new HarnessRegistry();
    rejectedRegistry.register(factory(rejectedClient));

    await expect(
      rejectedRegistry.connect(
        profile({
          requiredCapabilities: [{ name: 'session.close' }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'unsupported_capability' });
    expect(rejectedClient.close.mock.calls).toHaveLength(1);

    const missingClient = client({
      capabilities: () => Promise.resolve(manifest({ capabilities: {} })),
    });
    const missingRegistry = new HarnessRegistry();
    missingRegistry.register(factory(missingClient));
    await expect(
      missingRegistry.connect(
        profile({
          requiredCapabilities: [{ name: 'session.create' }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'unsupported_capability' });

    const acceptedClient = client();
    const acceptedRegistry = new HarnessRegistry();
    acceptedRegistry.register(factory(acceptedClient));
    await expect(
      acceptedRegistry.connect(
        profile({
          requiredCapabilities: [
            {
              name: 'session.close',
              acceptedModes: ['adapter_controlled'],
            },
          ],
        }),
      ),
    ).resolves.toBe(acceptedClient);

    const emulatedClient = client();
    const emulatedRegistry = new HarnessRegistry();
    emulatedRegistry.register(factory(emulatedClient));
    await expect(
      emulatedRegistry.connect(
        profile({
          requiredCapabilities: [
            { name: 'event.usage', acceptedModes: ['emulated'] },
          ],
        }),
      ),
    ).resolves.toBe(emulatedClient);

    const unknownClient = client();
    const unknownRegistry = new HarnessRegistry();
    unknownRegistry.register(factory(unknownClient));
    await expect(
      unknownRegistry.connect(
        profile({ requiredCapabilities: [{ name: 'session.fork' }] }),
      ),
    ).rejects.toMatchObject({ code: 'unsupported_capability' });
  });
});

describe('session ownership', () => {
  const ref = {
    providerId: testProviderId,
    profileId: testProfileId,
    providerSessionId: providerSessionId('session-1'),
  };

  it('accepts only the provider and profile that created a session', () => {
    expect(() => {
      assertSessionOwnership(ref, testProviderId, testProfileId);
    }).not.toThrow();
    expect(() => {
      assertSessionOwnership(ref, providerId('other.provider'), testProfileId);
    }).toThrow(HarnessError);
    expect(() => {
      assertSessionOwnership(ref, testProviderId, profileId('other-profile'));
    }).toThrow(HarnessError);
  });

  it('accepts only the runtime compatibility identity that created a session', () => {
    const compatibleRef = {
      ...ref,
      compatibilityRef: 'runtime@1;protocol=1',
    };

    expect(() => {
      assertSessionCompatibility(compatibleRef, 'runtime@1;protocol=1');
    }).not.toThrow();
    expect(() => {
      assertSessionCompatibility(compatibleRef, 'runtime@2;protocol=2');
    }).toThrow(HarnessError);
  });
});

describe('ExtensionRegistry', () => {
  it('registers typed extensions and returns detached descriptors', () => {
    const extensions = new ExtensionRegistry(testProviderId);
    const extension = { echo: (value: string) => value };
    const dispose = extensions.register(
      {
        name: 'test.provider.echo',
        providerId: testProviderId,
        displayName: 'Echo',
        stability: 'experimental',
      },
      extension,
    );

    expect(extensions.has('test.provider.echo')).toBe(true);
    expect(extensions.get<typeof extension>('test.provider.echo')).toBe(
      extension,
    );
    expect(
      extensions.get(
        'test.provider.echo',
        (value): value is typeof extension =>
          typeof value === 'object' && value !== null && 'echo' in value,
      ),
    ).toBe(extension);
    expect(
      extensions.get(
        'test.provider.echo',
        (_value): _value is { unavailable: true } => false,
      ),
    ).toBeUndefined();
    expect(extensions.get('test.provider.missing')).toBeUndefined();
    expect(extensions.list()).toEqual([
      {
        name: 'test.provider.echo',
        providerId: testProviderId,
        displayName: 'Echo',
        stability: 'experimental',
      },
    ]);

    expect(() =>
      extensions.register(
        {
          name: 'test.provider.echo',
          providerId: testProviderId,
          displayName: 'Duplicate',
        },
        {},
      ),
    ).toThrow(HarnessError);
    expect(() =>
      extensions.register(
        {
          name: 'wrong.provider.echo',
          providerId: providerId('wrong.provider'),
          displayName: 'Wrong Provider',
        },
        {},
      ),
    ).toThrow(HarnessError);

    dispose();
    dispose();
    expect(extensions.has('test.provider.echo')).toBe(false);
  });
});
