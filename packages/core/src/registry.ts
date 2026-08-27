import type {
  CapabilityManifest,
  CapabilityMode,
  HarnessClient,
  HarnessProfile,
  ProviderAdapterFactory,
  ProviderDescriptor,
} from './contracts.js';
import { HarnessError, isHarnessError } from './errors.js';
import type { ProviderId } from './identifiers.js';

interface RegistryEntry {
  descriptor: ProviderDescriptor;
  factory: ProviderAdapterFactory;
}

/** Dynamic Provider Adapter registry with Profile and capability validation. */
export class HarnessRegistry {
  private readonly entries = new Map<ProviderId, RegistryEntry>();

  /**
   * Register one Provider Adapter factory.
   * @param factory - Independently versioned Adapter factory.
   */
  register(factory: ProviderAdapterFactory): void {
    const descriptor = cloneDescriptor(factory.descriptor());
    validateDescriptor(descriptor);
    if (this.entries.has(descriptor.providerId)) {
      throw new HarnessError(
        'invalid_request',
        `Provider ${descriptor.providerId} is already registered.`,
        { retryable: false, providerId: descriptor.providerId },
      );
    }
    this.entries.set(descriptor.providerId, { descriptor, factory });
  }

  /** @param providerId - Dynamic Provider identifier to remove. */
  unregister(providerId: ProviderId): void {
    this.entries.delete(providerId);
  }

  /** @returns Detached descriptors in registration order. */
  listProviders(): readonly ProviderDescriptor[] {
    return [...this.entries.values()].map(({ descriptor }) =>
      cloneDescriptor(descriptor),
    );
  }

  /**
   * @param providerId - Dynamic Provider identifier.
   * @returns A detached descriptor when registered.
   */
  getProvider(providerId: ProviderId): ProviderDescriptor | undefined {
    const descriptor = this.entries.get(providerId)?.descriptor;
    return descriptor === undefined ? undefined : cloneDescriptor(descriptor);
  }

  /**
   * Connect a Profile and reject inconsistent identity or required capabilities.
   * @param profile - Host-owned connection configuration.
   * @returns A validated active Client.
   */
  async connect(profile: HarnessProfile): Promise<HarnessClient> {
    const requestedProfile = cloneProfile(profile);
    validateProfile(requestedProfile);
    const entry = this.entries.get(requestedProfile.providerId);
    if (entry === undefined) {
      throw new HarnessError(
        'provider_not_found',
        `Provider ${requestedProfile.providerId} is not registered.`,
        {
          retryable: false,
          providerId: requestedProfile.providerId,
          profileId: requestedProfile.profileId,
        },
      );
    }
    if (
      !entry.descriptor.connectionKinds.includes(
        requestedProfile.connection.kind,
      )
    ) {
      throw new HarnessError(
        'profile_invalid',
        `Provider ${requestedProfile.providerId} does not accept ${requestedProfile.connection.kind} connections.`,
        {
          retryable: false,
          providerId: requestedProfile.providerId,
          profileId: requestedProfile.profileId,
        },
      );
    }

    let client: HarnessClient;
    try {
      client = await entry.factory.connect(cloneProfile(requestedProfile));
    } catch (error) {
      if (isHarnessError(error)) throw error;
      throw new HarnessError(
        'connection_failed',
        'Provider connection failed before a Client became available.',
        {
          retryable: true,
          providerId: requestedProfile.providerId,
          profileId: requestedProfile.profileId,
        },
      );
    }

    const clientDescriptor: unknown = await probeConnectedClient(
      client,
      requestedProfile,
      'descriptor',
      () => client.descriptor(),
    );
    if (
      !isRecord(clientDescriptor) ||
      clientDescriptor['providerId'] !== requestedProfile.providerId ||
      clientDescriptor['profileId'] !== requestedProfile.profileId ||
      clientDescriptor['connectionKind'] !== requestedProfile.connection.kind
    ) {
      return rejectConnectedClient(
        client,
        new HarnessError(
          'provider_api_incompatible',
          'Connected Client identity does not match the requested Profile.',
          {
            retryable: false,
            providerId: requestedProfile.providerId,
            profileId: requestedProfile.profileId,
          },
        ),
      );
    }

    const manifest: unknown = await probeConnectedClient(
      client,
      requestedProfile,
      'capabilities',
      () => client.capabilities(),
    );
    if (
      !isCapabilityManifest(manifest) ||
      manifest.providerId !== requestedProfile.providerId ||
      manifest.profileId !== requestedProfile.profileId
    ) {
      return rejectConnectedClient(
        client,
        new HarnessError(
          'provider_api_incompatible',
          'Capability identity does not match the requested Profile.',
          {
            retryable: false,
            providerId: requestedProfile.providerId,
            profileId: requestedProfile.profileId,
          },
        ),
      );
    }
    const unmet = findUnmetCapability(manifest, requestedProfile);
    if (unmet !== undefined) {
      return rejectConnectedClient(
        client,
        new HarnessError(
          'unsupported_capability',
          `Required capability ${unmet} is unavailable.`,
          {
            retryable: false,
            providerId: requestedProfile.providerId,
            profileId: requestedProfile.profileId,
            details: { capability: unmet },
          },
        ),
      );
    }

    return client;
  }
}

