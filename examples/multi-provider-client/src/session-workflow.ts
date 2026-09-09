import {
  HarnessError,
  HarnessRegistry,
  assertSessionOwnership,
  type CancelResult,
  type HarnessClient,
  type HarnessEvent,
  type HarnessInput,
  type HarnessSession,
  type RunResult,
  type SessionRef,
} from 'harapter';
import type { MultiProviderSetup } from './index.js';
import { observeInteractiveRun } from './interactions.js';

/** Example-local composition, not a portable Core fork contract. */
export interface SessionHistoryBinding {
  readonly operation: 'fork' | 'branch';
  readonly parent: 'preserved' | 'retired';
  readonly history:
    | 'stored-history'
    | 'completed-turn-prefix'
    | 'last-completed-assistant'
    | 'active-branch';
  createChild(ref: SessionRef): Promise<HarnessSession>;
  readonly sessionCancellation?: {
    ready(event: HarnessEvent): boolean;
    request(ref: SessionRef): Promise<{ readonly accepted: true }>;
  };
}

/** Explicit host configuration and Provider-specific extension binding. */
export interface SessionWorkflowSetup extends MultiProviderSetup {
  bindHistory(client: HarnessClient): SessionHistoryBinding | undefined;
}

type Phase = 'source' | 'continuation' | 'cancellation';
type CancellationRecord = Extract<
  SessionWorkflowRecord,
  { type: 'cancellation' }
>;

/** Only allowlisted control metadata crosses the renderer boundary. */
export type SessionWorkflowRecord =
  | { readonly type: 'session'; readonly action: 'created' | 'resumed' }
  | {
      readonly type: 'history';
      readonly operation: SessionHistoryBinding['operation'];
      readonly parent: SessionHistoryBinding['parent'];
      readonly history: SessionHistoryBinding['history'];
    }
  | {
      readonly type: 'event';
      readonly phase: Phase;
      readonly eventType: HarnessEvent['type'];
      readonly sequence: number;
    }
  | {
      readonly type: 'result';
      readonly phase: Phase;
      readonly status: RunResult['status'];
    }
  | {
      readonly type: 'cancellation';
      readonly scope: 'run' | 'session';
      readonly receipt:
        CancelResult['mode'] | 'accepted' | 'not_requested' | 'unavailable';
    };

export interface SessionWorkflowOptions {
  readonly setup: SessionWorkflowSetup;
  readonly sourceRef?: SessionRef;
  readonly inputs?: {
    readonly source: HarnessInput;
    readonly continuation: HarnessInput;
    readonly cancellation: HarnessInput;
  };
  readonly write: (record: SessionWorkflowRecord) => void | Promise<void>;
}

/** Opaque references belong to host storage, never to the rendered records. */
export interface SessionWorkflowOutcome {
  readonly parent: SessionHistoryBinding['parent'];
  readonly sourceRef?: SessionRef;
  readonly childRef: SessionRef;
  readonly cancellationStatus?: RunResult['status'];
}

interface Connection {
  readonly client: HarnessClient;
  readonly sessions: Set<HarnessSession>;
}

const defaultInputs = {
  source: textInput(
    'Remember this fictional project name: Harapter Orchard. Reply briefly without using tools.',
  ),
  continuation: textInput(
    'What fictional project name did I give you? Reply briefly without using tools.',
  ),
  cancellation: textInput(
    'Describe an imaginary orchard in detail without using tools.',
  ),
};

/**
 * Create/run, reconnect/resume, derive a native child, continue, and request
 * cancellation. Model calls are explicit and may incur cost. Cleanup releases
 * local handles; native history and external runtimes remain host-owned.
 */
