import { PassThrough } from 'node:stream';
import { JsonlProcessTransport } from 'harapter/transports/jsonl-process';

const readable = new PassThrough();
const writable = new PassThrough();
writable.resume();
const transport = new JsonlProcessTransport({ readable, writable });
try {
  const incoming = transport.incoming()[Symbol.asyncIterator]();
  const next = incoming.next();
  readable.write('{"type":"ready"}\n');
  const message = await next;
  if (message.done) throw new Error('Missing synthetic message.');
  await transport.send({ type: 'ping' });
  console.log({ messageReceived: true, localWriteCompleted: true });
} finally {
  await transport.close();
  readable.destroy();
  writable.destroy();
}
