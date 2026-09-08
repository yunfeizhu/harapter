import { createInterface } from 'node:readline/promises';
import { HarnessError } from '@harapter/core';
import type { HostInteractionHandler } from './interactions.js';

/**
 * The host supplies a description it has verified against this exact request.
 * Returning undefined denies the action. Descriptions must be safe for this
 * authorized terminal, not copied blindly from untrusted Provider payloads.
 */
export function terminalApproval(
  describe: (
    context: Parameters<HostInteractionHandler>[0],
  ) => string | undefined,
): HostInteractionHandler {
  let active = false;
  return async (context) => {
    if (context.request.kind !== 'approval')
      throw new HarnessError(
        'unsupported_capability',
        'This terminal handles portable approvals only.',
        { retryable: false },
      );
    const description = describe(context);
    if (description === undefined)
      return { kind: 'approval', decision: 'deny' };
    if (active)
      throw new Error('This terminal already has a pending decision.');
    if (
      !process.stdin.isTTY ||
      !process.stderr.isTTY ||
      description.length > 512 ||
      Array.from(description).some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || (code >= 127 && code <= 159);
      })
    )
      throw new Error(
        'An interactive terminal and a safe description are required.',
      );
    const reader = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    active = true;
    const closed = new AbortController();
    const close = () => {
      closed.abort();
    };
    reader.once('close', close);
    try {
      const answer = await reader.question(
        `${description}\nType approve or deny: `,
        { signal: AbortSignal.any([context.signal, closed.signal]) },
      );
      if (answer !== 'approve' && answer !== 'deny')
        throw new Error('Explicit decision required.');
      return { kind: 'approval', decision: answer };
    } finally {
      reader.off('close', close);
      reader.close();
      active = false;
    }
  };
}