export async function runSessionWorkflow(
  options: SessionWorkflowOptions,
): Promise<SessionWorkflowOutcome> {
  const { setup, write } = options;
  const { profile } = setup;
  const inputs = options.inputs ?? defaultInputs;
  const checkOwner = (ref: SessionRef) => {
    assertSessionOwnership(ref, profile.providerId, profile.profileId);
  };
  if (options.sourceRef !== undefined) checkOwner(options.sourceRef);
  const registry = new HarnessRegistry();
  registry.register(setup.factory);
  const connections = new Set<Connection>();
  let operationError: HarnessError | undefined;
  let outcome: SessionWorkflowOutcome | undefined;

  const connect = async () => {
    const client = await registry.connect(profile);
    const connection: Connection = { client, sessions: new Set() };
    connections.add(connection);
    const history = setup.bindHistory(client);
    const capabilities = await client.capabilities();
    if (
      history === undefined ||
      capabilities.capabilities['session.resume']?.mode !== 'native'
    ) {
      throw unavailable();
    }
    return { connection, history };
  };

  try {
    const initial = await connect();
    const source =
      options.sourceRef === undefined
        ? await initial.connection.client.createSession(setup.sessionInput)
        : await initial.connection.client.resumeSession(options.sourceRef);
    initial.connection.sessions.add(source);
    checkOwner(source.ref());
    if (
      (await source.capabilities()).capabilities['session.resume']?.mode !==
      'native'
    )
      throw unavailable();
    await write({
      type: 'session',
      action: options.sourceRef === undefined ? 'created' : 'resumed',
    });
    await requireCompleted(
      source,
      initial.connection.client,
      'source',
      inputs.source,
    );
    const sourceRef = source.ref();
    await source.close();
    initial.connection.sessions.delete(source);
    await initial.connection.client.close();
    connections.delete(initial.connection);

    const resumed = await connect();
    checkOwner(sourceRef);
    const parent = await resumed.connection.client.resumeSession(sourceRef);
    resumed.connection.sessions.add(parent);
    checkOwner(parent.ref());
    await write({ type: 'session', action: 'resumed' });
    const child = await resumed.history.createChild(parent.ref());
    resumed.connection.sessions.add(child);
    checkOwner(child.ref());
    if (child.ref().providerSessionId === parent.ref().providerSessionId)
      throw workflowFailure();
    await write({
      type: 'history',
      operation: resumed.history.operation,
      parent: resumed.history.parent,
      history: resumed.history.history,
    });
    await requireCompleted(
      child,
      resumed.connection.client,
      'continuation',
      inputs.continuation,
    );

    const cancellation = resumed.history.sessionCancellation;
    const canCancel =
      cancellation !== undefined ||
      (await child.capabilities()).capabilities['run.cancel']?.mode ===
        'native';
    let cancellationStatus: RunResult['status'] | undefined;
    if (canCancel) {
      cancellationStatus = (
        await observe(
          child,
          resumed.connection.client,
          'cancellation',
          inputs.cancellation,
          cancellation,
        )
      ).status;
    } else {
      await write({
        type: 'cancellation',
        scope: 'run',
        receipt: 'unavailable',
      });
    }
    outcome = {
      parent: resumed.history.parent,
      ...(resumed.history.parent === 'preserved' ? { sourceRef } : {}),
      childRef: child.ref(),
      ...(cancellationStatus === undefined ? {} : { cancellationStatus }),
    };
  } catch (error) {
    // Provider errors and host callbacks can contain private configuration.
    operationError =
      error instanceof HarnessError && error.code === 'unsupported_capability'
        ? unavailable()
        : workflowFailure();
  } finally {
    let cleanupFailed = false;
    for (const connection of connections) {
      for (const session of connection.sessions) {
        try {
          await session.close();
        } catch {
          cleanupFailed = true;
        }
      }
      // A busy Session can refuse close; Client close still releases the connection.
      try {
        await connection.client.close();
      } catch {
        cleanupFailed = true;
      }
    }
    if (cleanupFailed && operationError === undefined)
      operationError = workflowFailure();
  }
  if (operationError !== undefined) throw operationError;
  if (outcome === undefined) throw workflowFailure();
  return outcome;

  async function requireCompleted(
    session: HarnessSession,
    client: HarnessClient,
    phase: 'source' | 'continuation',
    input: HarnessInput,
  ) {
    const result = await observe(session, client, phase, input);
    if (result.status !== 'completed') throw workflowFailure();
  }

  async function observe(
    session: HarnessSession,
    client: HarnessClient,
    phase: Phase,
    input: HarnessInput,
    cancellation?: SessionHistoryBinding['sessionCancellation'],
  ) {
    const run = await session.start(input, {
      timeoutMs: 60_000,
      ...setup.runOptions,
    });
    const scope: CancellationRecord['scope'] =
      cancellation === undefined ? 'run' : 'session';
    let pending: Promise<CancellationRecord | undefined> | undefined;
    try {
      const result = await observeInteractiveRun({
        session,
        run,
        ...(setup.onInteraction === undefined
          ? {}
          : { onInteraction: setup.onInteraction }),
        onEvent: async (event) => {
          if (
            phase === 'cancellation' &&
            pending === undefined &&
            (cancellation?.ready(event) ?? event.type === 'run.started')
          ) {
            // Keep draining while native cancellation waits for events/acknowledgment.
            pending = Promise.resolve()
              .then(async (): Promise<CancellationRecord> => {
                if (cancellation === undefined)
                  return {
                    type: 'cancellation',
                    scope,
                    receipt: (await run.cancel()).mode,
                  };
                await cancellation.request(session.ref());
                return { type: 'cancellation', scope, receipt: 'accepted' };
              })
              .catch(async () => {
                // Release the transport on request failure; never call this native cancellation.
                try {
                  await client.close();
                } catch {
                  /* Outer cleanup retries. */
                }
                return undefined;
              });
          }
          await write({
            type: 'event',
            phase,
            eventType: event.type,
            sequence: event.sequence,
          });
        },
      });
      if (phase === 'cancellation') {
        const receipt =
          pending === undefined
            ? {
                type: 'cancellation' as const,
                scope,
                receipt: 'not_requested' as const,
              }
            : await pending;
        if (receipt === undefined) throw workflowFailure();
        await write(receipt);
      }
      await write({ type: 'result', phase, status: result.status });
      return result;
    } catch {
      // Settle in-flight cancellation before leaving the failed observer.
      try {
        await client.close();
      } catch {
        /* Outer cleanup retries. */
      }
      await pending;
      throw workflowFailure();
    }
  }
}

function textInput(text: string): HarnessInput {
  return { parts: [{ type: 'text', text }] };
}
function unavailable() {
  return new HarnessError(
    'unsupported_capability',
    'Session workflow requires native resume and a supported history extension.',
    { retryable: false },
  );
}
function workflowFailure() {
  return new HarnessError('provider_error', 'Session workflow failed.', {
    retryable: false,
  });
}
