import type { HarnessSession, SecretRef, SessionRef } from '@harapter/core';

/** Assessed Session v2 Gateway protocol; this is not a runtime version claim. */
export const DSH_GATEWAY_PROTOCOL =
  'session-v2-d347e703908d0406b7a7ef80e3a0e594d86b2215';

/** Native Session controls with deliberately Session-wide cancellation. */
export const DSH_GATEWAY_SESSION_EXTENSION =
  'deepseek.harness.gateway.sessions';

/** Host dependencies; authentication remains outside serialized Profiles. */
export interface DshProviderFactoryOptions {
  readonly resolveGatewayCookie?: (
    reference: SecretRef,
    signal: AbortSignal,
  ) => string | Promise<string>;
}

/** Explicit host attestation and bounds for the experimental Gateway strategy. */
export interface DshGatewayProfileOptions {
  readonly protocol: typeof DSH_GATEWAY_PROTOCOL;
  readonly storeId: string;
  readonly exclusiveSessions: true;
  readonly requestTimeoutMs?: number;
  readonly runTimeoutMs?: number;
  readonly maxMessageBytes?: number;
  readonly maxBufferedEvents?: number;
  readonly maxRunEvents?: number;
  readonly maxSessions?: number;
}

/** Controls on references owned by this Gateway Profile and native store. */
export interface DshGatewaySessions {
  fork(ref: SessionRef): Promise<HarnessSession>;
  cancelSession(ref: SessionRef): Promise<{ readonly accepted: true }>;
}

/** Deliberately narrow native access; no unbounded arbitrary RPC escape hatch. */
export interface DshGatewayNativeClient extends DshGatewaySessions {
  readonly protocol: typeof DSH_GATEWAY_PROTOCOL;
  readonly runtimeIdentity: string;
}
