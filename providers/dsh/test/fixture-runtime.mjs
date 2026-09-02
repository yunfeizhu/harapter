import { createInterface } from 'node:readline';

const mode = process.argv[2] ?? 'normal';
let initialized = false;
let promptCount = 0;
const sequences = new Map();

if (mode === 'stubborn') process.on('SIGTERM', () => undefined);

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
}

function event(sessionId, type, data, ignorable = false) {
  const seq = sequences.get(sessionId) ?? 0;
  sequences.set(sessionId, seq + 1);
  send({
    method: 'session.event',
    params: {
      sessionId,
      event: {
        type,
        seq,
        time: seq + 1,
        data,
        ...(ignorable ? { ignorable: true } : {}),
      },
    },
  });
}

function status(sessionId, value) {
  send({
    method: 'session.status',
    params: { sessionId, status: value },
  });
}

function receipt(sessionId, messageId, inserted = [messageId]) {
  event(sessionId, 'agent/inbox/spliced', {
    target: 'next-turn',
    start: 0,
    inserted: inserted.map((id) => ({
      id,
      role: 'user',
      content: [{ type: 'text', text: 'synthetic input' }],
      source: { kind: 'user' },
    })),
  });
}

function assistantMessage(id, text) {
  return {
    id,
    role: 'assistant',
    content: [{ type: 'text', text }],
    source: {
      kind: 'model',
      provider: 'synthetic-provider',
      model: 'synthetic-model',
    },
  };
}

function completed(sessionId, messageId, text) {
  receipt(sessionId, messageId);
  status(sessionId, 'running');
  event(sessionId, 'turn/start', { turn: 1 });
  event(sessionId, 'assistant/chunk', {
    turn: 1,
    step: 1,
    chunk: {
      type: 'reasoning-delta',
      index: 0,
      text: 'synthetic reasoning',
    },
  });
  event(sessionId, 'assistant/chunk', {
    turn: 1,
    step: 1,
    chunk: { type: 'text-delta', index: 0, text },
  });
  event(sessionId, 'assistant/chunk', {
    turn: 1,
    step: 1,
    chunk: {
      type: 'usage',
      usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
    },
  });
  event(
    sessionId,
    'future/ignorable',
    {
      prompt: 'synthetic sensitive content',
      path: '/synthetic/private/path',
    },
    true,
  );
  event(sessionId, 'tool/call', {
    turn: 1,
    step: 1,
    callId: 'synthetic-call',
    name: 'synthetic-tool',
    arguments: '{"secret":"synthetic private arguments"}',
  });
  event(sessionId, 'tool/result', {
    turn: 1,
    step: 1,
    message: {
      id: 'synthetic-tool-result',
      role: 'user',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'synthetic-call',
          content: [{ type: 'text', text: 'synthetic private result' }],
        },
      ],
      source: { kind: 'tool', callId: 'synthetic-call' },
    },
  });
  event(sessionId, 'assistant/message', {
    turn: 1,
    step: 1,
    message: assistantMessage(`assistant-${messageId}`, text),
    usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
  });
  event(sessionId, 'turn/end', {
    turn: 1,
    reason: { kind: 'completed' },
  });
  status(sessionId, 'idle');
}

