import type { HarnessProfile } from '@harapter/core';
import { DSH_PROVIDER_ID } from './protocol.js';
import {
  DSH_GATEWAY_PROTOCOL,
  type DshProviderFactoryOptions,
} from './gateway-types.js';
import {
  gatewayError,
  gatewayRecord,
  gatewayUrl,
} from './gateway-transport.js';
import { gatewayFingerprint, gatewayString } from './gateway-protocol.js';

const defaults = {
  requestTimeoutMs: 30_000,
  runTimeoutMs: 120_000,
  maxMessageBytes: 262_144,
  maxBufferedEvents: 32,
  maxRunEvents: 128,
  maxSessions: 4,
};
const bounds: Record<keyof typeof defaults, readonly [number, number]> = {
  requestTimeoutMs: [1, 2_147_483_647],
  runTimeoutMs: [1, 2_147_483_647],
  maxMessageBytes: [1024, 1_048_576],
  maxBufferedEvents: [2, 256],
  maxRunEvents: [2, 4096],
  maxSessions: [1, 16],
};

/** Numeric limits detached from the caller's mutable Profile. */
export type GatewayLimits = typeof defaults;

/** Validate all local configuration before invoking a host resolver or networking. */
export async function resolveGatewayProfile(
  profile: HarnessProfile,
  factory: DshProviderFactoryOptions,
): Promise<{
  readonly limits: GatewayLimits;
  readonly cookie: string;
  readonly url: string;
  readonly compatibilityRef: string;
}> {
  const connection = profile.connection;
  const options = gatewayRecord(profile.providerOptions);
  const allowed = new Set([
    'protocol',
    'storeId',
    'exclusiveSessions',
    ...Object.keys(defaults),
  ]);
  if (
    profile.providerId !== DSH_PROVIDER_ID ||
    connection.kind !== 'endpoint' ||
    !['host', 'external'].includes(connection.ownership) ||
    (connection.transport !== undefined &&
      connection.transport !== 'websocket') ||
    !gatewayString(connection.authRef?.scheme) ||
    !gatewayString(connection.authRef.id) ||
    factory.resolveGatewayCookie === undefined ||
    options?.['protocol'] !== DSH_GATEWAY_PROTOCOL ||
    options['exclusiveSessions'] !== true ||
    !gatewayString(options['storeId']) ||
    Object.keys(options).some((key) => !allowed.has(key))
  )
    throw gatewayError('profile_invalid');
  const url = gatewayUrl(connection.url).origin;
  const limits = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof GatewayLimits)[]) {
    const value = options[key] ?? defaults[key];
    const [minimum, maximum] = bounds[key];
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < minimum ||
      value > maximum
    )
      throw gatewayError('profile_invalid', 'limit_invalid');
    limits[key] = value;
  }
  if (
    limits.maxMessageBytes *
      (limits.maxBufferedEvents * limits.maxSessions + limits.maxRunEvents) >
    67_108_864
  )
    throw gatewayError('profile_invalid', 'buffer_budget');
  const compatibilityRef = `${DSH_PROVIDER_ID};gateway=${DSH_GATEWAY_PROTOCOL};binding=${gatewayFingerprint([url, options['storeId']])}`;
  const controller = new AbortController();
  try {
    const cookie = await gatewayDeadline(
      Promise.resolve(
        factory.resolveGatewayCookie(
          { ...connection.authRef },
          controller.signal,
        ),
      ),
      limits.requestTimeoutMs,
      () => {
        controller.abort();
      },
    );
    if (typeof cookie !== 'string') throw gatewayError('authentication_failed');
    return { url, limits, cookie, compatibilityRef };
  } catch {
    throw gatewayError('authentication_failed', 'cookie_resolution_failed');
  } finally {
    controller.abort();
  }
}

/** Bound a local asynchronous operation without leaving an unhandled late rejection. */
export async function gatewayDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          onTimeout();
          reject(gatewayError('timeout'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
