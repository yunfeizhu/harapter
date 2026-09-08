import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { InteractionRequest, InteractionResponse } from '@harapter/core';
import { observeInteractiveRun } from '../examples/multi-provider-client/src/interactions.js';
import { startInteractionRuntime } from './helpers/interaction-live-runtime.js';
import type { InteractionRuntime } from './helpers/interaction-live-model.js';

const providers = ['codex', 'pi', 'opencode', 'hermes', 'openclaw'] as const;
const selected = process.env['HARAPTER_INTERACTION_LIVE_PROVIDER'];
if (
  selected !== undefined &&
  selected !== 'all' &&
  !providers.some((provider) => provider === selected)
)
  throw new Error('Unknown interaction runtime selection.');
if (
  selected === 'all' &&
  process.env['HARAPTER_INTERACTION_LIVE_COMMAND'] !== undefined
)
  throw new Error('A single runtime command cannot select all providers.');

type Scenario =
  'approve' | 'deny' | 'duplicate' | 'cancel' | 'timeout' | 'close';
type Method = 'confirm' | 'select' | 'input' | 'editor';
const cases: {
  provider: InteractionRuntime;
  scenario: Scenario;
  method: Method;
}[] = providers.flatMap((provider) =>
  (['approve', 'deny', 'duplicate', 'cancel', 'timeout', 'close'] as const).map(
    (scenario) => ({ provider, scenario, method: 'confirm' }),
  ),
);
for (const method of ['select', 'input', 'editor'] as const) {
  for (const scenario of ['approve', 'deny'] as const)
    cases.push({ provider: 'pi', scenario, method });
}

