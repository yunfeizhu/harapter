import type { DshGatewayProfileOptions } from '@harapter/adapter-dsh';
import type { OpenClawGatewayBinding } from '@harapter/adapter-openclaw';
import type { PiSdkSessionFactory } from '@harapter/adapter-pi';

/** Alternate existing DSH server connection; the host attests protocol and exclusive store ownership. */
export interface DshGatewayRuntime extends DshGatewayProfileOptions {
  readonly kind: 'dsh-gateway';
  readonly url: string;
  readonly resolveCookie: (signal: AbortSignal) => string | Promise<string>;
}

/** Optional Pi Runtime supplied by the host, never installed or imported by Harapter. */
export interface PiSdkRuntime {
  readonly kind: 'pi-sdk';
  readonly version: '0.85.1';
  readonly createSession: PiSdkSessionFactory;
}

/** ACP remains the Run transport; the host Gateway adds its existing native Session controls. */
export interface OpenClawAcpRuntime {
  readonly kind: 'openclaw-acp';
  readonly gateway: OpenClawGatewayBinding;
}

/** Explicit alternatives to the maintained CLI or HTTP defaults. */
export type HarnessRuntime =
  DshGatewayRuntime | PiSdkRuntime | OpenClawAcpRuntime;

/** Type-checked protocol metadata without eagerly loading the DSH implementation. */
export const DSH_GATEWAY_PROTOCOL: DshGatewayProfileOptions['protocol'] =
  'session-v2-d347e703908d0406b7a7ef80e3a0e594d86b2215';
