/** Public subset of the official Pi 0.85.1 AgentSession; no Runtime dependency is loaded. */
export interface PiSdkSession {
  readonly sessionId: string;
  readonly isStreaming: boolean;
  subscribe(listener: (event: unknown) => void): () => void;
  prompt(
    text: string,
    options?: { expandPromptTemplates?: boolean },
  ): Promise<void>;
  abort(): Promise<void>;
  dispose(): void;
}

/** Creates a fresh idle session and transfers its exclusive ownership to Harapter.
 * The host owns ModelRuntime, tools, credentials, extensions and factory resources.
 * Respect signal where possible; a late Session is disposed even if the host ignores it.
 */
export type PiSdkSessionFactory = (options: {
  readonly signal: AbortSignal;
}) => Promise<PiSdkSession>;

/** SDK Profile providerOptions. Only the declared, tested exact SDK version is accepted. */
export interface PiSdkProfileOptions {
  readonly sdkVersion: '0.85.1';
  readonly operationTimeoutMs?: number;
  readonly maxRunEvents?: number;
}
