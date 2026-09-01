import { writeFileSync } from 'node:fs';
import process from 'node:process';

const args = process.argv.slice(2);
const modeIndex = args.indexOf('--fixture-mode');
const mode = modeIndex === -1 ? 'normal' : args[modeIndex + 1];
const pidFileIndex = args.indexOf('--pid-file');
if (pidFileIndex !== -1) {
  writeFileSync(args[pidFileIndex + 1], String(process.pid), 'utf8');
}
if (mode === 'slow-exit') {
  process.on('SIGTERM', () => {
    setTimeout(() => process.exit(0), 75);
  });
}
if (args.includes('--version')) {
  if (mode === 'bad-version') process.stdout.write('development-build\n');
  else if (mode === 'oversized-version') process.stdout.write('x'.repeat(300));
  else if (mode === 'version-exit') process.exit(2);
  else if (mode === 'version-timeout') {
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 60_000);
  } else if (mode !== 'version-timeout') {
    process.stdout.write('0.84.4\n');
    process.exit(0);
  }
}
const resumeIndex = args.indexOf('--session');
const sessionId =
  resumeIndex === -1
    ? `synthetic-pi-session-${String(process.pid)}`
    : args[resumeIndex + 1];
let input = Buffer.alloc(0);
let active = false;
let pendingInteraction;

process.stdin.on('data', (chunk) => {
  input = Buffer.concat([input, Buffer.from(chunk)]);
  while (true) {
    const newline = input.indexOf(0x0a);
    if (newline === -1) break;
    const line = input.subarray(0, newline);
    input = input.subarray(newline + 1);
    if (line.length === 0) continue;
    handle(JSON.parse(line.toString('utf8')));
  }
});

if (mode === 'startup-event') {
  send({ type: 'startup_synthetic_event', secret: 'startup-private-value' });
}

function handle(command) {
  if (command.type === 'get_state') {
    if (mode === 'state-reject') {
      sendResponse(command, false);
      return;
    }
    if (mode === 'unmatched-response') {
      send({
        id: 'synthetic-unmatched-id',
        type: 'response',
        command: 'get_state',
        success: true,
        data: {},
      });
      return;
    }
    const reportedSessionId =
      mode === 'wrong-session'
        ? 'synthetic-other-session'
        : mode === 'fixed-session'
          ? 'synthetic-fixed-session'
          : sessionId;
    const respond = () =>
      sendResponse(command, true, {
        sessionId: reportedSessionId,
        sessionFile: '/synthetic/private/session.jsonl',
        ...(mode === 'invalid-state' ? {} : { thinkingLevel: 'medium' }),
        isStreaming: mode === 'busy-state',
        isCompacting: false,
        steeringMode: 'one-at-a-time',
        followUpMode: 'one-at-a-time',
        autoCompactionEnabled: true,
        messageCount: 0,
        pendingMessageCount: 0,
      });
    if (mode === 'slow-state') setTimeout(respond, 40);
    else respond();
    return;
  }
  if (command.type === 'prompt') {
    if (mode === 'prompt-reject') {
      sendResponse(command, false);
      return;
    }
    if (mode === 'slow-ack') return;
    sendResponse(command, true);
    if (
      mode === 'handled-input' &&
      !['--no-extensions', '--no-skills', '--no-prompt-templates'].every(
        (argument) => args.includes(argument),
      )
    ) {
      return;
    }
    active = true;
    send({ type: 'agent_start' });
    if (
      mode === 'cancel' ||
      mode === 'abort-no-terminal' ||
      String(command.message).includes('cancel conformance input')
    ) {
      return;
    }
    if (mode === 'interaction') {
      pendingInteraction = 'synthetic-native-interaction';
      send({
        type: 'extension_ui_request',
        id: pendingInteraction,
        method: 'confirm',
        title: 'Synthetic confirmation',
        message: 'Continue the synthetic Run?',
      });
      return;
    }
    if (mode === 'select-interaction') {
      pendingInteraction = 'synthetic-native-interaction';
      send({
        type: 'extension_ui_request',
        id: pendingInteraction,
        method: 'select',
        title: 'Synthetic selection',
        options: ['first', 'second'],
      });
      return;
    }
    if (mode === 'input-interaction') {
      pendingInteraction = 'synthetic-native-interaction';
      send({
        type: 'extension_ui_request',
        id: pendingInteraction,
        method: 'input',
        placeholder: 'Synthetic value',
      });
      return;
    }
    if (mode === 'multi-interaction') {
      send({
        type: 'extension_ui_request',
        id: 'synthetic-interaction-one',
        method: 'confirm',
        title: 'First',
        message: 'First?',
      });
      send({
        type: 'extension_ui_request',
        id: 'synthetic-interaction-two',
        method: 'confirm',
        title: 'Second',
        message: 'Second?',
      });
      return;
    }
    if (mode === 'notify') {
      send({
        type: 'extension_ui_request',
        id: 'synthetic-notify',
        method: 'notify',
        message: 'private notification',
      });
    }
    if (mode === 'malformed-event') {
      send({ future: 'missing type' });
      return;
    }
    if (mode === 'malformed-json') {
      process.stdout.write('{malformed}\n');
      return;
    }
    setTimeout(() => finishPrompt(mode), 8);
    return;
  }
  if (command.type === 'abort') {
    if (mode === 'abort-reject') {
      sendResponse(command, false);
      return;
    }
    if (mode === 'abort-completes' && active) {
      finishPrompt('normal');
      sendResponse(command, true);
      return;
    }
    if (mode === 'abort-response-lost' && active) {
      sendAssistant('aborted', '');
      send({ type: 'agent_end', messages: [], willRetry: false });
      send({ type: 'agent_settled' });
      active = false;
      return;
    }
    if (mode !== 'abort-no-terminal' && active) {
      sendAssistant('aborted', '');
      send({ type: 'agent_end', messages: [], willRetry: false });
      send({ type: 'agent_settled' });
      active = false;
    }
    sendResponse(command, true);
    return;
  }
  if (command.type === 'extension_ui_response') {
    if (command.id === pendingInteraction) {
      pendingInteraction = undefined;
      finishPrompt('normal');
    }
    return;
  }
  if (
    command.type === 'get_commands' ||
    command.type === 'get_messages' ||
    command.type === 'get_entries' ||
    command.type === 'get_tree' ||
    command.type === 'get_session_stats' ||
    command.type === 'get_last_assistant_text' ||
    command.type === 'get_available_models' ||
    command.type === 'get_available_thinking_levels'
  ) {
    if (mode === 'slow-native' && command.type === 'get_messages') return;
    if (mode === 'late-native' && command.type === 'get_messages') {
      setTimeout(
        () => sendResponse(command, true, { fixture: command.type }),
        40,
      );
      return;
    }
    sendResponse(command, true, { fixture: command.type });
    return;
  }
  sendResponse(command, false);
}

