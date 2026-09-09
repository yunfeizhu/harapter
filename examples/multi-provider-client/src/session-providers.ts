import {
  CODEX_SESSION_EXTENSION,
  createCodexProviderFactory,
  type CodexSessions,
} from 'harapter/codex';
import {
  DSH_GATEWAY_SESSION_EXTENSION,
  createDshProviderFactory,
  type DshGatewaySessions,
  type DshProviderFactoryOptions,
} from 'harapter/dsh';
import {
  HERMES_SESSION_EXTENSION,
  createHermesProviderFactory,
  type HermesSessions,
  type HermesProviderFactoryOptions,
} from 'harapter/hermes';
import {
  OPENCLAW_SESSION_EXTENSION,
  createOpenClawProviderFactory,
  type OpenClawSessions,
  type OpenClawProviderFactoryOptions,
} from 'harapter/openclaw';
import {
  OPENCODE_SESSION_EXTENSION,
  createOpenCodeProviderFactory,
  type OpenCodeSessions,
  type OpenCodeProviderFactoryOptions,
} from 'harapter/opencode';
import {
  PI_SESSION_EXTENSION,
  createPiProviderFactory,
  type PiSessions,
} from 'harapter/pi';
import { HarnessError, type HarnessClient } from 'harapter';
import type { MultiProviderSetup } from './index.js';
import type {
  SessionHistoryBinding,
  SessionWorkflowSetup,
} from './session-workflow.js';

type Settings = Omit<MultiProviderSetup, 'factory'>;

/** The host supplies existing runtime configuration; constructing setups does no I/O. */
export interface SessionProviderConfiguration {
  readonly codex?: Settings;
  readonly dsh?: Settings & {
    readonly factoryOptions?: DshProviderFactoryOptions;
  };
  readonly hermes?: Settings & {
    readonly factoryOptions?: HermesProviderFactoryOptions;
  };
  readonly openclaw?: Settings & {
    readonly factoryOptions?: OpenClawProviderFactoryOptions;
  };
  readonly opencode?: Settings & {
    readonly factoryOptions?: OpenCodeProviderFactoryOptions;
  };
  readonly pi?: Settings;
}

/** Build one to six explicitly selected Provider compositions without connecting. */
export function createSessionWorkflowSetups(
  config: SessionProviderConfiguration,
): readonly SessionWorkflowSetup[] {
  const setups: SessionWorkflowSetup[] = [];
  add(
    config.codex,
    () => createCodexProviderFactory(),
    bindCodexSessionHistory,
  );
  add(
    config.dsh,
    () => createDshProviderFactory(config.dsh?.factoryOptions),
    bindDshSessionHistory,
  );
  add(
    config.hermes,
    () => createHermesProviderFactory(config.hermes?.factoryOptions),
    bindHermesSessionHistory,
  );
  add(
    config.openclaw,
    () => createOpenClawProviderFactory(config.openclaw?.factoryOptions),
    bindOpenClawSessionHistory,
  );
  add(
    config.opencode,
    () => createOpenCodeProviderFactory(config.opencode?.factoryOptions),
    bindOpenCodeSessionHistory,
  );
  add(config.pi, () => createPiProviderFactory(), bindPiSessionHistory);
  if (
    setups.length === 0 ||
    new Set(setups.map(({ profile }) => profile.profileId)).size !==
      setups.length
  ) {
    throw new HarnessError(
      'invalid_request',
      'Choose at least one Provider with unique Profile identities.',
      { retryable: false },
    );
  }
  return setups;

  function add(
    settings: Settings | undefined,
    factory: () => MultiProviderSetup['factory'],
    bindHistory: SessionWorkflowSetup['bindHistory'],
  ) {
    if (settings === undefined) return;
    const adapter = factory();
    if (adapter.descriptor().providerId !== settings.profile.providerId) {
      throw new HarnessError(
        'invalid_request',
        'Provider configuration has the wrong Profile owner.',
        { retryable: false },
      );
    }
    setups.push({
      profile: settings.profile,
      factory: adapter,
      bindHistory,
      ...(settings.sessionInput === undefined
        ? {}
        : { sessionInput: settings.sessionInput }),
      ...(settings.runOptions === undefined
        ? {}
        : { runOptions: settings.runOptions }),
    });
  }
}

