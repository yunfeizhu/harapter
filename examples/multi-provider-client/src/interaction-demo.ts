import { createFakeProfile, createFakeProviderFactory } from 'harapter/testing';
import type { InteractionRequest, InteractionResponse } from 'harapter';
import { observeInteractiveRun } from './interactions.js';

export interface InteractionDemoOptions {
  readonly kind: InteractionRequest['kind'];
  readonly answer: (question: string, signal: AbortSignal) => Promise<string>;
  readonly write: (status: string) => void | Promise<void>;
}

/** Offline host UI demonstration: no tools, runtime, credentials, or model calls. */
export async function runInteractionDemo(
  options: InteractionDemoOptions,
): Promise<void> {
  const client = await createFakeProviderFactory({
    interaction: { kind: options.kind },
  }).connect(createFakeProfile());
  try {
    const session = await client.createSession();
    const run = await session.start(
      {
        parts: [
          {
            type: 'text',
            text: 'Fictional Harapter interaction demonstration.',
          },
        ],
      },
      { timeoutMs: 30_000 },
    );
    const result = await observeInteractiveRun({
      session,
      run,
      onEvent: (event) => options.write(event.type),
      onInteraction: async ({
        request,
        signal,
      }): Promise<InteractionResponse> => {
        // Only fixed synthetic descriptions are printed; real requests need a
        // host-reviewed presentation function, never a generic payload dump.
        if (request.kind === 'approval') {
          const answer = await options.answer(
            'Allow the fictional Harapter action? Type approve or deny: ',
            signal,
          );
          if (answer !== 'approve' && answer !== 'deny')
            throw new Error('Invalid decision.');
          return { kind: 'approval', decision: answer };
        }
        if (request.kind === 'provider') {
          const answer = await options.answer(
            'Confirm the synthetic extension action? Type confirm or cancel: ',
            signal,
          );
          if (answer !== 'confirm' && answer !== 'cancel')
            throw new Error('Invalid decision.');
          return {
            kind: 'provider',
            value: { confirmed: answer === 'confirm' },
          };
        }
        const answer = await options.answer(
          'Enter a fictional project name: ',
          signal,
        );
        if (answer.trim().length === 0) throw new Error('Input is required.');
        return { kind: 'user_input', parts: [{ type: 'text', text: answer }] };
      },
    });
    await options.write(result.status);
    if (result.status !== 'completed') throw new Error('Run did not complete.');
    await session.close();
  } catch {
    throw new Error('Interaction demo failed.');
  } finally {
    await client.close();
  }
}
