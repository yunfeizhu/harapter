import { HarnessRegistry, profileId, type SecretRef } from '@harapter/core';
import {
  OPENCODE_PROVIDER_ID,
  createOpenCodeProviderFactory,
} from '@harapter/adapter-opencode';
import {
  HERMES_PROVIDER_ID,
  createHermesProviderFactory,
} from '@harapter/adapter-hermes';
import {
  DSH_PROVIDER_ID,
  DSH_GATEWAY_PROTOCOL,
  createDshProviderFactory,
} from '@harapter/adapter-dsh';

/** Headers come from the application's credential service, never from a persisted SessionRef. */
export async function connectOpenCode(
  url: string,
  headers: Readonly<Record<string, string>>,
) {
  const registry = new HarnessRegistry();
  registry.register(
    createOpenCodeProviderFactory({
      resolveAuthHeaders: () => Promise.resolve(headers),
    }),
  );
  return registry.connect({
    providerId: OPENCODE_PROVIDER_ID,
    profileId: profileId('my-opencode'),
    displayName: 'Application OpenCode',
    connection: {
      kind: 'endpoint',
      url,
      transport: 'http',
      ownership: 'external',
      authRef: { scheme: 'application', id: 'opencode' },
    },
  });
}

export async function connectHermes(
  url: string,
  headers: Readonly<Record<string, string>>,
) {
  const registry = new HarnessRegistry();
  registry.register(
    createHermesProviderFactory({
      resolveAuthHeaders: () => Promise.resolve(headers),
    }),
  );
  return registry.connect({
    providerId: HERMES_PROVIDER_ID,
    profileId: profileId('my-hermes'),
    displayName: 'Application Hermes',
    connection: {
      kind: 'endpoint',
      url,
      transport: 'http',
      ownership: 'external',
      authRef: { scheme: 'application', id: 'hermes' },
    },
  });
}

/** Call only for Sessions the host has reserved against concurrent external writers. */
export async function connectDshGateway(
  url: string,
  storeId: string,
  resolveCookie: (reference: SecretRef, signal: AbortSignal) => Promise<string>,
) {
  const registry = new HarnessRegistry();
  registry.register(
    createDshProviderFactory({ resolveGatewayCookie: resolveCookie }),
  );
  return registry.connect({
    providerId: DSH_PROVIDER_ID,
    profileId: profileId('my-dsh-gateway'),
    displayName: 'Application DSH Gateway',
    connection: {
      kind: 'endpoint',
      url,
      ownership: 'external',
      authRef: { scheme: 'application', id: 'dsh-cookie' },
    },
    providerOptions: {
      protocol: DSH_GATEWAY_PROTOCOL,
      storeId,
      exclusiveSessions: true,
    },
  });
}
