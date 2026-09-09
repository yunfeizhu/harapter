import { pathToFileURL } from 'node:url';
import { HarnessRegistry, profileId } from 'harapter';
import { CODEX_PROVIDER_ID, createCodexProviderFactory } from 'harapter/codex';

/** Runtime installation, sign-in and Workspace selection belong to the application. */
export async function connectCodex(command: string, workspace: string) {
  const registry = new HarnessRegistry();
  registry.register(createCodexProviderFactory());
  const client = await registry.connect({
    profileId: profileId('my-codex'),
    providerId: CODEX_PROVIDER_ID,
    displayName: 'Application Codex',
    connection: {
      kind: 'process',
      command,
      args: ['app-server', '--stdio'],
      cwd: workspace,
      ownership: 'adapter',
    },
    requiredCapabilities: [{ name: 'input.text' }, { name: 'run.stream' }],
  });
  return {
    client,
    session: {
      workspace: { uri: pathToFileURL(workspace).href },
      providerOptions: {
        approvalPolicy: 'never',
        sandbox: 'read-only',
        ephemeral: false,
      },
    },
  };
}
