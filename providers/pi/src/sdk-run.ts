import { randomUUID } from 'node:crypto';
import {
  runId,
  type CancelResult,
  type HarnessEvent,
  type HarnessRun,
  type RunRef,
  type RunResult,
  type SessionRef,
} from '@harapter/core';
import { EventQueue } from './event-queue.js';
import {
  mapPiRunEvent,
  parsePiAssistantOutcome,
  type MappedPiEvent,
  type PiAssistantOutcome,
} from './protocol.js';
import { sdkDeadline, sdkRecord } from './sdk-utils.js';
import type { PiSdkSession } from './sdk-types.js';

/** One SDK prompt; prompt settlement and the last assistant outcome jointly authorize completion. */
export class PiSdkRun implements HarnessRun {
  private readonly reference: RunRef;
  private readonly queue: EventQueue;
  private readonly settlement = Promise.withResolvers<RunResult>();
  private readonly timer: ReturnType<typeof setTimeout>;
  private final: RunResult | undefined;
  private last: PiAssistantOutcome | undefined;
  private sequence = 0;
  private acknowledged = false;
  private cancelRequested = false;
  private cancelConfirmed = false;
  private cancelling: Promise<CancelResult> | undefined;

  constructor(
    ref: SessionRef,
    private readonly native: PiSdkSession,
    capacity: number,
    timeout: number,
    private readonly cancelTimeout: number,
    private readonly release: () => void,
    private readonly closeOwner: () => void,
  ) {
    this.reference = {
      providerId: ref.providerId,
      profileId: ref.profileId,
      sessionId: ref.providerSessionId,
      runId: runId(randomUUID()),
    };
    this.queue = new EventQueue(capacity);
    this.timer = setTimeout(() => {
      this.disconnect();
      this.closeOwner();
    }, timeout);
    this.emit({ type: 'run.started', data: {} });
  }

  ref(): RunRef {
    return { ...this.reference };
  }
  events(): AsyncIterable<HarnessEvent> {
    return this.queue.iterable();
  }
  result(): Promise<RunResult> {
    return this.settlement.promise;
  }

  start(text: string): void {
    void Promise.resolve()
      .then(() => {
        if (this.final !== undefined) return;
        return this.native.prompt(text, { expandPromptTemplates: false });
      })
      .then(
        () => {
          this.acknowledged = true;
          this.complete();
        },
        () => {
          this.fail();
          this.closeOwner();
        },
      );
  }

  receive(value: unknown): void {
    if (this.final !== undefined) return;
    try {
      // SDK objects already exist in host memory. Reject oversized mapped frames before retaining them.
      const event = sdkRecord(value);
      if (event?.['type'] === 'message_end') {
        const outcome = parsePiAssistantOutcome(event['message']);
        if (outcome !== undefined) {
          if (outcome.text.length + outcome.reasoning.length > 262_144)
            throw new Error('bounded');
          this.last = outcome;
          if (outcome.text)
            this.emit({
              type: 'message.completed',
              data: { text: outcome.text },
            });
          if (outcome.reasoning)
            this.emit({
              type: 'reasoning.completed',
              data: { text: outcome.reasoning },
            });
          this.emit({ type: 'usage.updated', data: outcome.usage });
          return;
        }
      }
      for (const mapped of mapPiRunEvent(value)) this.emit(mapped);
    } catch {
      this.fail();
      this.closeOwner();
    }
  }

  cancel(): Promise<CancelResult> {
    if (this.final !== undefined)
      return Promise.resolve({ mode: 'already_terminal' });
    this.cancelling ??= this.cancelOnce();
    return this.cancelling;
  }

  disconnect(): void {
    this.finish({ status: 'connection_aborted' });
  }

  private async cancelOnce(): Promise<CancelResult> {
    this.cancelRequested = true;
    try {
      await sdkDeadline(
        Promise.resolve().then(() => this.native.abort()),
        this.cancelTimeout,
      );
      this.cancelConfirmed = true;
      this.complete();
      const result = await sdkDeadline(this.result(), this.cancelTimeout);
      if (result.status === 'cancelled') return { mode: 'native' };
      return {
        mode:
          result.status === 'connection_aborted'
            ? 'connection_aborted'
            : 'already_terminal',
      };
    } catch {
      this.disconnect();
      this.closeOwner();
      return { mode: 'connection_aborted' };
    }
  }

  private complete(): void {
    if (this.final !== undefined || !this.acknowledged) return;
    if (this.cancelRequested && !this.cancelConfirmed) return;
    const outcome = this.last;
    if (outcome === undefined) {
      if (this.cancelRequested) {
        this.disconnect();
        this.closeOwner();
      } else this.fail();
      return;
    }
    const status =
      outcome.stopReason === 'stop'
        ? 'completed'
        : outcome.stopReason === 'aborted' && this.cancelConfirmed
          ? 'cancelled'
          : 'failed';
    this.finish({
      status,
      ...(status === 'completed' ? { finalMessage: outcome.text } : {}),
      usage: outcome.usage,
      providerResult: { stopReason: outcome.stopReason },
    });
  }

  private fail(): void {
    this.finish({
      status: 'failed',
      providerResult: { reason: 'sdk_run_failed' },
    });
  }

  private finish(result: RunResult): void {
    if (this.final !== undefined) return;
    this.final = result;
    clearTimeout(this.timer);
    this.release();
    const types = {
      completed: 'run.completed',
      failed: 'run.failed',
      cancelled: 'run.cancelled',
      connection_aborted: 'connection.aborted',
    } as const;
    this.queue.pushTerminal(
      this.event({ type: types[result.status], data: result }),
    );
    this.queue.close();
    this.settlement.resolve(result);
  }

  private emit(mapped: MappedPiEvent): void {
    if (this.final !== undefined) return;
    if (
      JSON.stringify(mapped).length > 262_144 ||
      !this.queue.push(this.event(mapped))
    ) {
      this.disconnect();
      this.closeOwner();
    }
  }

  private event(mapped: MappedPiEvent): HarnessEvent {
    const sequence = this.sequence++;
    return {
      ...this.reference,
      id: `${this.reference.runId}:${String(sequence)}`,
      sequence,
      timestamp: new Date().toISOString(),
      type: mapped.type,
      data: mapped.data,
      ...(mapped.providerEventType === undefined
        ? {}
        : { providerEventType: mapped.providerEventType }),
      ...(mapped.raw === undefined ? {} : { raw: mapped.raw }),
    };
  }
}