for (const { provider, scenario, method } of cases) {
  it.skipIf(selected !== 'all' && selected !== provider)(
    `${provider} official runtime interaction: ${method} ${scenario}`,
    async () => {
      const configured = process.env['HARAPTER_INTERACTION_LIVE_COMMAND'];
      const directory = process.env['HARAPTER_INTERACTION_LIVE_BIN'];
      const binary =
        configured ??
        (directory === undefined ? undefined : join(directory, provider));
      if (binary === undefined)
        throw new Error('Selected interaction runtime command is missing.');
      const runtime = await startInteractionRuntime(provider, binary);
      try {
        runtime.model.method(method);
        const answered =
          scenario === 'approve' ||
          scenario === 'deny' ||
          scenario === 'duplicate';
        const approved = scenario === 'approve' || scenario === 'duplicate';
        const run = await runtime.session.start(
          { parts: [{ type: 'text', text: 'HARAPTER_INTERACTION_PROBE' }] },
          { timeoutMs: scenario === 'timeout' ? 8_000 : 30_000 },
        );
        const types: string[] = [];
        let request: InteractionRequest | undefined;
        let dismissed = false;
        let untouched = false;
        let cancellation: Promise<void> | undefined;
        let cancellationMode: string | undefined;
        let duplicate: Promise<PromiseSettledResult<unknown>[]> | undefined;
        const late = Promise.withResolvers<InteractionResponse>();
        const result = await observeInteractiveRun({
          session: runtime.session,
          run,
          onEvent: (event) => {
            types.push(event.type);
          },
          onInteraction: async (context) => {
            request = context.request;
            context.signal.addEventListener(
              'abort',
              () => {
                dismissed = true;
              },
              { once: true },
            );
            untouched = await exists(runtime.target);
            if (scenario === 'approve' || scenario === 'deny')
              return answer(provider, method, approved);
            if (scenario === 'duplicate') {
              duplicate = Promise.allSettled([
                runtime.session.respond(
                  context.request.requestId,
                  answer(provider, method, true),
                ),
                runtime.session.respond(
                  context.request.requestId,
                  answer(provider, method, true),
                ),
              ]);
            }
            if (scenario === 'cancel')
              cancellation = run.cancel().then((value) => {
                cancellationMode = value.mode;
              });
            if (scenario === 'close') cancellation = runtime.client.close();
            return late.promise;
          },
        });
        await cancellation;
        const duplicateResults = await duplicate;
        if (request === undefined)
          throw new Error(
            `No interaction: status=${result.status}; events=${types.join(',')}; model=${JSON.stringify(runtime.model.evidence())}`,
          );
        expect(
          types.filter((type) => type === 'interaction.requested').length,
        ).toBe(1);
        expect(untouched).toBe(true);
        expect(dismissed).toBe(true);
        const evidence = runtime.model.evidence();
        expect(evidence.valid).toBe(true);
        expect(evidence.calls).toBe(1);
        expect(
          answered && !(provider === 'opencode' && scenario === 'deny')
            ? evidence.returned
            : true,
        ).toBe(true);
        expect(evidence.accepted).toBe(provider === 'pi' && approved);
        expect(evidence.declined).toBe(
          provider === 'pi' && scenario === 'deny',
        );
        expect(
          types.filter((type) => type === 'interaction.resolved').length,
        ).toBe(
          answered ||
            provider === 'hermes' ||
            provider === 'opencode' ||
            provider === 'codex' ||
            (provider === 'openclaw' && scenario === 'close')
            ? 1
            : 0,
        );
        expect(
          answered
            ? types.indexOf('interaction.resolved') >
                types.indexOf('interaction.requested')
            : true,
        ).toBe(true);
        // Pi currently reports an error when an extension UI is interrupted. This
        // strict expectation records that limitation without inventing cancellation.
        const expectedStatus = answered
          ? 'completed'
          : scenario === 'close'
            ? 'connection_aborted'
            : provider === 'pi'
              ? 'failed'
              : 'cancelled';
        expect(result.status).toBe(expectedStatus);
        expect(
          expectedStatus === 'failed'
            ? safeTerminalDetail(result.providerResult)
            : 'none',
        ).toBe(expectedStatus === 'failed' ? 'error' : 'none');
        expect(cancellationMode).toBe(
          scenario === 'cancel'
            ? provider === 'pi'
              ? 'already_terminal'
              : 'native'
            : undefined,
        );
        const terminalTypes = types.filter((type) =>
          [
            'run.completed',
            'run.failed',
            'run.cancelled',
            'connection.aborted',
          ].includes(type),
        );
        expect(terminalTypes).toEqual([
          expectedStatus === 'connection_aborted'
            ? 'connection.aborted'
            : `run.${expectedStatus}`,
        ]);
        expect(types.at(-1)).toBe(terminalTypes[0]);
        expect(duplicateResults?.map((value) => value.status).sort()).toEqual(
          scenario === 'duplicate' ? ['fulfilled', 'rejected'] : undefined,
        );
        late.resolve(answer(provider, method, true));
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(await exists(runtime.target)).toBe(
          provider === 'pi' || !approved,
        );
        const requestId = request.requestId;
        await expect(
          Promise.resolve().then(() =>
            runtime.session.respond(requestId, answer(provider, method, true)),
          ),
        ).rejects.toBeDefined();
      } finally {
        await runtime.close();
      }
    },
    60_000,
  );
}

function answer(
  provider: InteractionRuntime,
  method: Method,
  approve: boolean,
): InteractionResponse {
  if (provider !== 'pi')
    return { kind: 'approval', decision: approve ? 'approve' : 'deny' };
  if (method === 'confirm')
    return { kind: 'provider', value: { confirmed: approve } };
  return {
    kind: 'provider',
    value: approve ? { value: 'Synthetic accepted' } : { cancelled: true },
  };
}

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function safeTerminalDetail(value: unknown) {
  const detail = value as { stopReason?: unknown; reason?: unknown };
  const code = detail.stopReason ?? detail.reason;
  return [
    'toolUse',
    'error',
    'missing_assistant_terminal',
    'provider_api_incompatible',
  ].includes(String(code))
    ? String(code)
    : 'other';
}