function cloneProfile(profile: HarnessProfile): HarnessProfile {
  return {
    profileId: profile.profileId,
    displayName: profile.displayName,
    providerId: profile.providerId,
    connection: cloneConnection(profile.connection),
    ...(profile.providerOptions === undefined
      ? {}
      : { providerOptions: { ...profile.providerOptions } }),
    ...(profile.requiredCapabilities === undefined
      ? {}
      : {
          requiredCapabilities: profile.requiredCapabilities.map(
            (requirement) => ({
              name: requirement.name,
              ...(requirement.acceptedModes === undefined
                ? {}
                : { acceptedModes: [...requirement.acceptedModes] }),
            }),
          ),
        }),
    ...(profile.metadata === undefined
      ? {}
      : { metadata: { ...profile.metadata } }),
  };
}

function cloneConnection(
  connection: HarnessProfile['connection'],
): HarnessProfile['connection'] {
  switch (connection.kind) {
    case 'sdk':
      return { ...connection };
    case 'process':
      return {
        ...connection,
        ...(connection.args === undefined
          ? {}
          : { args: [...connection.args] }),
        ...(connection.envRefs === undefined
          ? {}
          : {
              envRefs: Object.fromEntries(
                Object.entries(connection.envRefs).map(([name, ref]) => [
                  name,
                  { ...ref },
                ]),
              ),
            }),
      };
    case 'endpoint':
    case 'local_socket':
      return {
        ...connection,
        ...(connection.authRef === undefined
          ? {}
          : { authRef: { ...connection.authRef } }),
      };
  }
}

function cloneDescriptor(descriptor: ProviderDescriptor): ProviderDescriptor {
  return {
    ...descriptor,
    connectionKinds: [...descriptor.connectionKinds],
  };
}

function validateDescriptor(descriptor: ProviderDescriptor): void {
  if (
    descriptor.providerId.length === 0 ||
    descriptor.displayName.trim().length === 0 ||
    descriptor.connectionKinds.length === 0
  ) {
    throw new HarnessError(
      'invalid_request',
      'Provider descriptor is incomplete.',
      { retryable: false, providerId: descriptor.providerId },
    );
  }
}

function validateProfile(profile: HarnessProfile): void {
  if (
    profile.profileId.length === 0 ||
    profile.providerId.length === 0 ||
    profile.displayName.trim().length === 0
  ) {
    throw new HarnessError('profile_invalid', 'Profile is incomplete.', {
      retryable: false,
      providerId: profile.providerId,
      profileId: profile.profileId,
    });
  }
}

function findUnmetCapability(
  manifest: CapabilityManifest,
  profile: HarnessProfile,
): string | undefined {
  for (const requirement of profile.requiredCapabilities ?? []) {
    const acceptedModes: readonly CapabilityMode[] =
      requirement.acceptedModes ?? ['native'];
    const observed = manifest.capabilities[requirement.name];
    if (
      !isRecord(observed) ||
      typeof observed.mode !== 'string' ||
      !acceptedModes.includes(observed.mode)
    ) {
      return requirement.name;
    }
  }
  return undefined;
}

function isCapabilityManifest(value: unknown): value is CapabilityManifest {
  return (
    isRecord(value) &&
    typeof value['providerId'] === 'string' &&
    typeof value['profileId'] === 'string' &&
    isRecord(value['capabilities']) &&
    typeof value['observedAt'] === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function probeConnectedClient<T>(
  client: HarnessClient,
  profile: HarnessProfile,
  stage: 'descriptor' | 'capabilities',
  probe: () => Promise<T>,
): Promise<T> {
  try {
    return await probe();
  } catch (error) {
    return rejectConnectedClient(
      client,
      isHarnessError(error)
        ? error
        : new HarnessError(
            'provider_api_incompatible',
            `Connected Client ${stage} probe failed.`,
            {
              retryable: false,
              providerId: profile.providerId,
              profileId: profile.profileId,
              details: { stage },
            },
          ),
    );
  }
}

async function rejectConnectedClient(
  client: HarnessClient,
  validationError: HarnessError,
): Promise<never> {
  try {
    await client.close();
  } catch {
    throw new HarnessError(
      'connection_failed',
      'Connected Client failed validation and did not close cleanly.',
      {
        retryable: false,
        ...(validationError.providerId === undefined
          ? {}
          : { providerId: validationError.providerId }),
        ...(validationError.profileId === undefined
          ? {}
          : { profileId: validationError.profileId }),
        details: { validationCode: validationError.code },
      },
    );
  }
  throw validationError;
}
