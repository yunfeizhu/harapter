import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

/** Exercise the built CLI against the freshly installed public tarballs. */
export function checkSessionWorkflowCommand(repositoryRoot, consumerRoot) {
  const directory = resolve(consumerRoot, 'session-workflow');
  mkdirSync(directory);
  for (const name of [
    'session-main',
    'session-providers',
    'session-workflow',
  ]) {
    const relative = `examples/multi-provider-client/dist/${name}.js`;
    const source = resolve(repositoryRoot, relative);
    if (!existsSync(source)) {
      throw new Error(
        `${relative} is missing; build the example before checking packages.`,
      );
    }
    writeFileSync(join(directory, `${name}.js`), readFileSync(source));
  }
  const entrypoint = join(directory, 'session-main.js');
  const usage =
    'Usage: node dist/session-main.js /absolute/trusted-config.mjs\n';
  const failure =
    'Session workflow failed. Check the trusted host configuration and runtime requirements.\n';

  check(
    [entrypoint, 'relative-config.mjs'],
    '',
    usage,
    'explicit configuration path',
  );

  const linked = resolve(consumerRoot, 'session-workflow-linked');
  symlinkSync(
    directory,
    linked,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  check(
    ['--preserve-symlinks-main', join(linked, 'session-main.js')],
    '',
    usage,
    'symlink entrypoint',
  );

  const privateConfig = join(directory, 'private-config.mjs');
  writeFileSync(
    privateConfig,
    'throw new Error("fictional-secret-that-must-not-leak");',
  );
  check(
    [entrypoint, privateConfig],
    '',
    failure,
    'configuration error redaction',
  );

  const cleanupConfig = join(directory, 'cleanup-config.mjs');
  writeFileSync(
    cleanupConfig,
    'export default {}; export function dispose() { process.stdout.write("host-cleanup-complete"); }',
  );
  check(
    [entrypoint, cleanupConfig],
    'host-cleanup-complete',
    failure,
    'host resource cleanup',
  );

  function check(args, expectedOutput, expectedError, label) {
    const result = spawnSync(process.execPath, args, {
      cwd: consumerRoot,
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    if (
      result.error !== undefined ||
      result.status !== 1 ||
      result.stdout !== expectedOutput ||
      result.stderr !== expectedError
    ) {
      // Diagnostics must not echo the deliberately sensitive fixture error.
      throw new Error(`Session workflow CLI ${label} check failed.`);
    }
  }
}
