import { PassThrough } from 'node:stream';
import { AcpClient } from '@harapter/transport-acp';

const readable = new PassThrough();
const writable = new PassThrough();
// This synthetic peer implements only the initialization used in this example.
writable.on('data', (frame: Buffer) => {
  const request = JSON.parse(frame.toString('utf8')) as { id: number };
  readable.write(
    JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] },
    }) + '\n',
  );
});
const client = new AcpClient({ readable, writable });
try {
  const initialized = await client.initialize({
    clientInfo: { name: 'harapter-application-test', version: '1.0.0' },
  });
  console.log({ protocolVersion: initialized.protocolVersion });
} finally {
  await client.close();
  readable.destroy();
  writable.destroy();
}
