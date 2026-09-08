import { createInterface } from 'node:readline/promises';
import { runInteractionDemo } from './interaction-demo.js';

const kind = process.argv[2] ?? 'approval';
if (
  process.argv.length > 3 ||
  (kind !== 'approval' && kind !== 'user_input' && kind !== 'provider')
) {
  process.stderr.write(
    'Usage: node dist/interaction-main.js [approval|user_input|provider]\n',
  );
  process.exitCode = 1;
} else {
  try {
    await runInteractionDemo({
      kind,
      write: (status) => {
        process.stdout.write(`${status}\n`);
      },
      answer: async (question, signal) => {
        const reader = createInterface({
          input: process.stdin,
          output: process.stderr,
        });
        const closed = new AbortController();
        const onClose = () => {
          closed.abort();
        };
        reader.once('close', onClose);
        try {
          return await reader.question(question, {
            signal: AbortSignal.any([signal, closed.signal]),
          });
        } finally {
          reader.off('close', onClose);
          reader.close();
        }
      },
    });
  } catch {
    process.stderr.write(
      'Interaction demo failed. Supply an explicit supported answer.\n',
    );
    process.exitCode = 1;
  }
}
