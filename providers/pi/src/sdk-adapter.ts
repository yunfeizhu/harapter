import {
  ExtensionRegistry,
  assertSessionOwnership,
  providerSessionId,
  type CapabilityManifest,
  type CapabilityStatus,
  type CreateSessionInput,
  type HarnessClient,
  type HarnessProfile,
  type HarnessSession,
  type RunOptions,
  type SessionRef,
} from '@harapter/core';
import { PI_PROVIDER_ID, preparePiPrompt } from './protocol.js';
import { PiSdkRun } from './sdk-run.js';
import { sdkDeadline, sdkError, sdkInteger, sdkRecord } from './sdk-utils.js';
import type { PiSdkSession, PiSdkSessionFactory } from './sdk-types.js';

const claimed = new WeakSet<object>();

/** Adapt a host factory using the pinned public AgentSession interface. */
export function connectPiSdk(profile: HarnessProfile): HarnessClient {
  const connection = profile.connection;
  const options = sdkRecord(profile.providerOptions);
  if (
    profile.providerId !== PI_PROVIDER_ID ||
    connection.kind !== 'sdk' ||
    connection.ownership !== 'adapter' ||
    connection.client !== undefined ||
    typeof connection.factory !== 'function' ||
    options?.['sdkVersion'] !== '0.85.1' ||
    Object.keys(options).some(
      (key) =>
        !['sdkVersion', 'operationTimeoutMs', 'maxRunEvents'].includes(key),
    )
  )
    throw sdkError('profile_invalid');
  const create = connection.factory as PiSdkSessionFactory;
  const timeout = sdkInteger(options['operationTimeoutMs'], 30_000);
  const capacity = sdkInteger(options['maxRunEvents'], 128, 2, 4096);
  const id = profile.profileId;
  const sessions = new Set<HarnessSession>();
  const openings = new Set<AbortController>();
  const ids = new Set<string>();
  let closed = false;
  const capabilities = (): CapabilityManifest => ({
    providerId: PI_PROVIDER_ID,
    profileId: id,
    observedAt: new Date().toISOString(),
    capabilities: Object.fromEntries(
      ['session.create', 'run.stream', 'run.cancel', 'input.text']
        .map((name): [string, CapabilityStatus] => [
          name,
          { mode: 'native', source: 'version_profile' },
        ])
        .concat(
          [
            'session.resume',
            'session.fork',
            'interaction.respond',
            'native.client',
          ].map((name): [string, CapabilityStatus] => [
            name,
            { mode: 'unsupported', source: 'version_profile' },
          ]),
        ),
    ),
  });
  const assertOpen = () => {
    if (closed) throw sdkError('connection_aborted');
  };
  const client: HarnessClient = {
    descriptor: () =>
      Promise.resolve({
        providerId: PI_PROVIDER_ID,
        profileId: id,
        displayName: 'Pi Agent',
        connectionKind: 'sdk',
        compatibility: 'supported',
        runtime: {
          name: 'Pi Agent',
          version: '0.85.1',
          protocol: 'embedded-sdk',
        },
      }),
    capabilities: () => Promise.resolve(capabilities()),
    async createSession(input: CreateSessionInput = {}) {
      assertOpen();
      if (Object.keys(input).length !== 0)
        throw sdkError('unsupported_capability');
      if (sessions.size + openings.size >= 16) throw sdkError('run_conflict');
      const controller = new AbortController();
      openings.add(controller);
      // The factory, unlike its produced Session, remains owned by the host.
      const work = Promise.resolve()
        .then(() => {
          if (controller.signal.aborted) throw sdkError('connection_aborted');
          return create({ signal: controller.signal });
        })
        .then((native) => {
          const raw = sdkRecord(native);
          if (
            raw === undefined ||
            !['prompt', 'subscribe', 'abort', 'dispose'].every(
              (key) => typeof raw[key] === 'function',
            )
          )
            throw sdkError('provider_api_incompatible');
          if (claimed.has(native)) throw sdkError('session_provider_mismatch');
          claimed.add(native);
          if (controller.signal.aborted) {
            native.dispose();
            throw sdkError('connection_aborted');
          }
          try {
            if (
              typeof native.sessionId !== 'string' ||
              native.sessionId.length === 0 ||
              native.sessionId.length > 512 ||
              typeof native.isStreaming !== 'boolean' ||
              native.isStreaming ||
              ids.has(native.sessionId)
            )
              throw sdkError('provider_api_incompatible');
            ids.add(native.sessionId);
            const reference: SessionRef = {
              providerId: PI_PROVIDER_ID,
              profileId: id,
              providerSessionId: providerSessionId(native.sessionId),
              compatibilityRef: 'pi-agent;sdk=0.85.1;exclusive-factory',
            };
            const session = ownSession(
              native,
              reference,
              capabilities,
              timeout,
              capacity,
              () => {
                sessions.delete(session);
              },
            );
            sessions.add(session);
            return session;
          } catch {
            native.dispose();
            throw sdkError('provider_api_incompatible');
          }
        });
      try {
        return await sdkDeadline(work, timeout, controller.signal);
      } catch (error) {
        // Only Harapter-owned diagnostics escape the host callback boundary.
        if (closed) throw sdkError('connection_aborted');
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'timeout'
        )
          throw sdkError('timeout');
        throw sdkError('provider_api_incompatible');
      } finally {
        controller.abort();
        openings.delete(controller);
      }
    },
    async resumeSession(ref) {
      await Promise.resolve();
      assertOpen();
      assertSessionOwnership(ref, PI_PROVIDER_ID, id);
      throw sdkError('unsupported_capability');
    },
    extensions: () => new ExtensionRegistry(PI_PROVIDER_ID),
    native: () => undefined,
    async close() {
      if (closed) return;
      closed = true;
      for (const controller of openings) controller.abort();
      const outcomes = await Promise.allSettled(
        [...sessions].map((session) => session.close()),
      );
      if (outcomes.some((outcome) => outcome.status === 'rejected'))
        throw sdkError('connection_failed');
    },
  };
  return client;
}

