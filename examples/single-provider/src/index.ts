import {
  HarnessRegistry,
  type CapabilityMode,
  type CreateSessionInput,
  type HarnessClient,
  type HarnessInput,
  type HarnessProfile,
  type HarnessSession,
  type ProviderAdapterFactory,
  type RunOptions,
  type RunResult,
} from '@harapter/core';

/** Safe, portable records rendered by the reference application. */
export type SingleProviderExampleRecord =
  | {
      readonly type: 'connected';
      readonly providerId: string;
      readonly profileId: string;
      readonly compatibility: 'supported' | 'experimental' | 'unsupported';
      readonly capabilities: Readonly<{
        'input.text': CapabilityMode;
        'run.stream': CapabilityMode;
      }>;
    }
  | {
      readonly type: 'event';
      readonly eventType: string;
      readonly sequence: number;
    }
  | {
      readonly type: 'result';
      readonly status: RunResult['status'];
    };

/** Inputs supplied by a host that selects one Provider Adapter. */
export interface SingleProviderExampleOptions {
  readonly factory: ProviderAdapterFactory;
  readonly profile: HarnessProfile;
  readonly input: HarnessInput;
  readonly sessionInput?: CreateSessionInput;
  readonly runOptions?: RunOptions;
  readonly write: (record: SingleProviderExampleRecord) => void | Promise<void>;
}

/**
 * Run one Session through portable Core contracts and render safe lifecycle
 * metadata without exposing application content or Provider-native values.
 *
 * @param options - Host-selected Provider, Profile, input, and record sink.
 * @returns The authoritative portable terminal status.
 */
export async function runSingleProviderExample(
  options: SingleProviderExampleOptions,
): Promise<RunResult['status']> {
  const registry = new HarnessRegistry();
  registry.register(options.factory);

  const client = await registry.connect(options.profile);
  let session: HarnessSession | undefined;
  let status: RunResult['status'];

  try {
    const descriptor = await client.descriptor();
    const manifest = await client.capabilities();
    await options.write({
      type: 'connected',
      providerId: descriptor.providerId,
      profileId: descriptor.profileId,
      compatibility: descriptor.compatibility,
      capabilities: {
        'input.text': manifest.capabilities['input.text']?.mode ?? 'unknown',
        'run.stream': manifest.capabilities['run.stream']?.mode ?? 'unknown',
      },
    });

    session = await client.createSession(options.sessionInput);
    const run = await session.start(options.input, options.runOptions);
    for await (const event of run.events()) {
      await options.write({
        type: 'event',
        eventType: event.type,
        sequence: event.sequence,
      });
    }

    const result = await run.result();
    await options.write({ type: 'result', status: result.status });
    status = result.status;
  } catch (error) {
    await closeResources(session, client).catch(() => undefined);
    throw asError(error);
  }

  await closeResources(session, client);
  return status;
}

async function closeResources(
  session: HarnessSession | undefined,
  client: HarnessClient,
): Promise<void> {
  let cleanupError: Error | undefined;
  if (session !== undefined) {
    try {
      await session.close();
    } catch (error) {
      cleanupError = asError(error);
    }
  }
  try {
    await client.close();
  } catch (error) {
    cleanupError ??= asError(error);
  }
  if (cleanupError !== undefined) throw cleanupError;
}

function asError(value: unknown): Error {
  return value instanceof Error
    ? value
    : new Error('Single-provider example operation failed.');
}