function currentProfileCompleted(sessionId, messageId, text) {
  event(sessionId, 'permission/preset', { preset: 'workspace-write' });
  event(sessionId, 'sandbox/mode', { mode: 'workspace-write' });
  event(sessionId, 'approval/policy', { policy: 'ask' });
  receipt(sessionId, messageId);
  status(sessionId, 'running');
  event(sessionId, 'turn/start', { turn: 1 });
  event(sessionId, 'agent/inbox/spliced', {
    target: 'next-turn',
    start: 0,
    removedCount: 1,
    inserted: [],
  });
  event(sessionId, 'step/start', { turn: 1, step: 1 });
  event(sessionId, 'user/message', {
    id: messageId,
    role: 'user',
    content: [{ type: 'text', text: 'synthetic input' }],
    source: { kind: 'user' },
  });
  event(sessionId, 'session/title', {
    title: 'Synthetic title',
    messageSeqs: [7],
    source: { kind: 'fallback' },
  });
  event(sessionId, 'request/header', {
    header: {
      config: {
        provider: 'synthetic-provider',
        model: 'synthetic-model',
      },
    },
    reason: 'initial',
  });
  event(sessionId, 'request/context', {
    provider: 'synthetic-provider',
    model: 'synthetic-model',
  });
  event(sessionId, 'assistant/chunk', {
    turn: 1,
    step: 1,
    chunk: { type: 'text-delta', index: 0, text },
  });
  event(sessionId, 'assistant/message', {
    turn: 1,
    step: 1,
    message: assistantMessage(`assistant-${messageId}`, text),
  });
  event(sessionId, 'step/end', { turn: 1, step: 1 });
  event(sessionId, 'turn/end', {
    turn: 1,
    reason: { kind: 'completed' },
  });
  status(sessionId, 'idle');
}

function terminalRun(sessionId, messageId, reason, text = 'synthetic answer') {
  receipt(sessionId, messageId);
  status(sessionId, 'running');
  event(sessionId, 'assistant/message', {
    turn: 1,
    step: 1,
    message: assistantMessage(`assistant-${messageId}`, text),
  });
  if (reason !== undefined) {
    event(sessionId, 'turn/end', { turn: 1, reason });
  }
  status(sessionId, 'idle');
}

