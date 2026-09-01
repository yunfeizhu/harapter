import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CODEX_PROVIDER_ID,
  createCodexProviderFactory,
} from '@harapter/adapter-codex';
import {
  OPENCODE_PROVIDER_ID,
  createOpenCodeProviderFactory,
} from '@harapter/adapter-opencode';
import { HarnessError, profileId } from '@harapter/core';
import type { MultiProviderSetup } from './index.js';

/** Explicit host inputs for the Codex and OpenCode reference composition. */
export interface CodexOpenCodeSetupOptions {
  readonly codexCommand: string;
  readonly codexWorkspacePath: string;
  readonly openCodeEndpoint: string;
  readonly openCodeTools: Readonly<Record<string, false>>;
  readonly openCodeWorkspacePath: string;
}

/**
 * Construct two semantically different Provider setups without connecting,
 * probing, installing, or authenticating either runtime.
 *
 * @param options - Host-selected command, endpoint, and isolated Workspaces.
 * @returns Codex process and OpenCode endpoint setups for the portable client.
 */
export function createCodexOpenCodeSetups(
  options: CodexOpenCodeSetupOptions,
): readonly [MultiProviderSetup, MultiProviderSetup] {
  validateOptions(options);
  return [
    {
      factory: createCodexProviderFactory(),
      profile: {
        profileId: profileId('codex-reference'),
        providerId: CODEX_PROVIDER_ID,
        displayName: 'Codex reference runtime',
        connection: {
          kind: 'process',
          command: options.codexCommand,
          args: ['app-server', '--stdio'],
          cwd: options.codexWorkspacePath,
          ownership: 'adapter',
        },
        requiredCapabilities: [
          { name: 'input.text', acceptedModes: ['native'] },
          { name: 'run.stream', acceptedModes: ['native'] },
        ],
      },
      sessionInput: {
        workspace: { uri: pathToFileURL(options.codexWorkspacePath).href },
        providerOptions: {
          approvalPolicy: 'never',
          ephemeral: true,
          sandbox: 'read-only',
        },
      },
      runOptions: { timeoutMs: 60_000 },
    },
    {
      factory: createOpenCodeProviderFactory(),
      profile: {
        profileId: profileId('opencode-reference'),
        providerId: OPENCODE_PROVIDER_ID,
        displayName: 'OpenCode reference runtime',
        connection: {
          kind: 'endpoint',
          url: options.openCodeEndpoint,
          transport: 'http',
          ownership: 'external',
        },
        requiredCapabilities: [
          { name: 'input.text', acceptedModes: ['native'] },
          { name: 'run.stream', acceptedModes: ['native'] },
        ],
      },
      sessionInput: {
        workspace: { uri: pathToFileURL(options.openCodeWorkspacePath).href },
      },
      runOptions: {
        timeoutMs: 60_000,
        providerOptions: {
          tools: { ...options.openCodeTools },
        },
      },
    },
  ];
}

function validateOptions(options: CodexOpenCodeSetupOptions): void {
  if (options.codexCommand.trim().length === 0) {
    throw invalidSetup('Codex command must be non-empty.');
  }
  if (
    !isAbsolute(options.codexWorkspacePath) ||
    !isAbsolute(options.openCodeWorkspacePath)
  ) {
    throw invalidSetup('Reference Workspace paths must be absolute.');
  }
  let endpoint: URL;
  try {
    endpoint = new URL(options.openCodeEndpoint);
  } catch {
    throw invalidSetup('OpenCode endpoint must be an absolute URL.');
  }
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw invalidSetup('OpenCode endpoint must use HTTP or HTTPS.');
  }
  if (endpoint.username.length > 0 || endpoint.password.length > 0) {
    throw invalidSetup('OpenCode endpoint must not contain credentials.');
  }
  const toolEntries = Object.entries(
    options.openCodeTools as Readonly<Record<string, unknown>>,
  );
  if (toolEntries.length === 0) {
    throw invalidSetup('OpenCode disabled Tool map must be non-empty.');
  }
  if (toolEntries.some(([, enabled]) => enabled !== false)) {
    throw invalidSetup('Every OpenCode Tool map value must be false.');
  }
}

function invalidSetup(message: string): HarnessError {
  return new HarnessError('profile_invalid', message, { retryable: false });
}
