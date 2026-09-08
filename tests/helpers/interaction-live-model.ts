import { createServer, type ServerResponse } from 'node:http';

export type InteractionRuntime =
  'codex' | 'pi' | 'opencode' | 'hermes' | 'openclaw';

/** Real runtimes use this loopback model; no provider protocol is mocked. */
export async function startInteractionModel(
  provider: InteractionRuntime,
  command: string,
) {
  let requests = 0;
  let calls = 0;
  let returned = false;
  let valid = true;
  let failure = 'none';
  let accepted = false;
  let declined = false;
  let method = 'confirm';
  const tool = {
    codex: 'exec_command',
    pi: 'harapter_probe',
    opencode: 'bash',
    hermes: 'terminal',
    openclaw: 'exec',
  }[provider];
  const server = createServer((request, response) => {
    void (async () => {
      if (
        request.method !== 'POST' ||
        !['/v1/responses', '/v1/chat/completions'].includes(
          request.url ?? '',
        ) ||
        ++requests > 128
      ) {
        response.writeHead(400).end();
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(String(chunk));
        bytes += buffer.byteLength;
        if (bytes > 2 * 1024 * 1024)
          throw new Error('Synthetic model request limit.');
        chunks.push(buffer);
      }
      // Inspect only in memory. Never retain headers, prompts, tool output or paths.
      const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<
        string,
        unknown
      >;
      const messages = (body['messages'] ?? body['input']) as
        Record<string, unknown>[] | undefined;
      const hasResult =
        Array.isArray(messages) &&
        messages.some(
          (item) =>
            item['role'] === 'tool' || item['type'] === 'function_call_output',
        );
      const tools = body['tools'] as
        { name?: string; function?: { name?: string } }[] | undefined;
      const available =
        tools?.some((item) => (item.name ?? item.function?.name) === tool) ===
        true;
      const probe = JSON.stringify(messages).includes(
        'HARAPTER_INTERACTION_PROBE',
      );
      // Runtimes can also request a title without offering tools. A plain reply
      // serves that auxiliary request; the live test still requires a tool call.
      const invoke = probe && available && !hasResult;
      if (probe && hasResult) {
        returned = true;
        const results = JSON.stringify(
          messages.filter(
            (item) =>
              item['role'] === 'tool' ||
              item['type'] === 'function_call_output',
          ),
        );
        accepted ||= results.includes('HARAPTER_INTERACTION_ACCEPTED');
        declined ||= results.includes('HARAPTER_INTERACTION_DECLINED');
      }
      if (invoke) calls++;
      const args =
        provider === 'pi'
          ? { method }
          : provider === 'codex'
            ? {
                cmd: command,
                yield_time_ms: 1000,
                sandbox_permissions: 'require_escalated',
                justification:
                  'Exercise approval for a test-owned empty directory.',
              }
            : provider === 'opencode'
              ? {
                  command,
                  description: 'Remove the test-owned empty directory.',
                }
              : provider === 'openclaw'
                ? {
                    command,
                    host: 'gateway',
                    security: 'allowlist',
                    ask: 'always',
                  }
                : { command };
      if (request.url === '/v1/responses') {
        sendResponses(
          response,
          invoke ? { name: tool, arguments: JSON.stringify(args) } : undefined,
          requests,
        );
      } else {
        sendChat(
          response,
          invoke ? { name: tool, arguments: JSON.stringify(args) } : undefined,
          body['stream'] === true,
          requests,
        );
      }
    })().catch(() => {
      valid = false;
      failure = 'request-or-response';
      response.destroy();
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Synthetic model did not bind.');
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    method(nextMethod: 'confirm' | 'select' | 'input' | 'editor') {
      method = nextMethod;
    },
    evidence: () => ({
      valid,
      calls,
      returned,
      requests,
      failure,
      accepted,
      declined,
    }),
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
    },
  };
}

function sendResponses(
  response: ServerResponse,
  call: { name: string; arguments: string } | undefined,
  serial: number,
) {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const emit = (value: unknown) =>
    response.write(`data: ${JSON.stringify(value)}\n\n`);
  const id = `synthetic_${String(serial)}`;
  const item =
    call === undefined
      ? {
          id,
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [
            {
              type: 'output_text',
              text: 'Synthetic interaction complete.',
              annotations: [],
            },
          ],
        }
      : {
          id,
          type: 'function_call',
          call_id: id,
          status: 'completed',
          ...call,
        };
  const result = {
    id: `resp_${id}`,
    object: 'response',
    created_at: 1,
    status: 'completed',
    output: [item],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  };
  emit({
    type: 'response.created',
    response: { ...result, status: 'in_progress', output: [] },
  });
  emit({
    type: 'response.output_item.added',
    output_index: 0,
    item: {
      ...item,
      status: 'in_progress',
      ...(call === undefined ? { content: [] } : { arguments: '' }),
    },
  });
  if (call !== undefined) {
    emit({
      type: 'response.function_call_arguments.delta',
      item_id: id,
      output_index: 0,
      delta: call.arguments,
    });
    emit({
      type: 'response.function_call_arguments.done',
      item_id: id,
      output_index: 0,
      arguments: call.arguments,
    });
  } else {
    emit({
      type: 'response.content_part.added',
      item_id: id,
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text: '', annotations: [] },
    });
    emit({
      type: 'response.output_text.delta',
      item_id: id,
      output_index: 0,
      content_index: 0,
      delta: 'Synthetic interaction complete.',
    });
    emit({
      type: 'response.output_text.done',
      item_id: id,
      output_index: 0,
      content_index: 0,
      text: 'Synthetic interaction complete.',
    });
  }
  emit({ type: 'response.output_item.done', output_index: 0, item });
  emit({ type: 'response.completed', response: result });
  response.end();
}

function sendChat(
  response: ServerResponse,
  call: { name: string; arguments: string } | undefined,
  stream: boolean,
  serial: number,
) {
  const toolCalls =
    call === undefined
      ? undefined
      : [
          {
            index: 0,
            id: `call_${String(serial)}`,
            type: 'function',
            function: call,
          },
        ];
  const message = {
    role: 'assistant',
    content: call === undefined ? 'Synthetic interaction complete.' : null,
    ...(toolCalls === undefined ? {} : { tool_calls: toolCalls }),
  };
  const finish = call === undefined ? 'stop' : 'tool_calls';
  const common = {
    id: `chatcmpl_${String(serial)}`,
    created: 1,
    model: 'synthetic-model',
  };
  if (!stream) {
    response.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        ...common,
        object: 'chat.completion',
        choices: [{ index: 0, message, finish_reason: finish }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
    return;
  }
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  response.write(
    `data: ${JSON.stringify({ ...common, object: 'chat.completion.chunk', choices: [{ index: 0, delta: message, finish_reason: null }] })}\n\n`,
  );
  response.write(
    `data: ${JSON.stringify({ ...common, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\ndata: [DONE]\n\n`,
  );
  response.end();
}
