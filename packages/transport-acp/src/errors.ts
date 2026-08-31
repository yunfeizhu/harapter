import { inspect } from 'node:util';

/** Stable, content-free ACP client failure categories. */
export type AcpClientErrorCode =
  | 'already_initialized'
  | 'capability_not_advertised'
  | 'client_closed'
  | 'event_capacity_exceeded'
  | 'invalid_configuration'
  | 'invalid_message'
  | 'invalid_params'
  | 'not_initialized'
  | 'unsupported_protocol_version';

/** Safe ACP protocol error that never captures peer payloads. */
export class AcpClientError extends Error {
  readonly code: AcpClientErrorCode;

  constructor(code: AcpClientErrorCode, message: string) {
    super(message);
    Object.defineProperty(this, 'name', { value: 'AcpClientError' });
    this.code = code;
  }

  /** Keep generic JSON logging bounded and content-free. */
  toJSON(): Readonly<{
    message: string;
    name: string;
    code: AcpClientErrorCode;
  }> {
    return { message: this.message, name: this.name, code: this.code };
  }

  /** Keep Node inspection bounded and content-free. */
  [inspect.custom](): string {
    return `${this.name} [${this.code}]: ${this.message}`;
  }
}

export function acpError(
  code: AcpClientErrorCode,
  message: string,
): AcpClientError {
  return new AcpClientError(code, message);
}
