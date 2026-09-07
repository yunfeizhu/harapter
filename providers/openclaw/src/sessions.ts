import {
  HarnessError,
  type HarnessSession,
  type ProfileId,
  type SessionRef,
} from '@harapter/core';

/** Native Gateway transcript forking, separately bound by the host. */
export const OPENCLAW_SESSION_EXTENSION = 'openclaw.gateway.sessions';

/** The host binds an authenticated Gateway connection to the same ACP Profile.
 * `methods` comes from that connection's hello.features.methods. The host owns
 * authentication, reconnection, exclusive Session writers, and final disposal.
 * Implementations must respect the operation signal and must not log traffic.
 */
export interface OpenClawGatewayBinding {
  readonly profileId: ProfileId;
  readonly methods: readonly string[];
  request(
    method: 'sessions.list' | 'sessions.create',
    params: Readonly<Record<string, unknown>>,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<unknown>;
}

/** Copies through the last completed assistant message without submitting input. */
export interface OpenClawSessions {
  fork(ref: SessionRef): Promise<HarnessSession>;
}

export interface OpenClawForkSource {
  readonly key: string;
  readonly sessionId: string;
  readonly permissionMode: unknown;
  readonly spawnedCwd: unknown;
}

/** List with an exact isolated route filter; never accept a fuzzy match. */
export function parseOpenClawForkSource(
  value: unknown,
  sessionKey: string,
): OpenClawForkSource {
  const rows = record(value)?.['sessions'];
  if (!Array.isArray(rows) || rows.length !== 1) throw incompatible();
  const row = record(rows[0]);
  if (row === undefined) throw incompatible();
  const key = row['key'];
  const id = row['sessionId'];
  if (
    typeof key !== 'string' ||
    !matchesKey(key, sessionKey) ||
    typeof id !== 'string' ||
    id.length === 0 ||
    id.length > 512
  )
    throw incompatible();
  const permission = row['permissionMode'];
  if (
    permission !== undefined &&
    (typeof permission !== 'string' ||
      !['read-only', 'guarded', 'workspace', 'full'].includes(permission))
  )
    throw incompatible();
  const cwd = row['spawnedCwd'];
  if (
    cwd !== undefined &&
    (typeof cwd !== 'string' || cwd.length === 0 || cwd.length > 4096)
  )
    throw incompatible();
  if (
    row['permissionModePending'] === true ||
    row['status'] === 'running' ||
    row['status'] === 'queued' ||
    row['hasActiveRun'] === true
  ) {
    throw new HarnessError(
      'run_conflict',
      'The OpenClaw source has active work.',
      { retryable: false },
    );
  }
  if (
    [
      'worktree',
      'sessionRoot',
      'execNode',
      'execCwd',
      'spawnedBy',
      'controlOwnerSessionKey',
      'spawnedWorkspaceDir',
      'sendPolicy',
    ].some((field) => row[field] !== undefined) ||
    row['incognito'] === true ||
    (row['visibility'] !== undefined && row['visibility'] !== 'shared')
  ) {
    throw new HarnessError(
      'unsupported_capability',
      'OpenClaw fork cannot preserve this Session execution or access boundary.',
      { retryable: false },
    );
  }
  return { key, sessionId: id, permissionMode: permission, spawnedCwd: cwd };
}

/** Verify Gateway lineage before attaching the child to the ACP bridge. */
export function assertOpenClawFork(
  value: unknown,
  childKey: string,
  source: OpenClawForkSource,
): void {
  const result = record(value);
  const entry = record(result?.['entry']);
  const lineage = record(entry?.['forkSource']);
  const id = result?.['sessionId'];
  const key = result?.['key'];
  const sourcePrefix = source.key.startsWith('agent:')
    ? source.key.slice(0, source.key.indexOf(':acp-bridge:') + 1)
    : '';
  if (
    result?.['ok'] !== true ||
    result['runStarted'] !== false ||
    result['runError'] !== undefined ||
    key !== `${sourcePrefix}${childKey}` ||
    typeof id !== 'string' ||
    id.length === 0 ||
    id.length > 512 ||
    id === source.sessionId ||
    entry?.['sessionId'] !== id ||
    lineage?.['sessionKey'] !== source.key ||
    lineage['sessionId'] !== source.sessionId ||
    entry['permissionMode'] !== source.permissionMode ||
    entry['spawnedCwd'] !== source.spawnedCwd
  )
    throw incompatible();
}

/** Bound a host-owned RPC even when the host fails to honor its abort signal. */
export async function requestOpenClawGateway(
  binding: OpenClawGatewayBinding,
  method: 'sessions.list' | 'sessions.create',
  params: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const failure = () =>
    new HarnessError(
      'connection_aborted',
      'OpenClaw Gateway operation did not establish an authoritative outcome.',
      { retryable: false },
    );
  let onAbort: () => void = () => undefined;
  const deadline = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  const abort = () => {
    controller.abort();
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) throw failure();
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => {
        reject(failure());
      };
      controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    return await Promise.race([
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw failure();
        return binding.request(method, params, { signal: controller.signal });
      }),
      cancelled,
    ]);
  } catch {
    throw failure();
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', onAbort);
  }
}

function matchesKey(key: string, expected: string): boolean {
  return key.replace(/^agent:[a-z0-9_-]+:/u, '') === expected;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function incompatible(): HarnessError {
  return new HarnessError(
    'provider_api_incompatible',
    'OpenClaw Gateway fork identity or policy could not be verified.',
    { retryable: false },
  );
}
