import {
  HarnessError,
  HarnessRegistry,
  assertSessionOwnership,
  type CapabilityManifest,
  type CapabilityMode,
  type CreateSessionInput,
  type HarnessClient,
  type HarnessInput,
  type HarnessProfile,
  type HarnessSession,
  type ProfileId,
  type ProviderAdapterFactory,
  type RunOptions,
  type RunResult,
  type SessionRef,
} from '@harapter/core';

/** Provider registration and per-Profile defaults selected by the host. */
export interface MultiProviderSetup {
  readonly factory: ProviderAdapterFactory;
  readonly profile: HarnessProfile;
  readonly sessionInput?: CreateSessionInput;
  readonly runOptions?: RunOptions;
}

/** One new or resumed task routed by Profile identity. */
export interface MultiProviderTask {
  readonly profileId: ProfileId;
  readonly input: HarnessInput;
  readonly sessionRef?: SessionRef;
}

type AvailableCapabilityMode = Exclude<
  CapabilityMode,
  'unsupported' | 'unknown'
>;

/** Portable control with its observed implementation strength preserved. */
export interface MultiProviderControl {
  readonly name: 'cancel' | 'resume';
  readonly mode: AvailableCapabilityMode;
}

/** Safe records shared by every configured Provider. */
export type MultiProviderRecord =
  | {
      readonly type: 'connected';
      readonly providerId: string;
      readonly profileId: string;
      readonly compatibility: 'supported' | 'experimental' | 'unsupported';
    }
  | {
      readonly type: 'session';
      readonly providerId: string;
      readonly profileId: string;
      readonly controls: readonly MultiProviderControl[];
    }
  | {
      readonly type: 'event';
      readonly providerId: string;
      readonly profileId: string;
      readonly eventType: string;
      readonly sequence: number;
    }
  | {
      readonly type: 'result';
      readonly providerId: string;
      readonly profileId: string;
      readonly status: RunResult['status'];
    };

/** Result retained by the host without rendering opaque Session state. */
export interface MultiProviderOutcome {
  readonly providerId: string;
  readonly profileId: ProfileId;
  readonly sessionRef: SessionRef;
  readonly status: RunResult['status'];
}

/** Provider-bound hook for typed extensions outside the portable renderer. */
export interface MultiProviderConnectedContext {
  readonly client: HarnessClient;
  readonly profile: HarnessProfile;
  readonly capabilities: CapabilityManifest;
}

/** Cleanup returned by a Provider-specific extension hook. */
export type MultiProviderDisposer = () => void | Promise<void>;

export interface MultiProviderClientOptions {
  readonly providers: readonly [
    MultiProviderSetup,
    MultiProviderSetup,
    ...MultiProviderSetup[],
  ];
  readonly tasks: readonly MultiProviderTask[];
  readonly write: (record: MultiProviderRecord) => void | Promise<void>;
  readonly onConnected?: (
    context: MultiProviderConnectedContext,
  ) =>
    | MultiProviderDisposer
    | undefined
    | Promise<MultiProviderDisposer | undefined>;
}

interface ConnectedProvider {
  readonly setup: MultiProviderSetup;
  readonly client: HarnessClient;
}

/**
 * Connect two or more Providers and run Profile-selected tasks concurrently
 * through one safe portable renderer.
 *
 * @param options - Provider registrations, routed tasks, renderer, and optional
 * Provider-extension hook.
 * @returns Outcomes in task order with opaque Session references retained by
 * the host instead of rendered.
 */
export async function runMultiProviderClient(
  options: MultiProviderClientOptions,
): Promise<readonly MultiProviderOutcome[]> {
  validateSetups(options.providers);
  if (options.tasks.length === 0) {
    throw new HarnessError(
      'invalid_request',
      'Multi-provider reference execution requires at least one task.',
      { retryable: false },
    );
  }
  const registry = new HarnessRegistry();
  for (const { factory } of options.providers) registry.register(factory);

  const write = serializedWriter(options.write);
  const connected = new Map<ProfileId, ConnectedProvider>();
  const disposers: MultiProviderDisposer[] = [];
  let outcomes: readonly MultiProviderOutcome[] | undefined;
  let operationError: Error | undefined;

  try {
    for (const setup of options.providers) {
      const client = await registry.connect(setup.profile);
      connected.set(setup.profile.profileId, { setup, client });
      const descriptor = await client.descriptor();
      const capabilities = await client.capabilities();
      await write({
        type: 'connected',
        providerId: descriptor.providerId,
        profileId: descriptor.profileId,
        compatibility: descriptor.compatibility,
      });
      const disposer = await options.onConnected?.({
        client,
        profile: setup.profile,
        capabilities,
      });
      if (disposer !== undefined) disposers.push(disposer);
    }

    const settled = await Promise.allSettled(
      options.tasks.map((task) => runTask(connected, task, write)),
    );
    const rejected = settled.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (rejected !== undefined) throw asError(rejected.reason);
    outcomes = settled.map(
      (result) =>
        (result as PromiseFulfilledResult<MultiProviderOutcome>).value,
    );
  } catch (error) {
    operationError = asError(error);
  }

  const cleanupError = await closeConnections(disposers, connected);
  if (operationError !== undefined) throw operationError;
  if (cleanupError !== undefined) throw cleanupError;
  if (outcomes === undefined) {
    throw new Error('Multi-provider reference tasks did not settle.');
  }
  return outcomes;
}

