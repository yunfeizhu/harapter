import { createRequire } from 'node:module';
import {
  globSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rewriteDeclarationImports } from './lib/declaration-imports.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = resolve(repositoryRoot, 'packages/harapter');
const require = createRequire(resolve(packageRoot, 'package.json'));
const { rolldown } = await import(require.resolve('rolldown'));
const modules = JSON.parse(
  readFileSync(
    resolve(repositoryRoot, 'scripts/harapter-modules.json'),
    'utf8',
  ),
).modules;
const outputDirectory = resolve(packageRoot, 'dist');
// Only this package's generated output is replaced; source modules remain independent.
rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });
const declarations = new Map(
  modules.map((entry) => [
    entry.name,
    resolve(
      outputDirectory,
      'internal',
      entry.name.split('/')[1],
      'index.d.ts',
    ),
  ]),
);
declarations.set(
  '@harapter/conformance/fake',
  resolve(outputDirectory, 'internal/conformance/fake-provider.d.ts'),
);
const input = { index: resolve(packageRoot, 'src/index.ts') };
for (const entry of modules) {
  const directory = resolve(repositoryRoot, entry.path, 'dist');
  const files = [...globSync('**/*.d.ts', { cwd: directory })];
  if (!files.includes('index.d.ts'))
    throw new Error(
      `${entry.path} declarations are missing; build its workspace first.`,
    );
  for (const file of files) {
    const target = resolve(
      outputDirectory,
      'internal',
      entry.name.split('/')[1],
      file,
    );
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      rewriteDeclarationImports(
        readFileSync(resolve(directory, file), 'utf8'),
        target,
        declarations,
      ),
    );
  }
  if (entry.subpath !== '.') {
    const name = entry.subpath.slice(2);
    input[name] = resolve(repositoryRoot, entry.path, 'src/index.ts');
    const target = resolve(outputDirectory, `${name}.d.ts`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      rewriteDeclarationImports(
        `export * from '${entry.name}';\n`,
        target,
        declarations,
      ),
    );
  }
}
input.testing = resolve(
  repositoryRoot,
  'packages/conformance/src/fake-provider.ts',
);
const testingDeclaration = resolve(outputDirectory, 'testing.d.ts');
writeFileSync(
  testingDeclaration,
  rewriteDeclarationImports(
    "export * from '@harapter/conformance/fake';\n",
    testingDeclaration,
    declarations,
  ),
);
const mainDeclaration = resolve(outputDirectory, 'index.d.ts');
writeFileSync(
  mainDeclaration,
  rewriteDeclarationImports(
    readFileSync(resolve(packageRoot, 'build/index.d.ts'), 'utf8'),
    mainDeclaration,
    declarations,
  ),
);
const bundle = await rolldown({
  cwd: packageRoot,
  input,
  platform: 'node',
  tsconfig: resolve(repositoryRoot, 'tsconfig.json'),
  external: ['ws', 'vitest'],
  onwarn(warning) {
    throw new Error(`Harapter bundle warning: ${warning.code}`);
  },
});
try {
  await bundle.write({
    dir: outputDirectory,
    format: 'esm',
    entryFileNames: '[name].js',
    chunkFileNames: 'chunks/[name]-[hash].js',
    sourcemap: false,
  });
} finally {
  await bundle.close();
}
