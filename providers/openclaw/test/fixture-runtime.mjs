import { createInterface } from 'node:readline';

const mode = process.argv[2] ?? 'normal';
let pendingPrompt;
let permissionSerial = 900;
let closeAttempts = 0;
let resumeAttempts = 0;

if (mode === 'stubborn') process.on('SIGTERM', () => undefined);

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
}

function respond(id, result) {
  send({ id, result });
}

function reject(id, code = -32000) {
  send({ id, error: { code, message: 'Synthetic rejection' } });
}

function update(sessionId, value) {
  send({
    method: 'session/update',
    params: { sessionId, update: value },
  });
}

function completePrompt(prompt, stopReason = 'end_turn') {
  respond(prompt.id, { stopReason });
  pendingPrompt = undefined;
}

function normalTrace(prompt) {
  update(prompt.sessionId, {
    sessionUpdate: 'agent_thought_chunk',
    content: { type: 'text', text: 'synthetic reasoning' },
  });
  update(prompt.sessionId, {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'synthetic answer' },
  });
  update(prompt.sessionId, {
    sessionUpdate: 'tool_call',
    toolCallId: 'synthetic-tool-call',
    title: 'Synthetic tool',
    kind: 'execute',
    status: 'pending',
    rawInput: { secret: 'synthetic private input' },
  });
  update(prompt.sessionId, {
    sessionUpdate: 'tool_call_update',
    toolCallId: 'synthetic-tool-call',
    status: 'completed',
    content: [
      {
        type: 'content',
        content: { type: 'text', text: 'synthetic private output' },
      },
    ],
    rawOutput: { secret: 'synthetic private output' },
  });
  update(prompt.sessionId, {
    sessionUpdate: 'usage_update',
    used: 16,
    size: 128,
  });
  completePrompt(prompt);
}

function requestPermission(prompt) {
  const id = permissionSerial++;
  pendingPrompt = { ...prompt, permissionId: id };
  send({
    id,
    method: 'session/request_permission',
    params: {
      sessionId: prompt.sessionId,
      toolCall: {
        toolCallId: 'synthetic-tool-call',
        title: 'Synthetic approval',
        kind: 'execute',
        status: 'pending',
      },
      options: [
        ...(mode === 'permission-persistent-first'
          ? [
              {
                optionId: 'allow-always',
                name: 'Always allow',
                kind: 'allow_always',
              },
              {
                optionId: 'reject-always',
                name: 'Always reject',
                kind: 'reject_always',
              },
            ]
          : []),
        ...(mode === 'permission-deny-only'
          ? []
          : [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }]),
        { optionId: 'deny', name: 'Reject once', kind: 'reject_once' },
      ],
    },
  });
}

function handlePrompt(message) {
  const prompt = { id: message.id, sessionId: message.params.sessionId };
  if (mode === 'exit-during-run') {
    process.nextTick(() => process.exit(4));
    return;
  }
  if (mode === 'malformed-terminal') {
    completePrompt(prompt, 'future-success');
    return;
  }
  if (mode === 'refusal') {
    completePrompt(prompt, 'refusal');
    return;
  }
  if (mode === 'max-tokens') {
    completePrompt(prompt, 'max_tokens');
    return;
  }
  if (mode === 'max-turns') {
    completePrompt(prompt, 'max_turn_requests');
    return;
  }
  if (mode === 'prompt-error') {
    reject(message.id);
    return;
  }
  if (
    mode === 'cancel' ||
    mode === 'slow' ||
    mode === 'stubborn' ||
    mode === 'cancel-unconfirmed' ||
    mode === 'exit-on-cancel'
  ) {
    pendingPrompt = prompt;
    return;
  }
  if (
    mode === 'permission' ||
    mode === 'permission-deny-only' ||
    mode === 'permission-persistent-first'
  ) {
    requestPermission(prompt);
    return;
  }
  if (mode === 'unknown') {
    update(prompt.sessionId, {
      sessionUpdate: 'future_openclaw_update',
      enabled: true,
      secret: 'synthetic private value',
    });
    update(prompt.sessionId, {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'synthetic answer' },
    });
    completePrompt(prompt);
    return;
  }
  if (mode === 'mismatched-update') {
    update('synthetic-other-session', {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'synthetic unrelated content' },
    });
    completePrompt(prompt);
    return;
  }
  if (mode === 'empty') {
    completePrompt(prompt);
    return;
  }
  if (mode === 'overflow') {
    for (let index = 0; index < 32; index += 1) {
      update(prompt.sessionId, {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: `synthetic-${String(index)}` },
      });
    }
    completePrompt(prompt);
    return;
  }
  if (mode === 'late-after-terminal') {
    update(prompt.sessionId, {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'synthetic answer' },
    });
    completePrompt(prompt);
    setImmediate(() => {
      update(prompt.sessionId, {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'synthetic late content' },
      });
    });
    return;
  }
  normalTrace(prompt);
}

