import type {
  CancelResult,
  HarnessEvent,
  HarnessRun,
  RunRef,
  RunResult,
} from '@harapter/core';
import type { MappedDshEvent } from './protocol.js';
import { GatewayQueue } from './gateway-queue.js';
import { gatewayError } from './gateway-transport.js';

/** One client-owned Run, with admission and durable terminal authority separated. */
export class DshGatewayRun implements HarnessRun {
  private readonly queue: GatewayQueue<HarnessEvent>;
  private readonly settlement: Promise<RunResult>;
  private resolve!: (result: RunResult) => void;
  private accepted = false;
  private candidate: RunResult | undefined;
  private final: RunResult | undefined;
  private sequence = 0;
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly reference: RunRef,
    maxEvents: number,
    timeoutMs: number,
    private readonly abort: (reason: string) => void,
    private readonly settled: () => void,
  ) {
    this.queue = new GatewayQueue(maxEvents);
    this.settlement = new Promise((resolve) => {
      this.resolve = resolve;
    });
    this.timer = setTimeout(() => {
      this.abort('run_timeout');
    }, timeoutMs);
    this.receive([{ type: 'run.started', data: {} }]);
  }

  ref(): RunRef {
    return { ...this.reference };
  }
  events(): AsyncIterable<HarnessEvent> {
    return this.queue.iterate();
  }
  async result(): Promise<RunResult> {
    return structuredClone(await this.settlement);
  }
  cancel(): Promise<CancelResult> {
    if (this.final !== undefined)
      return Promise.resolve({ mode: 'already_terminal' });
    return Promise.reject(
      gatewayError('unsupported_capability', 'run_cancel_unavailable'),
    );
  }
  isTerminal(): boolean {
    return this.final !== undefined;
  }

  acknowledge(): void {
    this.accepted = true;
    if (this.candidate !== undefined) this.finish(this.candidate);
  }

  receive(events: readonly MappedDshEvent[], terminal?: RunResult): void {
    if (this.final !== undefined) return;
    for (const event of events) {
      if (!this.queue.push(this.event(event))) {
        this.abort('run_event_capacity');
        return;
      }
    }
    if (terminal !== undefined) {
      this.candidate = terminal;
      if (this.accepted) this.finish(terminal);
    }
  }

  connectionAborted(reason: string): void {
    this.finish({ status: 'connection_aborted', providerResult: { reason } });
  }

  rejected(): void {
    this.finish({
      status: 'failed',
      providerResult: { reason: 'prompt_rejected' },
    });
  }

  private finish(result: RunResult): void {
    if (this.final !== undefined) return;
    this.final = structuredClone(result);
    clearTimeout(this.timer);
    const type = {
      completed: 'run.completed',
      cancelled: 'run.cancelled',
      failed: 'run.failed',
      connection_aborted: 'connection.aborted',
    } as const;
    this.queue.push(
      this.event({ type: type[result.status], data: structuredClone(result) }),
      true,
    );
    this.queue.end();
    this.settled();
    this.resolve(this.final);
  }

  private event(mapped: MappedDshEvent): HarnessEvent {
    const sequence = this.sequence++;
    return {
      id: `${this.reference.runId}:${String(sequence)}`,
      type: mapped.type,
      providerId: this.reference.providerId,
      profileId: this.reference.profileId,
      sessionId: this.reference.sessionId,
      runId: this.reference.runId,
      sequence,
      timestamp: new Date().toISOString(),
      data: structuredClone(mapped.data),
      ...(mapped.providerEventType === undefined
        ? {}
        : { providerEventType: mapped.providerEventType }),
      ...(mapped.raw === undefined ? {} : { raw: structuredClone(mapped.raw) }),
    };
  }
}
