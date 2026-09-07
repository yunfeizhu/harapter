import { readFileSync } from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { once } from 'node:events';
import { WebSocketServer, type WebSocket } from 'ws';
import { profileId, type HarnessProfile } from '@harapter/core';
import { DSH_PROVIDER_ID } from '../src/protocol.js';
import { DSH_GATEWAY_PROTOCOL } from '../src/gateway-types.js';

interface Event {
  type: string;
  seq: number;
  time: number;
  data: Record<string, unknown>;
}
interface Session {
  id: string;
  parent?: string;
  events: Event[];
  turn: number;
}
interface Envelope {
  rpcId: string;
  method: string;
  payload: { args: { request?: Record<string, unknown> } };
}
const template = JSON.parse(
  readFileSync(
    new URL(
      '../../../fixtures/dsh/gateway-session-v2/completed.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as Event[];

/** Synthetic HTTP/WS server using pinned upstream envelopes and fixture events. */
export async function gatewayFixture(): Promise<{
  profile: HarnessProfile;
  sessions: Map<string, Session>;
  methods: string[];
  setMode(mode: string): void;
  setResponse(handler: (method: string, value: unknown) => unknown): void;
  setFrame(handler: (value: unknown) => unknown): void;
  emit(id: string, type: string, data?: Record<string, unknown>): void;
  disconnect(): void;
  close(): Promise<void>;
}> {
  const sessions = new Map<string, Session>();
  const subscriptions = new Map<WebSocket, Map<string, string>>();
  const methods: string[] = [];
  let serial = 0;
  let mode = 'normal';
  let transformResponse = (_method: string, value: unknown): unknown => value;
  let transformFrame = (value: unknown): unknown => value;
  const publish = (session: Session, event: Event): void => {
    session.events.push(event);
    for (const [socket, streams] of subscriptions) {
      for (const [streamId, id] of streams) {
        if (id === session.id)
          socket.send(
            JSON.stringify({
              type: 'item',
              streamId,
              value: transformFrame({ type: 'event', event }),
            }),
          );
      }
    }
  };
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      response.destroy();
    });
  });
  async function handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of request)
      chunks.push(Buffer.from(chunk as Buffer));
    const envelope = JSON.parse(Buffer.concat(chunks).toString()) as Envelope;
    methods.push(envelope.method);
    if (mode === 'reject-prompt' && envelope.method === 'session/prompt') {
      response.end(
        JSON.stringify({
          type: 'server-response',
          rpcId: envelope.rpcId,
          result: {
            ok: false,
            error: {
              code: 'session/agent-busy',
              message: 'synthetic',
              details: {},
            },
          },
        }),
      );
      return;
    }
    const args = envelope.payload.args.request ?? {};
    let value: unknown = { accepted: true };
    if (envelope.method === 'session/modelCatalog') {
      value = {
        default: { provider: 'synthetic', model: 'synthetic' },
        routableProviders: ['synthetic'],
        groups: [],
        failures: [],
      };
    } else if (envelope.method === 'session/create') {
      const id = `synthetic-session-${String(++serial)}`;
      sessions.set(id, { id, events: [], turn: 0 });
      value = { sessionId: id };
    } else if (envelope.method === 'session/fork') {
      const parent = sessions.get(String(args['sessionId']));
      const id = `synthetic-session-${String(++serial)}`;
      if (parent === undefined)
        throw new Error('Missing synthetic fork parent.');
      const end = parent.events.findLastIndex(
        (event) => event.type === 'turn/end',
      );
      if (end < 0) {
        response.end(
          JSON.stringify({
            type: 'server-response',
            rpcId: envelope.rpcId,
            result: {
              ok: false,
              error: {
                code: 'session/fork-unavailable',
                message: 'synthetic',
                details: {},
              },
            },
          }),
        );
        return;
      }
      const events = structuredClone(parent.events.slice(0, end + 1));
      events.push({
        type: 'session/end-seed',
        seq: events.length,
        time: 0,
        data: { inherited: true },
      });
      sessions.set(id, { id, parent: parent.id, events, turn: parent.turn });
      value = { sessionId: id };
    } else if (envelope.method === 'session/prompt') {
      const session = sessions.get(String(args['sessionId']));
      if (session === undefined)
        throw new Error('Missing synthetic prompt session.');
      session.turn++;
      const records = JSON.parse(
        JSON.stringify(template)
          .replaceAll('synthetic-request', String(args['requestId']))
          .replaceAll(
            'synthetic-user',
            `synthetic-user-${String(session.turn)}`,
          ),
      ) as Event[];
      for (const event of records) {
        if (mode === 'hold-before-turn' && event.type === 'turn/start') break;
        if (mode === 'hold-pre-step' && event.type === 'step/start') break;
        event.seq = session.events.length;
        if ('turn' in event.data) event.data['turn'] = session.turn;
        const holdForConformance = JSON.stringify(args['content']).includes(
          'connection abort input',
        );
        if (
          (mode === 'hold' || holdForConformance) &&
          event.type === 'assistant/message'
        )
          break;
        publish(session, event);
        if (mode === 'runtime-context' && event.type === 'user/message') {
          publish(session, {
            type: 'user/message',
            seq: session.events.length,
            time: 0,
            data: {
              id: 'synthetic-context',
              role: 'user',
              content: [{ type: 'text', text: 'synthetic runtime context' }],
              source: {
                kind: 'plugin',
                plugin: '@deepseek-ai/dsh-system-prompt',
                form: 'snapshot',
                sections: [],
              },
            },
          });
        }
      }
    } else if (envelope.method === 'session/cancel') {
      const session = sessions.get(String(args['sessionId']));
      if (
        session !== undefined &&
        mode !== 'hold-before-turn' &&
        ['request/header', 'agent/inbox/spliced'].includes(
          session.events.at(-1)?.type ?? '',
        )
      ) {
        if (mode !== 'hold-pre-step')
          publish(session, {
            type: 'step/end',
            seq: session.events.length,
            time: 0,
            data: { turn: session.turn, step: 1 },
          });
        publish(session, {
          type: 'turn/end',
          seq: session.events.length,
          time: 0,
          data: {
            turn: session.turn,
            reason: { kind: 'aborted', reason: { kind: 'user' } },
          },
        });
      }
    }
    value = await transformResponse(envelope.method, value);
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        type: 'server-response',
        rpcId: envelope.rpcId,
        result: { ok: true, value },
      }),
    );
  }
  const sockets = new WebSocketServer({ server, path: '/api/remote.mux' });
  sockets.on('connection', (socket) => {
    const streams = new Map<string, string>();
    subscriptions.set(socket, streams);
    socket.on('close', () => {
      subscriptions.delete(socket);
    });
    socket.on('message', (data) => {
      if (!Buffer.isBuffer(data))
        throw new Error('Expected synthetic text frame.');
      const frame = JSON.parse(data.toString()) as {
        type: string;
        streamId: string;
        payload?: { args: { request: { address: { sessionId: string } } } };
      };
      if (frame.type === 'cancel') {
        streams.delete(frame.streamId);
        return;
      }
      const id = frame.payload?.args.request.address.sessionId ?? '';
      const session = sessions.get(id);
      if (session === undefined) {
        socket.send(
          JSON.stringify({
            type: 'error',
            streamId: frame.streamId,
            error: {
              code: 'session/not-found',
              message: 'synthetic',
              details: {},
            },
          }),
        );
        return;
      }
      streams.set(frame.streamId, id);
      socket.send(
        JSON.stringify({
          type: 'item',
          streamId: frame.streamId,
          value: transformFrame({
            type: 'snapshot',
            header: {
              id,
              version: 2,
              createdAt: 0,
              cwd: '/synthetic',
              isSeeded: session.parent !== undefined,
              ...(session.parent === undefined
                ? {}
                : { parentSession: session.parent }),
            },
            cursor: session.events.length - 1,
            records: session.events.map((event) => ({ type: 'event', event })),
            hasMore: false,
            projections: { asOfSeq: session.events.length - 1, values: {} },
          }),
        }),
      );
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Missing synthetic address.');
  return {
    profile: {
      providerId: DSH_PROVIDER_ID,
      profileId: profileId('dsh-gateway-synthetic'),
      displayName: 'Synthetic Gateway',
      connection: {
        kind: 'endpoint',
        url: `http://127.0.0.1:${String(address.port)}`,
        ownership: 'external',
        transport: 'websocket',
        authRef: { scheme: 'synthetic', id: 'cookie' },
      },
      providerOptions: {
        protocol: DSH_GATEWAY_PROTOCOL,
        storeId: 'synthetic-store',
        exclusiveSessions: true,
        requestTimeoutMs: 500,
        runTimeoutMs: 1000,
      },
    },
    sessions,
    methods,
    setResponse: (handler) => {
      transformResponse = handler;
    },
    setFrame: (handler) => {
      transformFrame = handler;
    },
    emit: (id, type, data = {}) => {
      const session = sessions.get(id);
      if (session === undefined) throw new Error('Missing synthetic Session.');
      publish(session, { type, data, seq: session.events.length, time: 0 });
    },
    setMode: (next) => {
      mode = next;
    },
    disconnect: () => {
      for (const socket of sockets.clients) socket.terminate();
    },
    close: async () => {
      for (const socket of sockets.clients) socket.terminate();
      await new Promise<void>((resolve) => {
        sockets.close(() => {
          resolve();
        });
      });
      server.closeAllConnections();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
    },
  };
}
