import { PassThrough } from 'node:stream';
import { JsonRpcStdioTransport } from '@harapter/transport-jsonrpc-stdio';

// A deterministic in-memory peer; no Runtime or process is involved.
const readable = new PassThrough();
const writable = new PassThrough();
writable.on('data', (frame: Buffer) => {
  const request = JSON.parse(frame.toString('utf8')) as { id: number };
  readable.write(
    JSON.stringify({ jsonrpc: '2.0', id: request.id, result: 'pong' }) + '\n',
  );
});
const transport = new JsonRpcStdioTransport({ readable, writable });
try {
  const reply = await transport.request('ping', {});
  if (reply !== 'pong') throw new Error('Unexpected synthetic response.');
  console.log({ responseReceived: true });
} finally {
  await transport.close();
  readable.destroy();
  writable.destroy();
}
