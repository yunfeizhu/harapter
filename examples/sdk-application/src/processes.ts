import { HarnessRegistry, profileId } from '@harapter/core';
import {
  DSH_PROVIDER_ID,
  createDshProviderFactory,
} from '@harapter/adapter-dsh';
import {
  OPENCLAW_PROVIDER_ID,
  createOpenClawProviderFactory,
} from '@harapter/adapter-openclaw';
import { PI_PROVIDER_ID, createPiProviderFactory } from '@harapter/adapter-pi';

export async function connectDsh(
  command: string,
  args: readonly string[],
  workspace: string,
  provider: string,
  model: string,
) {
  const registry = new HarnessRegistry();
  registry.register(createDshProviderFactory());
  return registry.connect({
    providerId: DSH_PROVIDER_ID,
    profileId: profileId('my-dsh-sdk'),
    displayName: 'Application DSH SDK',
    connection: {
      kind: 'process',
      command,
      args,
      cwd: workspace,
      ownership: 'adapter',
    },
    providerOptions: { provider, model },
  });
}

export async function connectOpenClaw(command: string, workspace: string) {
  const registry = new HarnessRegistry();
  registry.register(createOpenClawProviderFactory());
  return registry.connect({
    providerId: OPENCLAW_PROVIDER_ID,
    profileId: profileId('my-openclaw'),
    displayName: 'Application OpenClaw',
    connection: {
      kind: 'process',
      command,
      args: ['acp', '--no-prefix-cwd'],
      cwd: workspace,
      ownership: 'adapter',
    },
  });
}

export async function connectPi(command: string, workspace: string) {
  const registry = new HarnessRegistry();
  registry.register(createPiProviderFactory());
  return registry.connect({
    providerId: PI_PROVIDER_ID,
    profileId: profileId('my-pi'),
    displayName: 'Application Pi',
    connection: {
      kind: 'process',
      command,
      args: ['--no-tools', '--no-context-files'],
      cwd: workspace,
      ownership: 'adapter',
    },
  });
}
