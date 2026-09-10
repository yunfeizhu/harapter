import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { profileId, type HarnessProfile } from '@harapter/core';
import { PI_PROVIDER_ID } from '../src/protocol.js';

const assistantTemplate: unknown = JSON.parse(
  readFileSync(
    new URL('../../../fixtures/pi/sdk-0.85.1/assistant.json', import.meta.url),
    'utf8',
  ),
);

export function sdkProfile(
  factory: () => Promise<ReturnType<typeof sdkFixture>>,
): HarnessProfile {
  return {
    profileId: profileId('synthetic-sdk'),
    providerId: PI_PROVIDER_ID,
    displayName: 'Synthetic SDK',
    connection: { kind: 'sdk', factory, ownership: 'adapter' },
    providerOptions: { sdkVersion: '0.85.1' },
  };
}

export function sdkFixture(
  mode: 'complete' | 'empty' | 'reject' | 'hang' = 'complete',
) {
  let listener: ((event: unknown) => void) | undefined;
  let finish: (() => void) | undefined;
  const native = {
    sessionId: randomUUID(),
    isStreaming: false,
    disposed: 0,
    inputs: [] as string[],
    subscribe(callback: (event: unknown) => void) {
      listener = callback;
      return () => {
        listener = undefined;
      };
    },
    emit(event: unknown) {
      listener?.(event);
    },
    async prompt(text: string) {
      native.inputs.push(text);
      native.isStreaming = true;
      await new Promise<void>((resolve) => {
        finish = resolve;
        if (mode !== 'hang') setTimeout(resolve, 5);
      });
      if (!streaming()) return;
      native.emit({ type: 'agent_start' });
      if (mode === 'reject') {
        native.isStreaming = false;
        throw new Error('synthetic-private-data');
      }
      if (mode === 'complete') {
        native.emit({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'text_delta',
            delta: 'Synthetic SDK answer',
          },
        });
        native.emit({ type: 'message_end', message: assistant('stop') });
      } else
        native.emit({
          type: 'future-synthetic-private-data',
          content: 'synthetic-private-data',
        });
      native.emit({ type: 'agent_end', messages: [] });
      native.isStreaming = false;
    },
    abort() {
      native.emit({ type: 'message_end', message: assistant('aborted') });
      native.isStreaming = false;
      finish?.();
      return Promise.resolve();
    },
    dispose() {
      native.disposed++;
      native.isStreaming = false;
      finish?.();
    },
  };
  function streaming() {
    return native.isStreaming;
  }
  return native;
}

function assistant(stopReason: string) {
  return { ...(structuredClone(assistantTemplate) as object), stopReason };
}
