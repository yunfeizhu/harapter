import { HarnessError } from '@harapter/core';
import { DSH_PROVIDER_ID } from './protocol.js';

/** Single-consumer bounded queue with one slot reserved for terminal delivery. */
export class GatewayQueue<T> {
  private readonly values: T[] = [];
  private ended = false;
  private claimed = false;
  private failure: HarnessError | undefined;
  private wake: (() => void) | undefined;

  constructor(private readonly capacity: number) {}

  push(value: T, terminal = false): boolean {
    if (this.ended || this.values.length >= this.capacity - (terminal ? 0 : 1))
      return false;
    this.values.push(value);
    this.wake?.();
    return true;
  }

  end(failure?: HarnessError): void {
    if (this.ended) return;
    this.ended = true;
    this.failure = failure;
    if (failure !== undefined) this.values.length = 0;
    this.wake?.();
  }

  async *iterate(): AsyncIterable<T> {
    if (this.claimed) {
      throw new HarnessError(
        'run_conflict',
        'DSH Gateway events already have a consumer.',
        {
          retryable: false,
          providerId: DSH_PROVIDER_ID,
        },
      );
    }
    this.claimed = true;
    for (;;) {
      if (this.failure !== undefined) throw this.failure;
      const next = this.values.shift();
      if (next !== undefined) {
        yield next;
      } else if (this.ended) {
        return;
      } else {
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
        this.wake = undefined;
      }
    }
  }
}
