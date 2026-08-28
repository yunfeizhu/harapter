import {
  profileId,
  type HarnessProfile,
  type ProviderAdapterFactory,
} from '@harapter/core';
import {
  CLAUDE_PROVIDER_ID,
  createClaudeProviderFactory,
  type ClaudeSdkBinding,
  type ClaudeSdkPermissionResult,
  type ClaudeSdkQuery,
  type ClaudeSdkQueryParameters,
  type ClaudeSdkSessionInfo,
} from '../src/index.js';

export const syntheticCwd = '/synthetic/workspace';

export interface FixtureQueryObservation {
  readonly closeCalls: number;
  readonly interruptCalls: number;
  readonly options: ClaudeSdkQueryParameters['options'];
  readonly prompt?: Readonly<Record<string, unknown>>;
}

export class FixtureClaudeSdk implements ClaudeSdkBinding {
  readonly queries: FixtureClaudeQuery[] = [];
  readonly sdkVersion = '0.3.250-synthetic';
  readonly sessions = new Map<string, ClaudeSdkSessionInfo>();
  getSessionInfoError: Error | undefined;
  queryImplementation:
    ((parameters: ClaudeSdkQueryParameters) => ClaudeSdkQuery) | undefined;

  getSessionInfo(
    sessionId: string,
    _options?: { readonly dir?: string },
  ): Promise<unknown> {
    if (this.getSessionInfoError !== undefined) {
      return Promise.reject(this.getSessionInfoError);
    }
    return Promise.resolve(this.sessions.get(sessionId));
  }

  query(parameters: ClaudeSdkQueryParameters): ClaudeSdkQuery {
    if (this.queryImplementation !== undefined) {
      return this.queryImplementation(parameters);
    }
    const query = new FixtureClaudeQuery(this, parameters);
    this.queries.push(query);
    return query;
  }
}

export class FixtureClaudeQuery implements ClaudeSdkQuery {
  readonly #events = new AsyncValueQueue();
  readonly #parameters: ClaudeSdkQueryParameters;
  readonly #ready = deferred<undefined>();
  readonly #sdk: FixtureClaudeSdk;
  #closeCalls = 0;
  #closed = false;
  #interruptCalls = 0;
  #prompt: Readonly<Record<string, unknown>> | undefined;
  #sessionId: string | undefined;
  #terminal = false;

  constructor(sdk: FixtureClaudeSdk, parameters: ClaudeSdkQueryParameters) {
    this.#sdk = sdk;
    this.#parameters = parameters;
    void this.#initialize();
  }

  get observation(): FixtureQueryObservation {
    return {
      closeCalls: this.#closeCalls,
      interruptCalls: this.#interruptCalls,
      options: this.#parameters.options,
      ...(this.#prompt === undefined ? {} : { prompt: this.#prompt }),
    };
  }

  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    return this.#events[Symbol.asyncIterator]();
  }

  async interrupt(): Promise<unknown> {
    this.#interruptCalls += 1;
    await this.#ready.promise;
    if (this.#closed || this.#terminal) return {};
    this.#terminal = true;
    this.#events.push(
      resultMessage(this.#requiredSessionId(), {
        isError: true,
        result: 'Synthetic interrupted turn.',
        terminalReason: 'aborted_streaming',
      }),
    );
    this.#sdk.sessions.set(this.#requiredSessionId(), {
      sessionId: this.#requiredSessionId(),
      cwd: syntheticCwd,
    });
    this.#events.close();
    return { still_queued: [] };
  }

  close(): void {
    this.#closeCalls += 1;
    this.#closed = true;
    this.#events.close();
  }

  async #initialize(): Promise<void> {
    try {
      const iterator = this.#parameters.prompt[Symbol.asyncIterator]();
      const first = await iterator.next();
      if (first.done) throw new Error('Synthetic prompt was empty.');
      this.#prompt = first.value;
      const options = this.#parameters.options;
      this.#sessionId = options.resume ?? options.sessionId;
      if (this.#sessionId === undefined) {
        throw new Error('Synthetic Session ID was missing.');
      }
      this.#events.push(
        initMessage(this.#sessionId, {
          cwd: options.cwd ?? syntheticCwd,
          model: options.model ?? 'claude-synthetic',
          permissionMode: options.permissionMode,
        }),
      );
      this.#ready.resolve(undefined);

      const text = promptText(first.value);
      if (
        text.includes('cancel conformance input') ||
        text.includes('connection abort input') ||
        text.includes('remain active')
      ) {
        return;
      }
      if (text.includes('approval interaction')) {
        const permission = await options.canUseTool(
          'SyntheticTool',
          {
            path: '/synthetic/private/file',
            secret: 'synthetic-sensitive-value',
          },
          {
            requestId: 'synthetic-approval-request',
            signal: options.abortController.signal,
            toolUseID: 'synthetic-tool-use',
          },
        );
        this.#complete(permissionText(permission));
        return;
      }
      if (text.includes('user input interaction')) {
        const permission = await options.canUseTool(
          'AskUserQuestion',
          {
            questions: [
              {
                question: 'Choose a synthetic option.',
                header: 'Synthetic choice',
                multiSelect: false,
                options: [
                  {
                    label: 'Synthetic A',
                    description: 'Use the first synthetic option.',
                  },
                ],
              },
            ],
          },
          {
            requestId: 'synthetic-user-input-request',
            signal: options.abortController.signal,
            toolUseID: 'synthetic-question-tool-use',
          },
        );
        this.#complete(permissionText(permission));
        return;
      }
      this.#complete('Synthetic Claude reply.');
    } catch (error) {
      this.#ready.resolve(undefined);
      this.#events.fail(error);
    }
  }

  #complete(text: string): void {
    if (this.#closed || this.#terminal) return;
    this.#events.push({
      type: 'stream_event',
      session_id: this.#requiredSessionId(),
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text },
      },
    });
    this.#events.push(
      resultMessage(this.#requiredSessionId(), {
        isError: false,
        result: text,
        terminalReason: 'completed',
      }),
    );
    this.#sdk.sessions.set(this.#requiredSessionId(), {
      sessionId: this.#requiredSessionId(),
      cwd: syntheticCwd,
    });
    this.#terminal = true;
    this.#events.close();
  }

  #requiredSessionId(): string {
    if (this.#sessionId === undefined) {
      throw new Error('Synthetic Query is not initialized.');
    }
    return this.#sessionId;
  }
}

