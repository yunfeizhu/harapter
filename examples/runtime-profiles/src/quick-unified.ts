import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createHarapter,
  providerId,
  profileId,
  HarnessError,
  isHarnessError,
  type HarnessEvent,
  type HarnessProfile,
  type HarnessRegistry,
  type HarnessSession,
  type CreateSessionInput,
} from 'harapter';

/** The same business function runs on every configured harness. */
export async function runTask(
  harapter: HarnessRegistry,
  profile: HarnessProfile,
  text: string,
  onEvent: (event: HarnessEvent) => void,
  sessionOptions: CreateSessionInput = {},
) {
  const client = await harapter.connect(profile);
  let session: HarnessSession | undefined;
  try {
    session = await client.createSession(sessionOptions);
    const run = await session.start(
      { parts: [{ type: 'text', text }] },
      { timeoutMs: 60_000 },
    );
    for await (const event of run.events()) {
      onEvent(event);
      if (event.type === 'interaction.requested')
        throw new HarnessError(
          'unsupported_capability',
          'This text example requires a non-interactive Runtime configuration.',
          { retryable: false },
        );
    }
    return { result: await run.result(), sessionRef: session.ref() };
  } finally {
    try {
      await client.close();
    } finally {
      await session?.close();
    }
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in the application environment.`);
  return value;
}

/** Only connection configuration differs; Runtime preparation belongs to the host. */
function selectedProfile(): HarnessProfile {
  const workspace = required('HARAPTER_WORKSPACE');
  if (!isAbsolute(workspace))
    throw new Error('Choose an absolute Workspace path.');
  const profiles = {
    dsh: (): HarnessProfile => ({
      profileId: profileId('local-dsh'),
      providerId: providerId('deepseek.harness'),
      displayName: 'Local DSH',
      connection: {
        kind: 'process',
        ownership: 'adapter',
        cwd: workspace,
        command: required('HARAPTER_DSH_COMMAND'),
        args: [
          '--profile',
          'sdk-minimal',
          '--patch',
          required('HARAPTER_DSH_PATCH'),
        ],
      },
      providerOptions: {
        provider: required('HARAPTER_DSH_PROVIDER'),
        model: required('HARAPTER_DSH_MODEL'),
      },
    }),
    opencode: (): HarnessProfile => ({
      profileId: profileId('local-opencode'),
      providerId: providerId('opencode'),
      displayName: 'Local OpenCode',
      connection: {
        kind: 'endpoint',
        ownership: 'external',
        transport: 'http',
        url: required('HARAPTER_OPENCODE_URL'),
        authRef: { scheme: 'env', id: 'opencode' },
      },
    }),
  };
  const name = required('HARAPTER_HARNESS');
  if (name !== 'dsh' && name !== 'opencode')
    throw new Error('Select dsh or opencode.');
  return profiles[name]();
}

async function main() {
  const harapter = await createHarapter({
    harnesses: ['dsh', 'opencode'],
    resolveAuthHeaders: (ref) => {
      if (ref.scheme !== 'env' || ref.id !== 'opencode')
        throw new Error('Unknown authentication reference.');
      return {
        authorization:
          'Basic ' +
          Buffer.from(
            (process.env['OPENCODE_SERVER_USERNAME'] ?? 'opencode') +
              ':' +
              required('OPENCODE_SERVER_PASSWORD'),
          ).toString('base64'),
      };
    },
  });
  const { result } = await runTask(
    harapter,
    selectedProfile(),
    'Reply with exactly HARAPTER_OK. Do not use tools or inspect files.',
    (event) => {
      console.log({ type: event.type, sequence: event.sequence });
    },
    { workspace: { uri: pathToFileURL(required('HARAPTER_WORKSPACE')).href } },
  );
  // Return result.finalMessage to an authorized application UI; log metadata only.
  console.log({
    status: result.status,
    hasText: result.finalMessage !== undefined,
  });
  if (result.status !== 'completed') process.exitCode = 1;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  void main().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        error: isHarnessError(error) ? error.code : 'application_failed',
      }),
    );
    process.exitCode = 1;
  });
}