function ownSession(
  native: PiSdkSession,
  reference: SessionRef,
  capabilities: () => CapabilityManifest,
  timeout: number,
  capacity: number,
  release: () => void,
): HarnessSession {
  let closed = false;
  let active: PiSdkRun | undefined;
  const unsubscribe = native.subscribe((event) => {
    active?.receive(event);
  });
  if (typeof unsubscribe !== 'function')
    throw sdkError('provider_api_incompatible');
  const close = () => {
    if (closed) return;
    closed = true;
    active?.disconnect();
    release();
    try {
      unsubscribe();
    } finally {
      native.dispose();
    }
  };
  return {
    ref: () => ({ ...reference }),
    capabilities: () => Promise.resolve(capabilities()),
    start(input, options: RunOptions = {}) {
      return Promise.resolve().then(() => {
        if (closed) throw sdkError('connection_aborted');
        if (native.sessionId !== reference.providerSessionId)
          throw sdkError('session_provider_mismatch');
        if (active !== undefined || native.isStreaming)
          throw sdkError('run_conflict');
        if (Object.keys(options).some((key) => key !== 'timeoutMs'))
          throw sdkError('unsupported_capability');
        const text = preparePiPrompt(input);
        const deadline = sdkInteger(options.timeoutMs, timeout);
        const run = new PiSdkRun(
          reference,
          native,
          capacity,
          deadline,
          timeout,
          () => {
            active = undefined;
          },
          () => {
            try {
              close();
            } catch {
              /* The Run already reports a safe connection failure. */
            }
          },
        );
        active = run;
        run.start(text);
        return run;
      });
    },
    respond: () => Promise.reject(sdkError('unsupported_capability')),
    close() {
      return Promise.resolve().then(() => {
        try {
          close();
        } catch {
          throw sdkError('connection_failed');
        }
      });
    },
  };
}
