import { HttpSseTransport } from 'harapter/transports/http-sse';

// Inject Fetch for an offline application test; no HTTP request leaves this process.
const transport = new HttpSseTransport({
  baseUrl: 'https://example.invalid/',
  fetch: (_input, init) =>
    Promise.resolve(
      init?.method === 'POST'
        ? new Response('{"accepted":true}', { status: 200 })
        : new Response('event: ready\ndata: {}\n\n', {
            headers: { 'content-type': 'text/event-stream' },
          }),
    ),
});
try {
  const response = await transport.request('task', {
    method: 'POST',
    body: '{}',
  });
  if (response.status !== 200)
    throw new Error('Unexpected synthetic response.');
  let count = 0;
  for await (const _event of transport.subscribe('events')) {
    count += 1;
    break; // This example needs one event; an unexpected remote EOF is an error.
  }
  console.log({ httpStatus: response.status, eventsReceived: count });
} finally {
  await transport.close();
}
