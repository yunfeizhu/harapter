import { run, isHarnessError } from 'harapter';

try {
  const result = await run({ harness: 'pi', input: 'Hello!' });
  // Return result.finalMessage to your application's caller.
  console.log({ status: result.status });
  if (result.status !== 'completed') process.exitCode = 1;
} catch (error) {
  console.error({
    error: isHarnessError(error) ? error.code : 'application_failed',
  });
  process.exitCode = 1;
}
