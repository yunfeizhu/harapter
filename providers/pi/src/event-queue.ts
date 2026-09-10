import { HarnessError, type HarnessEvent } from '@harapter/core';
import { PI_PROVIDER_ID } from './protocol.js';

export class EventQueue {
  private readonly values: HarnessEvent[] = [];
  private closed = false;
  private consumed = false;
  private waiter: ((result: IteratorResult<HarnessEvent>) => void) | undefined;

  constructor(private readonly capacity: number) {}

  push(event: HarnessEvent): boolean {
    if (this.closed) return false;
    if (this.waiter !== undefined) {
      const waiter = this.waiter;
      this.waiter = undefined;
      waiter({ done: false, value: event });
      return true;
    }
    if (this.values.length >= this.capacity - 1) return false;
    this.values.push(event);
    return true;
  }

  pushTerminal(event: HarnessEvent): void {
    if (this.waiter !== undefined) {
      const waiter = this.waiter;
      this.waiter = undefined;
      waiter({ done: false, value: event });
      return;
    }
    this.values.push(event);
  }

  close(): void {
    this.closed = true;
  }

  iterable(): AsyncIterable<HarnessEvent> {
    if (this.consumed) {
      return {
        [Symbol.asyncIterator]: () => ({
          next: () =>
            Promise.reject(
              new HarnessError(
                'run_conflict',
                'Pi Agent Run events already have a consumer.',
                { retryable: false, providerId: PI_PROVIDER_ID },
              ),
            ),
        }),
      };
    }
    this.consumed = true;
    return {
      [Symbol.asyncIterator]: () => ({ next: () => this.next() }),
    };
  }

  private next(): Promise<IteratorResult<HarnessEvent>> {
    const event = this.values.shift();
    if (event !== undefined)
      return Promise.resolve({ done: false, value: event });
    if (this.closed) return Promise.resolve({ done: true, value: undefined });
    if (this.waiter !== undefined) {
      return Promise.reject(
        new HarnessError(
          'run_conflict',
          'A Pi Agent Run event read is already pending.',
          { retryable: false, providerId: PI_PROVIDER_ID },
        ),
      );
    }
    return new Promise((resolveNext) => {
      this.waiter = resolveNext;
    });
  }
}