async function runTask(
  connected: ReadonlyMap<ProfileId, ConnectedProvider>,
  task: MultiProviderTask,
  write: (record: MultiProviderRecord) => Promise<void>,
): Promise<MultiProviderOutcome> {
  const selected = connected.get(task.profileId);
  if (selected === undefined) {
    throw new HarnessError(
      'profile_invalid',
      'Task selected a Profile that is not connected.',
      { retryable: false, profileId: task.profileId },
    );
  }

  let session: HarnessSession | undefined;
  let outcome: MultiProviderOutcome | undefined;
  let operationError: Error | undefined;
  try {
    if (task.sessionRef === undefined) {
      session = await selected.client.createSession(
        selected.setup.sessionInput,
      );
    } else {
      assertSessionOwnership(
        task.sessionRef,
        selected.setup.profile.providerId,
        selected.setup.profile.profileId,
      );
      session = await selected.client.resumeSession(task.sessionRef);
    }

    const sessionRef = session.ref();
    const capabilities = await session.capabilities();
    await write({
      type: 'session',
      providerId: sessionRef.providerId,
      profileId: sessionRef.profileId,
      controls: visibleControls(capabilities),
    });
    const run = await session.start(task.input, selected.setup.runOptions);
    for await (const event of run.events()) {
      await write({
        type: 'event',
        providerId: event.providerId,
        profileId: event.profileId,
        eventType: event.type,
        sequence: event.sequence,
      });
    }
    const result = await run.result();
    await write({
      type: 'result',
      providerId: sessionRef.providerId,
      profileId: sessionRef.profileId,
      status: result.status,
    });
    outcome = {
      providerId: sessionRef.providerId,
      profileId: sessionRef.profileId,
      sessionRef,
      status: result.status,
    };
  } catch (error) {
    operationError = asError(error);
  }

  const cleanupError = await closeSession(session);
  if (operationError !== undefined) throw operationError;
  if (cleanupError !== undefined) throw cleanupError;
  if (outcome === undefined) {
    throw new Error('Multi-provider reference task did not settle.');
  }
  return outcome;
}

function validateSetups(setups: readonly MultiProviderSetup[]): void {
  if (setups.length < 2) {
    throw new HarnessError(
      'invalid_request',
      'Multi-provider reference execution requires at least two Providers.',
      { retryable: false },
    );
  }
  const providers = new Set<string>();
  const profiles = new Set<string>();
  for (const setup of setups) {
    const descriptor = setup.factory.descriptor();
    if (descriptor.providerId !== setup.profile.providerId) {
      throw new HarnessError(
        'profile_invalid',
        'Provider factory and Profile identities do not match.',
        { retryable: false, profileId: setup.profile.profileId },
      );
    }
    if (providers.has(descriptor.providerId)) {
      throw new HarnessError(
        'invalid_request',
        'Multi-provider reference registrations require unique Providers.',
        { retryable: false, providerId: descriptor.providerId },
      );
    }
    if (profiles.has(setup.profile.profileId)) {
      throw new HarnessError(
        'invalid_request',
        'Multi-provider reference registrations require unique Profiles.',
        { retryable: false, profileId: setup.profile.profileId },
      );
    }
    providers.add(descriptor.providerId);
    profiles.add(setup.profile.profileId);
  }
}

function visibleControls(
  capabilities: CapabilityManifest,
): readonly MultiProviderControl[] {
  const controls: MultiProviderControl[] = [];
  const cancelMode = capabilities.capabilities['run.cancel']?.mode;
  if (available(cancelMode)) {
    controls.push({ name: 'cancel', mode: cancelMode });
  }
  const resumeMode = capabilities.capabilities['session.resume']?.mode;
  if (available(resumeMode)) {
    controls.push({ name: 'resume', mode: resumeMode });
  }
  return controls;
}

function available(
  mode: CapabilityMode | undefined,
): mode is AvailableCapabilityMode {
  return mode !== undefined && mode !== 'unsupported' && mode !== 'unknown';
}

function serializedWriter(
  write: (record: MultiProviderRecord) => void | Promise<void>,
): (record: MultiProviderRecord) => Promise<void> {
  let queue = Promise.resolve();
  return (record) => {
    const operation = queue.then(() => write(record));
    queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  };
}

async function closeSession(
  session: HarnessSession | undefined,
): Promise<Error | undefined> {
  if (session === undefined) return undefined;
  try {
    await session.close();
    return undefined;
  } catch (error) {
    return asError(error);
  }
}

async function closeConnections(
  disposers: readonly MultiProviderDisposer[],
  connected: ReadonlyMap<ProfileId, ConnectedProvider>,
): Promise<Error | undefined> {
  let cleanupError: Error | undefined;
  for (const dispose of [...disposers].reverse()) {
    try {
      await dispose();
    } catch (error) {
      cleanupError ??= asError(error);
    }
  }
  for (const { client } of [...connected.values()].reverse()) {
    try {
      await client.close();
    } catch (error) {
      cleanupError ??= asError(error);
    }
  }
  return cleanupError;
}

function asError(value: unknown): Error {
  return value instanceof Error
    ? value
    : new Error('Multi-provider reference operation failed.');
}