/** Bind Codex's persisted thread fork; an ephemeral source will be rejected. */
export function bindCodexSessionHistory(
  client: HarnessClient,
): SessionHistoryBinding | undefined {
  const sessions = client
    .extensions()
    .get<CodexSessions>(CODEX_SESSION_EXTENSION, hasFork);
  return sessions === undefined
    ? undefined
    : {
        operation: 'fork',
        parent: 'preserved',
        history: 'stored-history',
        createChild: (ref) => sessions.fork(ref),
      };
}

/** Bind only the DSH Gateway Session API; process RPC is not a substitute. */
export function bindDshSessionHistory(
  client: HarnessClient,
): SessionHistoryBinding | undefined {
  const sessions = client
    .extensions()
    .get<DshGatewaySessions>(
      DSH_GATEWAY_SESSION_EXTENSION,
      (value): value is DshGatewaySessions =>
        hasFork(value) &&
        'cancelSession' in value &&
        typeof value.cancelSession === 'function',
    );
  return sessions === undefined
    ? undefined
    : {
        operation: 'fork',
        parent: 'preserved',
        history: 'completed-turn-prefix',
        createChild: (ref) => sessions.fork(ref),
        sessionCancellation: {
          ready: (event) => event.providerEventType === 'step/start',
          request: (ref) => sessions.cancelSession(ref),
        },
      };
}

/** Hermes retires its parent when branching; do not reuse that parent. */
export function bindHermesSessionHistory(
  client: HarnessClient,
): SessionHistoryBinding | undefined {
  const sessions = client
    .extensions()
    .get<HermesSessions>(
      HERMES_SESSION_EXTENSION,
      (value): value is HermesSessions =>
        typeof value === 'object' &&
        value !== null &&
        'branch' in value &&
        typeof value.branch === 'function',
    );
  return sessions === undefined
    ? undefined
    : {
        operation: 'branch',
        parent: 'retired',
        history: 'stored-history',
        createChild: (ref) => sessions.branch(ref),
      };
}

/** OpenClaw requires a host-authenticated Gateway bound to this ACP Profile. */
export function bindOpenClawSessionHistory(
  client: HarnessClient,
): SessionHistoryBinding | undefined {
  const sessions = client
    .extensions()
    .get<OpenClawSessions>(OPENCLAW_SESSION_EXTENSION, hasFork);
  return sessions === undefined
    ? undefined
    : {
        operation: 'fork',
        parent: 'preserved',
        history: 'last-completed-assistant',
        createChild: (ref) => sessions.fork(ref),
      };
}

/** Bind the server's stored-history fork with its policy compatibility checks. */
export function bindOpenCodeSessionHistory(
  client: HarnessClient,
): SessionHistoryBinding | undefined {
  const sessions = client
    .extensions()
    .get<OpenCodeSessions>(OPENCODE_SESSION_EXTENSION, hasFork);
  return sessions === undefined
    ? undefined
    : {
        operation: 'fork',
        parent: 'preserved',
        history: 'stored-history',
        createChild: (ref) => sessions.fork(ref),
      };
}

/** Pi copies only its active branch into a new persisted Session process. */
export function bindPiSessionHistory(
  client: HarnessClient,
): SessionHistoryBinding | undefined {
  const sessions = client
    .extensions()
    .get<PiSessions>(PI_SESSION_EXTENSION, hasFork);
  return sessions === undefined
    ? undefined
    : {
        operation: 'fork',
        parent: 'preserved',
        history: 'active-branch',
        createChild: (ref) => sessions.fork(ref),
      };
}

function hasFork(value: unknown): value is CodexSessions {
  return (
    typeof value === 'object' &&
    value !== null &&
    'fork' in value &&
    typeof value.fork === 'function'
  );
}
