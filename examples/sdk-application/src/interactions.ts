import {
  HarnessError,
  type HarnessEvent,
  type HarnessRun,
  type HarnessSession,
  type InteractionRequest,
  type InteractionResponse,
  type RunRef,
  type RunResult,
  type SessionRef,
} from 'harapter';

/** Sensitive request data goes only to the host's explicitly selected UI. */
export interface HostInteractionContext {
  readonly request: InteractionRequest;
  readonly sessionRef: SessionRef;
  readonly runRef: RunRef;
  /** Dismiss the UI when resolved elsewhere or when the Run/observer ends. */
  readonly signal: AbortSignal;
}

export type HostInteractionHandler = (
  context: HostInteractionContext,
) => InteractionResponse | Promise<InteractionResponse>;

export interface InteractiveRunOptions {
  readonly session: HarnessSession;
  readonly run: HarnessRun;
  readonly onInteraction?: HostInteractionHandler;
  readonly onEvent: (event: HarnessEvent) => void | Promise<void>;
}

/**
 * Example host composition: keep draining while decisions and acknowledgments
 * wait. The caller owns Client cleanup on failure. No decision is automatic.
 */
export async function observeInteractiveRun(
  options: InteractiveRunOptions,
): Promise<RunResult> {
  const { session, run, onInteraction, onEvent } = options;
  const pending = new Map<string, AbortController>();
  const seen = new Set<string>();
  const failure = Promise.withResolvers<never>();
  // A callback may fail while the renderer is awaiting host code.
  void failure.promise.catch(() => undefined);
  const lifetime = new AbortController();
  const stop = () => {
    lifetime.abort();
    for (const controller of pending.values()) controller.abort();
    pending.clear();
  };
  const result = run.result().then(
    (value) => {
      stop();
      return value;
    },
    () => {
      stop();
      failure.reject(interactionFailure());
      return failure.promise;
    },
  );
  void result.catch(() => undefined);
  const iterator = run.events()[Symbol.asyncIterator]();
  let exhausted = false;
  try {
    const reference = run.ref();
    const owner = session.ref();
    if (
      reference.providerId !== owner.providerId ||
      reference.profileId !== owner.profileId ||
      reference.sessionId !== owner.providerSessionId
    )
      throw interactionFailure();
    for (;;) {
      const next = await Promise.race([iterator.next(), failure.promise]);
      if (next.done) {
        exhausted = true;
        break;
      }
      const event = next.value;
      if (
        event.providerId !== reference.providerId ||
        event.profileId !== reference.profileId ||
        event.sessionId !== reference.sessionId ||
        event.runId !== reference.runId
      )
        throw interactionFailure();
      if (event.type === 'interaction.resolved') {
        const id = requestId(event.data);
        pending.get(id)?.abort();
        pending.delete(id);
      } else if (
        event.type === 'interaction.requested' &&
        isPending(lifetime.signal)
      ) {
        const request = interactionRequest(event.data);
        if (seen.has(request.requestId) || seen.size >= 64)
          throw interactionFailure();
        seen.add(request.requestId);
        if (onInteraction === undefined)
          throw new HarnessError(
            'unsupported_capability',
            'An explicit host interaction handler is required.',
            { retryable: false },
          );
        const controller = new AbortController();
        const originalId = request.requestId;
        pending.set(originalId, controller);
        // Neither the decision nor transport acknowledgment blocks event consumption.
        void Promise.resolve()
          .then(async () => {
            if (!isPending(controller.signal)) return;
            const response = await onInteraction({
              request,
              sessionRef: owner,
              runRef: reference,
              signal: controller.signal,
            });
            if (isPending(controller.signal))
              await session.respond(originalId, response);
          })
          .catch(() => {
            if (isPending(controller.signal))
              failure.reject(interactionFailure());
          });
      } else if (
        event.type === 'run.completed' ||
        event.type === 'run.cancelled' ||
        event.type === 'run.failed' ||
        event.type === 'connection.aborted'
      )
        stop();
      await onEvent(event);
    }
    return await Promise.race([result, failure.promise]);
  } finally {
    stop();
    // An iterator can be waiting on transport input. Do not deadlock the caller's
    // Client.close() behind iterator.return(); its rejection is still observed.
    if (!exhausted) void iterator.return?.().catch(() => undefined);
  }
}

function requestId(value: unknown): string {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('requestId' in value) ||
    typeof value.requestId !== 'string' ||
    value.requestId.length === 0 ||
    value.requestId.length > 1024
  )
    throw interactionFailure();
  return value.requestId;
}

function interactionRequest(value: unknown): InteractionRequest {
  const id = requestId(value);
  if (
    typeof value !== 'object' ||
    value === null ||
    !('kind' in value) ||
    (value.kind !== 'approval' &&
      value.kind !== 'user_input' &&
      value.kind !== 'provider')
  )
    throw interactionFailure();
  for (const field of ['title', 'prompt'] as const) {
    const fields = value as Record<string, unknown>;
    if (
      field in fields &&
      typeof fields[field] !== 'string' &&
      fields[field] !== undefined
    )
      throw interactionFailure();
  }
  return { ...value, requestId: id, kind: value.kind };
}

function interactionFailure(): HarnessError {
  return new HarnessError('provider_error', 'Interaction workflow failed.', {
    retryable: false,
  });
}

function isPending(signal: AbortSignal): boolean {
  return !signal.aborted;
}
