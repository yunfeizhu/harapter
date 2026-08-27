import eslint from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import nodeImport from 'eslint-plugin-node-import';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const codeFiles = ['**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}'];
const testFiles = [
  '**/*.{spec,test}.{cts,mts,ts,tsx}',
  '**/test/**/*.{cts,mts,ts,tsx}',
  '**/tests/**/*.{cts,mts,ts,tsx}',
];
const typeScriptFiles = ['**/*.{cts,mts,ts,tsx}'];

export default defineConfig([
  {
    ignores: [
      '**/.cache/**',
      '**/build/**',
      '**/coverage/**',
      '**/dist/**',
      '**/node_modules/**',
    ],
  },
  {
    ...eslint.configs.recommended,
    files: codeFiles,
    languageOptions: {
      ...eslint.configs.recommended.languageOptions,
      ecmaVersion: 'latest',
      globals: globals.node,
      sourceType: 'module',
    },
  },
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: typeScriptFiles,
  })),
  ...tseslint.configs.stylisticTypeChecked.map((config) => ({
    ...config,
    files: typeScriptFiles,
  })),
  {
    files: codeFiles,
    plugins: {
      'node-import': nodeImport,
    },
    rules: {
      'node-import/prefer-node-protocol': 'error',
    },
  },
  {
    files: typeScriptFiles,
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: false },
      ],
    },
  },
  {
    files: testFiles,
    plugins: {
      vitest,
    },
    rules: {
      ...vitest.configs.recommended.rules,
      'vitest/no-focused-tests': 'error',
    },
  },
  eslintConfigPrettier,
]);
