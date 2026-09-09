import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Missing, stale or non-copyable entry snippets are publication failures. */
export function validateSdkSnippet(markdown, sources) {
  const snippets = [
    ...markdown.matchAll(
      /<!-- sdk-example: ([a-z-]+\.ts) -->\s*```ts\n([\s\S]*?)\n```/gu,
    ),
  ];
  return (
    snippets.length > 0 &&
    snippets.every(([, name, code]) => sources[name]?.trim() === code.trim())
  );
}

/** Compile and execute copyable application sources against installed public tarballs. */
export function checkSdkApplication(repositoryRoot, consumerRoot) {
  const source = resolve(repositoryRoot, 'examples/sdk-application/src');
  const directory = resolve(consumerRoot, 'sdk-application');
  mkdirSync(directory);
  const files = readdirSync(source)
    .filter((name) => name.endsWith('.ts'))
    .sort();
  const sources = Object.fromEntries(
    files.map((file) => [file, readFileSync(join(source, file), 'utf8')]),
  );
  sources['quick-unified.ts'] = readFileSync(
    resolve(repositoryRoot, 'examples/runtime-profiles/src/quick-unified.ts'),
    'utf8',
  );
  files.push('quick-unified.ts');
  const policy = JSON.parse(
    readFileSync(
      resolve(repositoryRoot, 'scripts/public-packages.json'),
      'utf8',
    ),
  );
  const modules = JSON.parse(
    readFileSync(
      resolve(repositoryRoot, 'scripts/harapter-modules.json'),
      'utf8',
    ),
  ).modules;
  for (const root of [
    '',
    ...policy.packages.map((entry) => entry.path),
    ...modules.map((entry) => entry.path),
  ]) {
    for (const suffix of ['', '.zh-CN', '.ja']) {
      const path = join(root, `README${suffix}.md`);
      if (
        !validateSdkSnippet(
          readFileSync(resolve(repositoryRoot, path), 'utf8'),
          sources,
        )
      )
        throw new Error(
          `${path}: SDK entry snippet is missing or differs from its executable source.`,
        );
    }
  }
  for (const file of files) writeFileSync(join(directory, file), sources[file]);
  if (
    readFileSync(join(source, 'interactions.ts'), 'utf8') !==
    readFileSync(
      resolve(
        repositoryRoot,
        'examples/multi-provider-client/src/interactions.ts',
      ),
      'utf8',
    )
  )
    throw new Error(
      'The copyable interaction observer must match the maintained reference observer.',
    );
  check(
    process.execPath,
    [
      resolve(repositoryRoot, 'node_modules/typescript/bin/tsc'),
      '--strict',
      '--exactOptionalPropertyTypes',
      '--skipLibCheck',
      '--target',
      'ES2024',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--types',
      'node',
      '--typeRoots',
      resolve(repositoryRoot, 'node_modules/@types'),
      '--outDir',
      'dist',
      ...files,
    ],
    0,
    undefined,
  );
  check(
    process.execPath,
    ['dist/offline.js'],
    0,
    'offline application passed\n',
  );
  check(process.execPath, ['dist/main.js'], 1, '');
  check(process.execPath, ['dist/quick-unified.js'], 1, '');
  check(process.execPath, ['dist/session-main.js'], 1, '');
  check(process.execPath, ['dist/multi-main.js'], 1, '');
  check(
    process.execPath,
    ['dist/approval-demo.js'],
    1,
    '',
    '{"error":"provider_error"}\n',
  );
  check(
    process.execPath,
    ['dist/cancel-demo.js'],
    0,
    '{"cancellation":"cancelled","timeout":"connection_aborted"}\n',
  );
  for (const name of [
    'transport-jsonrpc-stdio',
    'transport-jsonl-process',
    'transport-http-sse',
    'transport-acp',
    'test-with-fake',
  ])
    check(process.execPath, [`dist/${name}.js`], 0, undefined);

  function check(
    command,
    args,
    status,
    stdout,
    stderr = status === 1 ? '{"error":"application_failed"}\n' : '',
  ) {
    const result = spawnSync(command, args, {
      cwd: directory,
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      env: {
        PATH: process.env.PATH ?? '',
        SYSTEMROOT: process.env.SYSTEMROOT ?? '',
      },
    });
    if (
      result.error ||
      result.status !== status ||
      (stdout !== undefined && result.stdout !== stdout) ||
      result.stderr !== stderr
    )
      throw new Error(
        `Standalone SDK application check failed for ${args.at(-1)} (expected exit ${status}, received ${result.status}).`,
      );
  }
}
