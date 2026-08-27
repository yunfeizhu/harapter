import { createInterface } from 'node:readline';

let initialized = false;
let lastCompletedTurnId;
let threadSerial = 0;
let turnSerial = 0;
const turns = new Map();
const approvals = new Map();
const mode = process.argv[2] ?? 'normal';

if (mode === 'stubborn') {
  process.on('SIGTERM', () => undefined);
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function thread(id) {
  return { id, ephemeral: false, turns: [] };
}

function turn(id, status, error = null) {
  return {
    id,
    items: [],
    itemsView: 'full',
    status,
    error,
    startedAt: 1,
    completedAt: status === 'inProgress' ? null : 2,
    durationMs: status === 'inProgress' ? null : 1000,
  };
}

function complete(threadId, turnId, text) {
  send({
    method: 'item/agentMessage/delta',
    params: { threadId, turnId, itemId: `${turnId}-message`, delta: text },
  });
  send({
    method: 'future/syntheticEvent',
    params: {
      threadId,
      turnId,
      secret: 'synthetic-sensitive-value',
      nested: { path: '/synthetic/private/file' },
    },
  });
  send({
    method: 'item/completed',
    params: {
      threadId,
      turnId,
      completedAtMs: 2,
      item: {
        type: 'agentMessage',
        id: `${turnId}-message`,
        text,
        phase: 'final_answer',
        memoryCitation: null,
      },
    },
  });
  send({
    method: 'turn/completed',
    params: { threadId, turn: turn(turnId, 'completed') },
  });
  lastCompletedTurnId = turnId;
  turns.delete(turnId);
}

lines.on('line', (line) => {
  const message = JSON.parse(line);

  if (Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error')) {
    const pending = approvals.get(String(message.id));
    if (pending) {
      approvals.delete(String(message.id));
      const decision = message.result?.decision ?? 'provider-response';
      send({
        method: 'serverRequest/resolved',
        params: { threadId: pending.threadId, requestId: message.id },
      });
      complete(
        pending.threadId,
        pending.turnId,
        `approval:${String(decision)}`,
      );
    }
    return;
  }

  if (message.method === 'initialize') {
    if (initialized) {
      send({
        id: message.id,
        error: { code: -32600, message: 'Already initialized' },
      });
      return;
    }
    if (mode === 'reject-initialize') {
      send({
        id: message.id,
        error: { code: -32601, message: 'Synthetic rejection.' },
      });
      return;
    }
    initialized = true;
    send({
      id: message.id,
      result: {
        userAgent:
          mode === 'malformed-initialize'
            ? 'synthetic-runtime'
            : mode === 'alternate-runtime'
              ? 'codex_cli_rs/0.0.1-synthetic (synthetic)'
              : 'codex_cli_rs/0.0.0-synthetic (synthetic)',
        codexHome: '/synthetic/codex-home',
        platformFamily: 'unix',
        platformOs: 'synthetic',
      },
    });
    if (mode === 'exit-after-initialize')
      process.nextTick(() => process.exit(3));
    return;
  }

  if (message.method === 'initialized') return;

  if (message.method === 'thread/start') {
    if (message.params?.model === 'hold-model') return;
    if (message.params?.model === 'reject-model') {
      send({
        id: message.id,
        error: { code: -32000, message: 'Synthetic rejection.' },
      });
      return;
    }
    const id = `synthetic-thread-${String(process.pid)}-${String(++threadSerial)}`;
    send({ id: message.id, result: { thread: thread(id) } });
    send({ method: 'thread/started', params: { thread: thread(id) } });
    if (mode === 'orphan-after-thread') {
      send({
        method: 'item/fileChange/requestApproval',
        id: 'synthetic-orphan-approval',
        params: {
          threadId: id,
          turnId: 'synthetic-orphan-turn',
          itemId: 'synthetic-orphan-item',
          startedAtMs: 1,
        },
      });
      send({
        method: 'future/orphanRequest',
        id: 'synthetic-orphan-request',
        params: {
          threadId: id,
          turnId: 'synthetic-orphan-turn',
          secret: 'synthetic-sensitive-value',
        },
      });
    }
    return;
  }

  if (message.method === 'thread/resume') {
    const id = message.params.threadId.includes('mismatch')
      ? 'synthetic-different-thread'
      : message.params.threadId;
    send({ id: message.id, result: { thread: thread(id) } });
    send({ method: 'thread/started', params: { thread: thread(id) } });
    return;
  }

  if (message.method === 'turn/start') {
    const threadId = message.params.threadId;
    const turnId =
      mode === 'duplicate-turn-id'
        ? 'synthetic-duplicate-turn'
        : `synthetic-turn-${String(++turnSerial)}`;
    const text = message.params.input
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('');
    if (text.includes('reject turn')) {
      send({
        id: message.id,
        error: { code: -32000, message: 'Synthetic rejection.' },
      });
      return;
    }
    turns.set(turnId, { threadId, text });
    if (mode === 'notifications-before-response') {
      send({
        method: 'turn/started',
        params: { threadId, turn: turn(turnId, 'inProgress') },
      });
      complete(threadId, turnId, text || 'pre-response');
      send({ id: message.id, result: { turn: turn(turnId, 'inProgress') } });
      return;
    }
    send({ id: message.id, result: { turn: turn(turnId, 'inProgress') } });
    send({
      method: 'turn/started',
      params: { threadId, turn: turn(turnId, 'inProgress') },
    });

    if (mode === 'exit-during-turn') {
      process.nextTick(() => process.exit(4));
      return;
    }
    if (
      text.includes('cancel conformance input') ||
      text.includes('connection abort input') ||
      text.includes('interrupt error') ||
      text.includes('interrupt race') ||
      text.includes('interrupt terminal then error') ||
      text.includes('interrupt without terminal')
    ) {
      return;
    }
    if (text.includes('late terminal')) {
      if (lastCompletedTurnId) {
        send({
          method: 'turn/completed',
          params: {
            threadId,
            turn: turn(lastCompletedTurnId, 'completed'),
          },
        });
      }
      return;
    }
    if (text.includes('malformed terminal')) {
      send({
        method: 'turn/completed',
        params: { threadId, turn: { status: 'completed' } },
      });
      return;
    }
    if (text.includes('ownerless approval')) {
      send({
        method: 'item/commandExecution/requestApproval',
        id: 47,
        params: {
          threadId,
          itemId: `${turnId}-command`,
          startedAtMs: 2,
          command: 'synthetic-command --safe',
          reason: 'Synthetic ownerless approval.',
        },
      });
      return;
    }
    if (text.includes('approval interaction')) {
      const requestId = `synthetic-approval-${turnId}`;
      approvals.set(requestId, { threadId, turnId });
      send({
        method: 'item/commandExecution/requestApproval',
        id: requestId,
        params: {
          threadId,
          turnId,
          itemId: `${turnId}-command`,
          startedAtMs: 2,
          command: 'synthetic-command --safe',
          cwd: '/synthetic/workspace',
          reason: 'Approve a synthetic command.',
        },
      });
      return;
    }
    if (text.includes('provider resolves interaction')) {
      const requestId = `synthetic-resolved-${turnId}`;
      send({
        method: 'item/fileChange/requestApproval',
        id: requestId,
        params: {
          threadId,
          turnId,
          itemId: `${turnId}-file`,
          startedAtMs: 2,
          reason: 'Synthetic provider-resolved approval.',
        },
      });
      send({
        method: 'serverRequest/resolved',
        params: { threadId, requestId },
      });
      complete(threadId, turnId, 'provider-resolved');
      return;
    }
    if (text.includes('provider interaction')) {
      const requestId = `synthetic-provider-${turnId}`;
      approvals.set(requestId, { threadId, turnId });
      send({
        method: 'future/request',
        id: requestId,
        params: {
          threadId,
          turnId,
          secret: 'synthetic-sensitive-value',
        },
      });
      return;
    }
    if (text.includes('user input interaction')) {
      const requestId = `synthetic-user-input-${turnId}`;
      approvals.set(requestId, { threadId, turnId });
      send({
        method: 'item/tool/requestUserInput',
        id: requestId,
        params: {
          threadId,
          turnId,
          itemId: `${turnId}-question`,
          questions: [
            {
              id: 'synthetic-question',
              header: 'Choice',
              question: 'Choose a synthetic answer.',
              isOther: false,
              isSecret: false,
              options: null,
            },
          ],
          isBlocking: true,
          autoResolutionMs: null,
        },
      });
      return;
    }
    if (text.includes('failed turn')) {
      send({
        method: 'error',
        params: {
          threadId,
          turnId,
          willRetry: false,
          error: {
            message: 'Synthetic private error.',
            codexErrorInfo: 'serverOverloaded',
            additionalDetails: null,
          },
        },
      });
      send({
        method: 'turn/completed',
        params: {
          threadId,
          turn: turn(turnId, 'failed', {
            message: 'Synthetic private error.',
            codexErrorInfo: 'serverOverloaded',
            additionalDetails: null,
          }),
        },
      });
      turns.delete(turnId);
      return;
    }
    if (text.includes('rich events')) {
      send({
        method: 'future/threadEvent',
        params: { threadId, secret: 'synthetic-thread-sensitive-value' },
      });
      send({
        method: 'item/started',
        params: {
          threadId,
          turnId,
          startedAtMs: 1,
          item: {
            type: 'commandExecution',
            id: `${turnId}-command`,
            command: 'synthetic-command',
            cwd: '/synthetic/workspace',
            processId: null,
            source: 'agent',
            status: 'inProgress',
            commandActions: [],
            aggregatedOutput: null,
            exitCode: null,
            durationMs: null,
            pluginId: null,
            scriptPath: null,
          },
        },
      });
      send({
        method: 'item/commandExecution/outputDelta',
        params: {
          threadId,
          turnId,
          itemId: `${turnId}-command`,
          delta: 'synthetic-output',
        },
      });
      send({
        method: 'item/completed',
        params: {
          threadId,
          turnId,
          completedAtMs: 2,
          item: {
            type: 'commandExecution',
            id: `${turnId}-command`,
            command: 'synthetic-command',
            cwd: '/synthetic/workspace',
            processId: null,
            source: 'agent',
            status: 'completed',
            commandActions: [],
            aggregatedOutput: 'synthetic-output',
            exitCode: 0,
            durationMs: 1,
            pluginId: null,
            scriptPath: null,
          },
        },
      });
      send({
        method: 'thread/tokenUsage/updated',
        params: {
          threadId,
          turnId,
          tokenUsage: {
            total: { totalTokens: 3, inputTokens: 2, outputTokens: 1 },
            last: { totalTokens: 3, inputTokens: 2, outputTokens: 1 },
            modelContextWindow: 100,
          },
        },
      });
    }
    const finalMessage = message.params.input.some(
      (part) => part.type === 'image',
    )
      ? 'image-input'
      : text || 'synthetic-empty-reply';
    complete(threadId, turnId, finalMessage);
    return;
  }

  if (message.method === 'turn/interrupt') {
    const active = turns.get(message.params.turnId);
    if (active?.text.includes('interrupt terminal then error')) {
      send({
        method: 'turn/completed',
        params: {
          threadId: active.threadId,
          turn: turn(message.params.turnId, 'interrupted'),
        },
      });
      turns.delete(message.params.turnId);
      setImmediate(() => {
        send({
          id: message.id,
          error: { code: -32000, message: 'Synthetic rejection.' },
        });
      });
      return;
    }
    if (active?.text.includes('interrupt error')) {
      send({
        id: message.id,
        error: { code: -32000, message: 'Synthetic rejection.' },
      });
      return;
    }
    send({ id: message.id, result: {} });
    if (active?.text.includes('interrupt without terminal')) return;
    if (active) {
      send({
        method: 'turn/completed',
        params: {
          threadId: active.threadId,
          turn: turn(
            message.params.turnId,
            active.text.includes('interrupt race')
              ? 'completed'
              : 'interrupted',
          ),
        },
      });
      turns.delete(message.params.turnId);
    }
    return;
  }

  send({
    id: message.id,
    error: { code: -32601, message: 'Method not found' },
  });
});