function runScenario(sessionId, messageId, text, currentPromptCount) {
  if (mode === 'current-profile') {
    currentProfileCompleted(sessionId, messageId, text);
    return;
  }
  if (mode === 'exit-during-run') {
    receipt(sessionId, messageId);
    status(sessionId, 'running');
    process.nextTick(() => process.exit(4));
    return;
  }
  if (mode === 'missing-terminal') {
    terminalRun(sessionId, messageId, undefined);
    return;
  }
  if (mode === 'duplicate-terminal') {
    receipt(sessionId, messageId);
    event(sessionId, 'turn/end', {
      turn: 1,
      reason: { kind: 'completed' },
    });
    event(sessionId, 'turn/end', {
      turn: 2,
      reason: { kind: 'completed' },
    });
    status(sessionId, 'idle');
    return;
  }
  if (mode === 'unknown-terminal') {
    terminalRun(sessionId, messageId, { kind: 'future-terminal' });
    return;
  }
  if (mode === 'required-unknown') {
    receipt(sessionId, messageId);
    event(sessionId, 'future/required', { secret: 'synthetic private value' });
    return;
  }
  if (mode === 'malformed-event') {
    receipt(sessionId, messageId);
    send({
      method: 'session.event',
      params: { sessionId, event: { type: 'turn/end', data: {} } },
    });
    return;
  }
  if (mode === 'stale-terminal-sequence') {
    receipt(sessionId, messageId);
    send({
      method: 'session.event',
      params: {
        sessionId,
        event: {
          type: 'turn/end',
          seq: 0,
          time: 2,
          data: { turn: 1, reason: { kind: 'completed' } },
        },
      },
    });
    status(sessionId, 'idle');
    return;
  }
  if (mode === 'competing-prompt') {
    receipt(sessionId, messageId);
    receipt(sessionId, 'message-competing');
    return;
  }
  if (mode === 'competing-next-step') {
    receipt(sessionId, messageId);
    event(sessionId, 'agent/inbox/spliced', {
      target: 'next-step',
      start: 0,
      inserted: [
        {
          id: 'message-competing',
          role: 'user',
          content: [{ type: 'text', text: 'synthetic steering' }],
          source: { kind: 'user' },
        },
      ],
    });
    return;
  }
  if (mode === 'competing-plugin') {
    receipt(sessionId, messageId);
    event(sessionId, 'agent/inbox/spliced', {
      target: 'next-turn',
      start: 0,
      inserted: [
        {
          id: 'message-competing',
          role: 'user',
          content: [{ type: 'text', text: 'synthetic plugin work' }],
          source: { kind: 'plugin', plugin: 'synthetic-plugin' },
        },
      ],
    });
    return;
  }
  if (mode === 'ambiguous-receipt') {
    receipt(sessionId, messageId, [messageId, 'message-competing']);
    return;
  }
  if (mode === 'ambiguous-plugin-receipt') {
    event(sessionId, 'agent/inbox/spliced', {
      target: 'next-turn',
      start: 0,
      inserted: [
        {
          id: messageId,
          role: 'user',
          content: [{ type: 'text', text: 'synthetic input' }],
          source: { kind: 'user' },
        },
        {
          id: 'message-competing',
          role: 'user',
          content: [{ type: 'text', text: 'synthetic plugin work' }],
          source: { kind: 'plugin', plugin: 'synthetic-plugin' },
        },
      ],
    });
    return;
  }
  if (mode === 'aborted-terminal') {
    terminalRun(sessionId, messageId, {
      kind: 'aborted',
      reason: { kind: 'user' },
    });
    return;
  }
  if (mode === 'malformed-aborted-terminal') {
    terminalRun(sessionId, messageId, {
      kind: 'aborted',
      reason: { kind: 'future' },
    });
    return;
  }
  if (mode === 'blocked-terminal') {
    terminalRun(sessionId, messageId, { kind: 'blocked' });
    return;
  }
  if (mode === 'max-tokens-terminal') {
    terminalRun(sessionId, messageId, { kind: 'max-tokens' });
    return;
  }
  if (mode === 'interrupted-terminal') {
    terminalRun(sessionId, messageId, { kind: 'interrupted' });
    return;
  }
  if (mode === 'error-terminal') {
    terminalRun(sessionId, messageId, {
      kind: 'error',
      error: {
        code: 'SYNTHETIC_FAILURE',
        message: 'synthetic private failure',
      },
    });
    return;
  }
  if (mode === 'malformed-error-terminal') {
    terminalRun(sessionId, messageId, {
      kind: 'error',
      error: { message: 'synthetic private failure' },
    });
    return;
  }
  if (mode === 'subagent') {
    receipt(sessionId, messageId);
    send({
      method: 'subagent.started',
      params: {
        parentSessionId: sessionId,
        childSessionId: 'synthetic-child-session',
      },
    });
    status('synthetic-child-session', 'running');
    event('synthetic-child-session', 'assistant/message', {
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'synthetic child answer' }],
      },
    });
    send({
      method: 'subagent.finished',
      params: {
        provider: 'synthetic-provider',
        agentId: 'synthetic-child-session',
        parentSessionId: sessionId,
        childSessionId: 'synthetic-child-session',
        status: 'ok',
        stopReason: { kind: 'completed' },
      },
    });
    event(sessionId, 'turn/end', {
      turn: 1,
      reason: { kind: 'completed' },
    });
    status(sessionId, 'idle');
    return;
  }
  if (mode === 'subagent-late') {
    receipt(sessionId, messageId);
    if (currentPromptCount === 1) {
      send({
        method: 'subagent.started',
        params: {
          parentSessionId: sessionId,
          childSessionId: 'synthetic-old-child',
        },
      });
      send({
        method: 'subagent.finished',
        params: {
          provider: 'synthetic-provider',
          agentId: 'synthetic-old-child',
          parentSessionId: sessionId,
          childSessionId: 'synthetic-old-child',
          status: 'ok',
          stopReason: { kind: 'completed' },
        },
      });
    } else {
      event('synthetic-late-started-child', 'assistant/message', {
        turn: 1,
        step: 1,
        message: assistantMessage(
          'late-started-child-message',
          'late started child output',
        ),
      });
      event('synthetic-old-child', 'assistant/message', {
        turn: 1,
        step: 1,
        message: assistantMessage('late-child-message', 'late child output'),
      });
      send({
        method: 'subagent.started',
        params: {
          parentSessionId: 'synthetic-old-child',
          childSessionId: 'synthetic-late-grandchild',
        },
      });
    }
    event(sessionId, 'turn/end', {
      turn: currentPromptCount,
      reason: { kind: 'completed' },
    });
    status(sessionId, 'idle');
    return;
  }
  if (mode === 'server-request') {
    receipt(sessionId, messageId);
    send({
      id: 'synthetic-server-request',
      method: 'future/request',
      params: { secret: 'synthetic private value' },
    });
    event(sessionId, 'turn/end', {
      turn: 1,
      reason: { kind: 'completed' },
    });
    status(sessionId, 'idle');
    return;
  }
  if (text.includes('connection abort input')) {
    receipt(sessionId, messageId);
    status(sessionId, 'running');
    return;
  }
  if (text.includes('cancel conformance input')) {
    setTimeout(() => completed(sessionId, messageId, text), 25).unref();
    return;
  }
  completed(sessionId, messageId, text || 'synthetic answer');
}