export function createFixtureFactory(
  sdk = new FixtureClaudeSdk(),
): ProviderAdapterFactory {
  return createClaudeProviderFactory({
    binding: sdk,
    createUuid: uuidSequence(),
    now: () => '2026-08-28T00:00:00.000Z',
  });
}

export function createTestProfile(
  suffix = 'fixture',
  overrides: Partial<HarnessProfile> = {},
): HarnessProfile {
  return {
    profileId: profileId(`claude-${suffix}`),
    displayName: 'Claude Agent SDK fixture',
    providerId: CLAUDE_PROVIDER_ID,
    connection: { kind: 'sdk', ownership: 'adapter' },
    ...overrides,
  };
}

export async function waitForQuery(
  sdk: FixtureClaudeSdk,
  index = 0,
): Promise<FixtureClaudeQuery> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const query = sdk.queries[index];
    if (query?.observation.prompt !== undefined) return query;
    await Promise.resolve();
  }
  throw new Error('Synthetic Query did not initialize.');
}

function initMessage(
  sessionId: string,
  options: {
    readonly cwd: string;
    readonly model: string;
    readonly permissionMode: string;
  },
): Readonly<Record<string, unknown>> {
  return {
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    claude_code_version: '2.1.250-synthetic',
    cwd: options.cwd,
    model: options.model,
    permissionMode: options.permissionMode,
    capabilities: ['interrupt_receipt_v1'],
  };
}

function resultMessage(
  sessionId: string,
  options: {
    readonly isError: boolean;
    readonly result: string;
    readonly terminalReason: string;
  },
): Readonly<Record<string, unknown>> {
  return {
    type: 'result',
    subtype: 'success',
    is_error: options.isError,
    session_id: sessionId,
    result: options.result,
    terminal_reason: options.terminalReason,
    usage: { input_tokens: 3, output_tokens: 2 },
    uuid: '00000000-0000-4000-8000-000000000099',
  };
}

function permissionText(result: ClaudeSdkPermissionResult): string {
  if (result.behavior === 'deny') return 'permission:deny';
  const answers = result.updatedInput['answers'];
  if (typeof answers === 'object' && answers !== null) return 'input:answered';
  return 'permission:allow';
}

function promptText(value: Readonly<Record<string, unknown>>): string {
  const message = value['message'];
  if (typeof message !== 'object' || message === null) return '';
  const content = (message as Readonly<Record<string, unknown>>)['content'];
  return typeof content === 'string' ? content : '';
}

function uuidSequence(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
  };
}

class AsyncValueQueue implements AsyncIterable<unknown> {
  readonly #values: unknown[] = [];
  #closed = false;
  #error: Error | undefined;
  #waiter: (() => void) | undefined;

  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    return this.#iterator();
  }

  push(value: unknown): void {
    if (this.#closed) return;
    this.#values.push(value);
    this.#wake();
  }

  close(): void {
    this.#closed = true;
    this.#wake();
  }

  fail(error: unknown): void {
    this.#error =
      error instanceof Error ? error : new Error('Synthetic Query failed.');
    this.#closed = true;
    this.#wake();
  }

  async *#iterator(): AsyncGenerator {
    for (;;) {
      const value = this.#values.shift();
      if (value !== undefined) {
        yield value;
        continue;
      }
      if (this.#error !== undefined) throw this.#error;
      if (this.#closed) return;
      await new Promise<void>((resolve) => {
        this.#waiter = resolve;
      });
    }
  }

  #wake(): void {
    const waiter = this.#waiter;
    this.#waiter = undefined;
    waiter?.();
  }
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
