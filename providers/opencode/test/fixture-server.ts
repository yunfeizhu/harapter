import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

interface PendingPrompt {
  readonly response: ServerResponse;
  readonly sessionId: string;
  readonly messageId: string;
  readonly mode: 'cancel' | 'connection_abort' | 'permission';
}

export interface OpenCodeFixtureServer {
  readonly url: string;
  readonly deleteRequests: () => number;
  readonly disposeRequests: () => number;
  readonly permissionResponses: () => readonly string[];
  close(): Promise<void>;
}

export interface OpenCodeFixtureServerOptions {
  readonly authorization?: string;
  readonly abortAcknowledged?: boolean;
  readonly abortSettles?: boolean;
  readonly duplicatePermission?: boolean;
  readonly healthBody?: unknown;
  readonly healthContentType?: string;
  readonly healthDelayMs?: number;
  readonly healthRawBody?: Uint8Array | string;
  readonly healthStatus?: number;
  readonly permissionAcknowledged?: boolean;
  readonly permissionResponseDelayMs?: number;
  readonly providerResolvesPermission?: boolean;
  readonly resumeMismatch?: boolean;
  readonly sessionCreateBody?: unknown;
  readonly sessionCreateStatus?: number;
  readonly sessionStatus?: 'busy' | 'idle' | 'retry';
  readonly sseConnectMode?: 'eof' | 'named' | 'normal' | 'wrong-type';
}

