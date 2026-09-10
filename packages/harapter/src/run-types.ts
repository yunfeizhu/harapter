import type { HarnessEvent } from '@harapter/core';
import type { HarnessName } from './sdk.js';
import type { HarnessRuntime } from './runtime-types.js';

/** Model selection interpreted by the selected Runtime, never a Harapter model route. */
export interface RunModel {
  readonly id: string;
  readonly provider?: string;
}

/** One task using a built-in Runtime connection; no application Registry is required. */
export interface RuntimeOptions {
  readonly harness: HarnessName;
  /** Omit for the normal machine-interface default; reusable across run() and openSession(). */
  readonly runtime?: HarnessRuntime;
  /** Local process directory, or an explicit absolute server-side directory for HTTP. */
  readonly cwd?: string;
  readonly model?: RunModel;
  /** Local executable name on PATH or exact path. Never executed through a shell. */
  readonly command?: string;
  /** Replaces the default machine-interface arguments; does not include the executable. */
  readonly args?: readonly string[];
  /** HTTP endpoint for OpenCode or Hermes; their loopback endpoints are the defaults. */
  readonly url?: string;
  /** Host-supplied HTTP authentication, retained only in a private resolver closure. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Whole-call deadline, including connection and asynchronous event handlers; default 60000. */
  readonly timeoutMs?: number;
}

/** Per-message helper controls; start() exposes the lower-level interactive Run API. */
export interface SendOptions {
  readonly timeoutMs?: number;
  /** Receives Provider-mapped payloads inside the host boundary; never logged by Harapter. */
  readonly onEvent?: (event: HarnessEvent) => void | Promise<void>;
}

/** One independent text task on the selected Runtime. */
export interface RunRequest extends RuntimeOptions, SendOptions {
  readonly input: string;
}
