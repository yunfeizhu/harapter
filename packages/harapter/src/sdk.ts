import {
  HarnessError,
  HarnessRegistry,
  type ProviderAdapterFactory,
  type SecretRef,
} from '@harapter/core';
import type { OpenClawGatewayBinding } from '@harapter/adapter-openclaw';

/** Maintained protocol implementations included in Harapter. */
export type HarnessName =
  'codex' | 'dsh' | 'hermes' | 'openclaw' | 'opencode' | 'pi';

/** Select protocols and supply host-owned authentication without starting a Runtime. */
export interface HarapterOptions {
  readonly harnesses: readonly HarnessName[];
  readonly openClawGateway?: OpenClawGatewayBinding;
  readonly resolveAuthHeaders?: (
    reference: SecretRef,
  ) =>
    | Readonly<Record<string, string>>
    | Promise<Readonly<Record<string, string>>>;
  readonly resolveGatewayCookie?: (
    reference: SecretRef,
    signal: AbortSignal,
  ) => string | Promise<string>;
}

// These first-party implementations are bundled as private chunks at publication.
// No upstream Runtime or SDK is imported, installed or discovered here.
const loaders = {
  codex: async () =>
    (await import('@harapter/adapter-codex')).createCodexProviderFactory(),
  dsh: async (options) =>
    (await import('@harapter/adapter-dsh')).createDshProviderFactory(
      options.resolveGatewayCookie
        ? { resolveGatewayCookie: options.resolveGatewayCookie }
        : {},
    ),
  hermes: async (options) =>
    (await import('@harapter/adapter-hermes')).createHermesProviderFactory(
      options.resolveAuthHeaders
        ? { resolveAuthHeaders: options.resolveAuthHeaders }
        : {},
    ),
  openclaw: async (options) =>
    (await import('@harapter/adapter-openclaw')).createOpenClawProviderFactory(
      options.openClawGateway === undefined
        ? {}
        : { gateway: options.openClawGateway },
    ),
  opencode: async (options) =>
    (await import('@harapter/adapter-opencode')).createOpenCodeProviderFactory(
      options.resolveAuthHeaders
        ? { resolveAuthHeaders: options.resolveAuthHeaders }
        : {},
    ),
  pi: async () =>
    (await import('@harapter/adapter-pi')).createPiProviderFactory(),
} satisfies Record<
  HarnessName,
  (options: HarapterOptions) => Promise<ProviderAdapterFactory>
>;

/**
 * Load selected Harapter protocols into an independent portable Registry.
 * @param options - Explicit selection and host secret resolvers; omitted means an empty registry.
 * @returns A Registry whose connect(Profile) selects the Runtime. The caller owns each Client.
 * @throws HarnessError for invalid selection or an unusable bundled implementation.
 */
export async function createHarapter(
  options: HarapterOptions = { harnesses: [] },
): Promise<HarnessRegistry> {
  let snapshot: HarapterOptions;
  try {
    const names = readSelection(options);
    if (!names) {
      throw new HarnessError(
        'invalid_request',
        'Select maintained Harapter harness names.',
        { retryable: false },
      );
    }
    // Snapshot configuration before the first import yields to application code.
    const selected = [...new Set(names)];
    snapshot = {
      harnesses: selected,
      ...(options.openClawGateway === undefined
        ? {}
        : {
            openClawGateway: {
              profileId: options.openClawGateway.profileId,
              methods: [...options.openClawGateway.methods],
              request: options.openClawGateway.request.bind(
                options.openClawGateway,
              ),
            },
          }),
      ...(options.resolveAuthHeaders === undefined
        ? {}
        : {
            resolveAuthHeaders: options.resolveAuthHeaders.bind(options),
          }),
      ...(options.resolveGatewayCookie === undefined
        ? {}
        : {
            resolveGatewayCookie: options.resolveGatewayCookie.bind(options),
          }),
    };
  } catch {
    throw new HarnessError(
      'invalid_request',
      'The Harapter configuration could not be read.',
      { retryable: false },
    );
  }
  const selected = snapshot.harnesses;
  const registry = new HarnessRegistry();
  for (const name of selected) {
    try {
      const load: (value: HarapterOptions) => Promise<ProviderAdapterFactory> =
        loaders[name];
      registry.register(await load(snapshot));
    } catch {
      throw new HarnessError(
        'provider_api_incompatible',
        'The selected Harapter protocol implementation could not initialize.',
        {
          retryable: false,
          details: { harness: name },
        },
      );
    }
  }
  return registry;
}

function readSelection(value: unknown): readonly HarnessName[] | undefined {
  if (typeof value !== 'object' || value === null || !('harnesses' in value))
    return undefined;
  const names: unknown = value.harnesses;
  if (
    !Array.isArray(names) ||
    !names.every(
      (name: unknown): name is HarnessName =>
        typeof name === 'string' && Object.hasOwn(loaders, name),
    )
  )
    return undefined;
  return names;
}