function finishPrompt(selectedMode) {
  if (!active) return;
  if (selectedMode === 'eof') {
    process.stdout.end();
    return;
  }
  if (selectedMode === 'missing-terminal') {
    send({ type: 'agent_end', messages: [], willRetry: false });
    send({ type: 'agent_settled' });
    active = false;
    return;
  }
  if (selectedMode === 'unknown') {
    send({
      type: 'future_private_event',
      phase: 'synthetic',
      secret: 'fixture-secret-must-not-escape',
      nested: { path: '/private/synthetic/path' },
    });
  }
  if (selectedMode === 'retry') {
    sendAssistant('error', 'transient answer');
    send({ type: 'agent_end', messages: [], willRetry: true });
    send({
      type: 'auto_retry_start',
      attempt: 1,
      maxAttempts: 3,
      delayMs: 1,
      errorMessage: 'private provider failure',
    });
  }
  const stopReason =
    selectedMode === 'unsolicited-abort'
      ? 'aborted'
      : selectedMode === 'error'
        ? 'error'
        : selectedMode === 'length'
          ? 'length'
          : selectedMode === 'tool-use'
            ? 'toolUse'
            : selectedMode === 'deferred'
              ? 'deferred'
              : 'stop';
  send({
    type: 'message_update',
    usage: usage(),
    assistantMessageEvent: {
      type: 'thinking_delta',
      contentIndex: 0,
      delta: 'synthetic reasoning',
    },
  });
  send({
    type: 'message_update',
    usage: usage(),
    assistantMessageEvent: {
      type: 'text_delta',
      contentIndex: 1,
      delta: 'synthetic answer',
    },
  });
  send({
    type: 'tool_execution_start',
    toolCallId: 'synthetic-private-tool-call',
    toolName: 'read',
    args: { path: '/private/synthetic/path' },
  });
  send({
    type: 'tool_execution_end',
    toolCallId: 'synthetic-private-tool-call',
    toolName: 'read',
    result: { content: 'private fixture body' },
    isError: false,
  });
  sendAssistant(stopReason, selectedMode === 'empty' ? '' : 'synthetic answer');
  send({ type: 'agent_end', messages: [], willRetry: false });
  send({ type: 'agent_settled' });
  active = false;
  if (selectedMode === 'late') {
    send({ type: 'late_synthetic_event', content: 'late private content' });
  }
}

function sendAssistant(stopReason, text) {
  send({
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'synthetic reasoning' },
        ...(text.length === 0 ? [] : [{ type: 'text', text }]),
      ],
      api: 'synthetic',
      provider: 'synthetic',
      model: 'synthetic-model',
      usage: usage(),
      stopReason,
      ...(stopReason === 'error'
        ? { errorMessage: 'private provider failure' }
        : {}),
      timestamp: 0,
    },
  });
}

function usage() {
  return {
    input: 7,
    output: 5,
    cacheRead: 2,
    cacheWrite: 1,
    totalTokens: 15,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function sendResponse(command, success, data) {
  send({
    id: command.id,
    type: 'response',
    command: command.type,
    success,
    ...(data === undefined ? {} : { data }),
    ...(!success ? { error: 'private provider rejection' } : {}),
  });
}

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