lines.on('line', (line) => {
  const message = JSON.parse(line);
  if ('result' in message || 'error' in message) {
    if (pendingPrompt?.permissionId === message.id) {
      const prompt = pendingPrompt;
      const selectedOption = message.result?.outcome?.optionId;
      update(prompt.sessionId, {
        sessionUpdate: 'agent_message_chunk',
        content: {
          type: 'text',
          text:
            typeof selectedOption === 'string'
              ? `synthetic ${selectedOption} answer`
              : 'synthetic approved answer',
        },
      });
      completePrompt(prompt);
    }
    return;
  }
  if (message.method === 'initialize') {
    const limited = mode === 'capabilities-limited';
    if (mode === 'permission-during-init') {
      send({
        id: permissionSerial++,
        method: 'session/request_permission',
        params: {
          sessionId: 'synthetic-pre-init-session',
          toolCall: {
            toolCallId: 'synthetic-tool-call',
            title: 'Synthetic pre-init approval',
            kind: 'execute',
            status: 'pending',
          },
          options: [
            { optionId: 'deny', name: 'Reject once', kind: 'reject_once' },
          ],
        },
      });
    }
    respond(message.id, {
      protocolVersion: mode === 'protocol-mismatch' ? 2 : 1,
      agentInfo: {
        name:
          mode === 'identity-mismatch' ||
          (mode === 'environment-inheritance' &&
            process.env.HARAPTER_OPENCLAW_SYNTHETIC_SENTINEL !== 'present')
            ? 'synthetic-lookalike'
            : 'openclaw-acp',
        title: 'Synthetic OpenClaw ACP Gateway',
        version: '2026.8.1-synthetic',
      },
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: {
          audio: false,
          embeddedContext: true,
          image: !limited,
        },
        mcpCapabilities: { http: false, sse: false },
        sessionCapabilities: limited
          ? { list: {} }
          : { list: {}, resume: {}, close: {} },
      },
      authMethods: [],
    });
    return;
  }
  if (message.method === 'session/new') {
    if (mode === 'new-timeout') return;
    if (mode === 'new-error') {
      reject(message.id);
      return;
    }
    const sessionKey = message.params?._meta?.sessionKey;
    respond(message.id, {
      sessionId:
        mode === 'reuse-session'
          ? 'synthetic-reused-session'
          : typeof sessionKey === 'string'
            ? `synthetic-${sessionKey}`
            : 'synthetic-openclaw-session',
      modes: null,
      configOptions: null,
    });
    return;
  }
  if (message.method === 'session/resume') {
    if (mode === 'resume-error') {
      reject(message.id);
      return;
    }
    if (mode === 'resume-error-once' && resumeAttempts++ === 0) {
      reject(message.id);
      return;
    }
    respond(message.id, { modes: null, configOptions: null });
    return;
  }
  if (message.method === 'session/close') {
    if (mode === 'close-timeout') return;
    if (mode === 'close-error') {
      reject(message.id);
      return;
    }
    if (mode === 'close-error-once' && closeAttempts++ === 0) {
      reject(message.id);
      return;
    }
    if (pendingPrompt?.sessionId === message.params.sessionId) {
      completePrompt(pendingPrompt, 'cancelled');
    }
    respond(message.id, {});
    return;
  }
  if (message.method === 'session/prompt') {
    handlePrompt(message);
    return;
  }
  if (message.method === 'session/cancel') {
    if (mode === 'exit-on-cancel') {
      process.nextTick(() => process.exit(5));
      return;
    }
    if (mode === 'cancel-unconfirmed') return;
    if (pendingPrompt?.sessionId === message.params.sessionId) {
      completePrompt(pendingPrompt, 'cancelled');
    }
    return;
  }
  if (typeof message.method === 'string' && message.method.startsWith('_')) {
    if ('id' in message) respond(message.id, { synthetic: 'extension' });
  }
});
