import { globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const sourcePatterns = ['packages/*/src', 'providers/*/src'].flatMap((root) =>
  ['cts', 'mts', 'ts', 'tsx'].map((extension) => `${root}/**/*.${extension}`),
);
const hasExecutableSource = sourcePatterns.some((pattern) =>
  globSync(pattern, { cwd: import.meta.dirname }).some(
    (path) => !path.endsWith('.d.ts'),
  ),
);

export default defineConfig({
  resolve: {
    alias: {
      '@harapter/adapter-codex': fileURLToPath(
        new URL('./providers/codex/src/index.ts', import.meta.url),
      ),
      '@harapter/adapter-opencode': fileURLToPath(
        new URL('./providers/opencode/src/index.ts', import.meta.url),
      ),
      '@harapter/transport-acp': fileURLToPath(
        new URL('./packages/transport-acp/src/index.ts', import.meta.url),
      ),
      '@harapter/conformance': fileURLToPath(
        new URL('./packages/conformance/src/index.ts', import.meta.url),
      ),
      '@harapter/core': fileURLToPath(
        new URL('./packages/core/src/index.ts', import.meta.url),
      ),
      '@harapter/transport-http-sse': fileURLToPath(
        new URL('./packages/transport-http-sse/src/index.ts', import.meta.url),
      ),
      '@harapter/transport-jsonl-process': fileURLToPath(
        new URL(
          './packages/transport-jsonl-process/src/index.ts',
          import.meta.url,
        ),
      ),
      '@harapter/transport-jsonrpc-stdio': fileURLToPath(
        new URL(
          './packages/transport-jsonrpc-stdio/src/index.ts',
          import.meta.url,
        ),
      ),
    },
  },
  test: {
    clearMocks: true,
    coverage: {
      exclude: [
        '**/*.d.ts',
        '**/*.{spec,test}.ts',
        '**/test/**',
        '**/tests/**',
      ],
      include: sourcePatterns,
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      thresholds: {
        branches: 85,
        functions: 90,
        lines: 90,
        perFile: true,
        statements: 90,
      },
    },
    environment: 'node',
    hookTimeout: 10_000,
    include: [
      'packages/**/*.{spec,test}.ts',
      'providers/**/*.{spec,test}.ts',
      'tests/**/*.{spec,test}.ts',
    ],
    passWithNoTests: !hasExecutableSource,
    pool: 'forks',
    restoreMocks: true,
    testTimeout: 10_000,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