/** Start a deterministic synthetic implementation of the documented routes. */
export async function startOpenCodeFixtureServer(
  options: OpenCodeFixtureServerOptions = {},
): Promise<OpenCodeFixtureServer> {
  const sessions = new Map<string, FixtureSession>();
  const streams = new Set<ServerResponse>();
  const sockets = new Set<Socket>();
  const pending = new Map<string, PendingPrompt>();
  const permissionResponses: string[] = [];
  let sessionSerial = 0;
  let messageSerial = 0;
  let deleteRequests = 0;
  let disposeRequests = 0;

  const broadcast = (event: Readonly<Record<string, unknown>>): void => {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const stream of streams) stream.write(data);
  };

  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) sendJson(response, 500, { error: 'fixture' });
      else response.destroy();
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  async function handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (
      options.authorization !== undefined &&
      request.headers.authorization !== options.authorization
    ) {
      sendJson(response, 401, { error: 'unauthorized-secret' });
      return;
    }
    const url = new URL(request.url ?? '/', 'http://fixture.invalid');
    const method = request.method ?? 'GET';

    if (method === 'GET' && url.pathname === '/global/health') {
      if (options.healthDelayMs !== undefined) {
        await new Promise((resolve) =>
          setTimeout(resolve, options.healthDelayMs),
        );
      }
      if (options.healthRawBody !== undefined) {
        sendRaw(
          response,
          options.healthStatus ?? 200,
          options.healthRawBody,
          options.healthContentType ?? 'application/json',
        );
      } else {
        sendJson(
          response,
          options.healthStatus ?? 200,
          options.healthBody ?? { healthy: true, version: 'fixture-current' },
          options.healthContentType,
        );
      }
      return;
    }
    if (method === 'GET' && url.pathname === '/event') {
      response.writeHead(200, {
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'content-type': 'text/event-stream',
      });
      streams.add(response);
      response.on('close', () => streams.delete(response));
      if (options.sseConnectMode === 'eof') {
        response.end();
        return;
      }
      if (options.sseConnectMode === 'named') response.write('event: future\n');
      response.write(
        `data: ${JSON.stringify({
          type:
            options.sseConnectMode === 'wrong-type'
              ? 'session.idle'
              : 'server.connected',
          properties: {},
        })}\n\n`,
      );
      return;
    }
    if (method === 'POST' && url.pathname === '/session') {
      const body = await readJson(request);
      if (options.sessionCreateStatus !== undefined) {
        sendJson(response, options.sessionCreateStatus, {
          error: 'session-create',
        });
        return;
      }
      if (options.sessionCreateBody !== undefined) {
        sendJson(response, 200, options.sessionCreateBody);
        return;
      }
      const id = `ses_${String(++sessionSerial)}`;
      const session: FixtureSession = {
        id,
        directory: url.searchParams.get('directory') ?? '/fixture-workspace',
        projectID: 'project_fixture',
        title:
          typeof body['title'] === 'string'
            ? body['title']
            : 'Harapter session',
        version: 'fixture-current',
        time: { created: 1, updated: 1 },
      };
      sessions.set(id, session);
      sendJson(response, 200, session);
      return;
    }
    if (method === 'POST' && url.pathname === '/instance/dispose') {
      disposeRequests += 1;
      sendJson(response, 200, true);
      return;
    }
    if (method === 'GET' && url.pathname === '/session/status') {
      if (
        options.sessionStatus === undefined ||
        options.sessionStatus === 'idle'
      ) {
        sendJson(response, 200, {});
      } else {
        const statusBySession = Object.fromEntries(
          [...sessions.keys()].map((id) => [
            id,
            { type: options.sessionStatus },
          ]),
        );
        sendJson(response, 200, statusBySession);
      }
      return;
    }

    const sessionMatch = /^\/session\/([^/]+)(.*)$/u.exec(url.pathname);
    const sessionId = sessionMatch?.[1];
    const suffix = sessionMatch?.[2];
    if (sessionId === undefined || suffix === undefined) {
      sendJson(response, 404, { error: 'not-found' });
      return;
    }
    const session = sessions.get(sessionId);
    if (session === undefined) {
      sendJson(response, 404, { error: 'session-not-found-secret' });
      return;
    }
    if (method === 'GET' && suffix === '') {
      sendJson(
        response,
        200,
        options.resumeMismatch
          ? { ...session, id: 'ses_mismatch', directory: '/other-workspace' }
          : session,
      );
      return;
    }
    if (method === 'DELETE' && suffix === '') {
      deleteRequests += 1;
      sessions.delete(sessionId);
      sendJson(response, 200, true);
      return;
    }
    if (method === 'POST' && suffix === '/abort') {
      const active = pending.get(sessionId);
      const acknowledged =
        (options.abortAcknowledged ?? true) && active !== undefined;
      sendJson(response, 200, acknowledged);
      if (
        active !== undefined &&
        options.abortAcknowledged !== false &&
        options.abortSettles !== false
      ) {
        pending.delete(sessionId);
        queueMicrotask(() => {
          broadcast({
            type: 'session.idle',
            properties: { sessionID: active.sessionId },
          });
          sendJson(
            active.response,
            200,
            assistantResponse(
              active.sessionId,
              active.messageId,
              '',
              'MessageAbortedError',
            ),
          );
        });
      }
      return;
    }
    if (method === 'POST' && suffix === '/message') {
      const body = await readJson(request);
      const messageId = `msg_${String(++messageSerial)}`;
      const text = promptText(body);
      broadcast(assistantUpdated(sessionId, messageId));

      if (text.includes('permission')) {
        pending.set(sessionId, {
          response,
          sessionId,
          messageId,
          mode: 'permission',
        });
        const permissionEvent = {
          type: 'permission.asked',
          properties: {
            id: `permission_${messageId}`,
            sessionID: sessionId,
            permission: 'bash',
            patterns: ['pnpm check'],
            metadata: {},
            always: ['pnpm check'],
          },
        } as const;
        broadcast(permissionEvent);
        if (options.duplicatePermission) broadcast(permissionEvent);
        if (options.providerResolvesPermission) {
          pending.delete(sessionId);
          broadcast({
            type: 'permission.replied',
            properties: {
              sessionID: sessionId,
              requestID: `permission_${messageId}`,
              reply: 'reject',
            },
          });
          broadcast({
            type: 'session.idle',
            properties: { sessionID: sessionId },
          });
          sendJson(
            response,
            200,
            assistantResponse(sessionId, messageId, 'provider resolved'),
          );
        }
        return;
      }
      if (text.includes('cancel')) {
        pending.set(sessionId, {
          response,
          sessionId,
          messageId,
          mode: 'cancel',
        });
        return;
      }
      if (text.includes('connection abort')) {
        pending.set(sessionId, {
          response,
          sessionId,
          messageId,
          mode: 'connection_abort',
        });
        return;
      }
      if (text.includes('malformed')) {
        for (const stream of streams) stream.write('data: {malformed\n\n');
        setTimeout(() => {
          if (!response.destroyed) {
            sendJson(
              response,
              200,
              assistantResponse(sessionId, messageId, 'must not succeed'),
            );
          }
        }, 25);
        return;
      }
      if (text.includes('provider failure')) {
        sendJson(response, 500, { error: 'never expose upstream-secret' });
        return;
      }
      if (text.includes('assistant failure')) {
        sendJson(
          response,
          200,
          assistantResponse(
            sessionId,
            messageId,
            '',
            'SyntheticProviderFailure',
          ),
        );
        return;
      }
      if (text.includes('empty final')) {
        broadcast({
          type: 'session.idle',
          properties: { sessionID: sessionId },
        });
        sendJson(response, 200, assistantResponse(sessionId, messageId, ''));
        return;
      }
      if (text.includes('named SSE')) {
        for (const stream of streams) {
          stream.write(
            `event: future\ndata: ${JSON.stringify({
              type: 'future.event',
              properties: { sessionID: sessionId },
            })}\n\n`,
          );
        }
        return;
      }
      if (text.includes('close stream')) {
        for (const stream of streams) stream.end();
        return;
      }
      if (text.includes('event overflow')) {
        for (let index = 0; index < 16; index += 1) {
          broadcast({
            type: 'future.event',
            properties: { sessionID: sessionId, id: `evt_${String(index)}` },
          });
        }
        return;
      }

      broadcast({
        type: 'message.part.updated',
        properties: {
          delta: 'fixture answer',
          part: {
            id: `part_${messageId}`,
            sessionID: sessionId,
            messageID: messageId,
            type: 'text',
            text: 'fixture answer',
          },
        },
      });
      if (text.includes('unknown')) {
        broadcast({
          type: 'future.event',
          properties: {
            sessionID: sessionId,
            prompt: 'never retain fixture prompt',
            nested: { token: 'fixture-secret' },
          },
        });
      }
      if (text.includes('orphan')) {
        broadcast({
          type: 'future.orphan',
          properties: { data: 'never retain orphan data' },
        });
      }
      broadcast({
        type: 'session.idle',
        properties: { sessionID: sessionId },
      });
      sendJson(
        response,
        200,
        assistantResponse(sessionId, messageId, 'fixture answer'),
      );
      return;
    }

    const permissionMatch = /^\/permissions\/([^/]+)$/u.exec(suffix);
    if (method === 'POST' && permissionMatch !== null) {
      const body = await readJson(request);
      const decision = body['response'];
      if (
        decision !== 'once' &&
        decision !== 'always' &&
        decision !== 'reject'
      ) {
        sendJson(response, 400, { error: 'invalid-response' });
        return;
      }
      permissionResponses.push(decision);
      if (options.permissionResponseDelayMs !== undefined) {
        await new Promise((resolve) =>
          setTimeout(resolve, options.permissionResponseDelayMs),
        );
      }
      sendJson(response, 200, options.permissionAcknowledged ?? true);
      if (options.permissionAcknowledged === false) return;
      const active = pending.get(sessionId);
      if (active?.mode === 'permission') {
        pending.delete(sessionId);
        broadcast({
          type: 'permission.replied',
          properties: {
            sessionID: sessionId,
            requestID: permissionMatch[1],
            reply: decision,
          },
        });
        queueMicrotask(() => {
          broadcast({
            type: 'session.idle',
            properties: { sessionID: sessionId },
          });
          sendJson(
            active.response,
            200,
            assistantResponse(
              sessionId,
              active.messageId,
              'permission resolved',
            ),
          );
        });
      }
      return;
    }

    sendJson(response, 404, { error: 'not-found' });
  }

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${String(address.port)}/`,
    deleteRequests: () => deleteRequests,
    disposeRequests: () => disposeRequests,
    permissionResponses: () => [...permissionResponses],
    close: async () => {
      for (const stream of streams) stream.end();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      });
    },
  };
}

interface FixtureSession {
  readonly id: string;
  readonly projectID: string;
  readonly directory: string;
  readonly title: string;
  readonly version: string;
  readonly time: { readonly created: number; readonly updated: number };
}

function assistantUpdated(
  sessionId: string,
  messageId: string,
): Readonly<Record<string, unknown>> {
  return {
    type: 'message.updated',
    properties: {
      info: {
        id: messageId,
        sessionID: sessionId,
        role: 'assistant',
        tokens: {
          input: 4,
          output: 2,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      },
    },
  };
}

function assistantResponse(
  sessionId: string,
  messageId: string,
  text: string,
  errorName?: string,
): Readonly<Record<string, unknown>> {
  return {
    info: {
      id: messageId,
      sessionID: sessionId,
      role: 'assistant',
      tokens: {
        input: 4,
        output: text.length === 0 ? 0 : 2,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      ...(errorName === undefined
        ? { finish: 'stop' }
        : { error: { name: errorName, data: { message: 'fixture-secret' } } }),
    },
    parts:
      text.length === 0
        ? []
        : [
            {
              id: `part_${messageId}`,
              sessionID: sessionId,
              messageID: messageId,
              type: 'text',
              text,
            },
          ],
  };
}

async function readJson(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    const value: unknown = chunk;
    if (typeof value === 'string') chunks.push(Buffer.from(value));
    else if (value instanceof Uint8Array) chunks.push(value);
    else throw new Error('Fixture received an invalid request chunk.');
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Fixture expected an object.');
  }
  return value as Record<string, unknown>;
}

function promptText(body: Readonly<Record<string, unknown>>): string {
  const parts = body['parts'];
  if (!Array.isArray(parts)) return '';
  return parts
    .map((value) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return '';
      }
      const part = value as Record<string, unknown>;
      return part['type'] === 'text' && typeof part['text'] === 'string'
        ? part['text']
        : '';
    })
    .join('\n');
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  contentType = 'application/json; charset=utf-8',
): void {
  if (response.destroyed || response.writableEnded) return;
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-length': Buffer.byteLength(body),
    'content-type': contentType,
  });
  response.end(body);
}

function sendRaw(
  response: ServerResponse,
  status: number,
  value: Uint8Array | string,
  contentType: string,
): void {
  if (response.destroyed || response.writableEnded) return;
  const body =
    typeof value === 'string' ? Buffer.from(value) : Buffer.from(value);
  response.writeHead(status, {
    'content-length': body.byteLength,
    'content-type': contentType,
  });
  response.end(body);
}