lines.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
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
      result:
        mode === 'malformed-initialize'
          ? { serverInfo: { name: 'synthetic-lookalike', version: '0.0.0' } }
          : {
              serverInfo: {
                name: 'deepseek-harness-sdk-runtime',
                version: '0.0.0-synthetic',
              },
            },
    });
    if (mode === 'exit-after-initialize') {
      process.nextTick(() => process.exit(3));
    }
    return;
  }

  if (message.method === 'session/prompt') {
    if (!initialized) {
      send({
        id: message.id,
        error: { code: -32600, message: 'Not initialized.' },
      });
      return;
    }
    if (mode === 'reject-prompt') {
      send({
        id: message.id,
        error: { code: -32000, message: 'Synthetic rejection.' },
      });
      return;
    }
    if (mode === 'hold-prompt') return;
    if (mode === 'exit-on-prompt') {
      process.nextTick(() => process.exit(5));
      return;
    }
    const sessionId = message.params.sessionId;
    promptCount += 1;
    if (mode === 'subagent-late' && promptCount === 2) {
      send({
        method: 'subagent.finished',
        params: {
          provider: 'synthetic-provider',
          agentId: 'synthetic-old-child',
          parentSessionId: sessionId,
          childSessionId: 'synthetic-old-child',
          status: 'ok',
          stopReason: { kind: 'completed' },
        },
      });
      send({
        method: 'subagent.started',
        params: {
          parentSessionId: sessionId,
          childSessionId: 'synthetic-late-started-child',
        },
      });
    }
    const messageId = `synthetic-message-${String(process.pid)}`;
    const text = message.params.contentBlocks
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('');
    if (mode === 'notifications-before-response') {
      completed(sessionId, messageId, text || 'synthetic answer');
    }
    if (mode === 'malformed-prompt-after-complete') {
      completed(sessionId, messageId, text || 'synthetic answer');
    }
    if (mode === 'raw-before-receipt') {
      send({
        method: 'future/notification',
        params: { secret: 'synthetic private value' },
      });
      status(sessionId, 'idle');
    }
    send({
      id: message.id,
      result:
        mode === 'malformed-prompt' ||
        mode === 'malformed-prompt-after-complete'
          ? { queued: true }
          : { messageId },
    });
    if (
      mode !== 'notifications-before-response' &&
      mode !== 'malformed-prompt' &&
      mode !== 'malformed-prompt-after-complete'
    ) {
      process.nextTick(() =>
        runScenario(sessionId, messageId, text, promptCount),
      );
    }
    return;
  }

  if (message.method === 'shutdown') {
    if (mode !== 'shutdown-no-response') send({ id: message.id, result: {} });
    if (mode !== 'stubborn') process.nextTick(() => process.exit(0));
    return;
  }

  if (message.method === 'synthetic/echo') {
    send({ id: message.id, result: message.params ?? {} });
    return;
  }

  if (message.method === 'synthetic/notify') {
    send({
      method: 'future/notification',
      params: { secret: 'synthetic private value' },
    });
    return;
  }

  if (Object.hasOwn(message, 'id')) return;
});
