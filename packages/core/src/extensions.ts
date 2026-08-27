import type {
  ProviderExtensionDescriptor,
  ProviderExtensionRegistry,
} from './contracts.js';
import { HarnessError } from './errors.js';
import type { ProviderId } from './identifiers.js';

interface ExtensionEntry {
  descriptor: ProviderExtensionDescriptor;
  value: unknown;
}

/** Mutable Adapter-side registry exposed to callers through read-only lookup. */
export class ExtensionRegistry implements ProviderExtensionRegistry {
  private readonly entries = new Map<string, ExtensionEntry>();

  /** @param ownerProviderId - Provider allowed to register entries. */
  constructor(private readonly ownerProviderId: ProviderId) {}

  /**
   * Register one typed extension until its disposer runs.
   * @param descriptor - Provider-owned discoverable metadata.
   * @param value - Typed extension implementation.
   * @returns Idempotent disposer for this exact registration.
   */
  register(
    descriptor: ProviderExtensionDescriptor,
    value: unknown,
  ): () => void {
    if (descriptor.providerId !== this.ownerProviderId) {
      throw new HarnessError(
        'invalid_request',
        'Extension Provider does not match its registry owner.',
        { retryable: false, providerId: this.ownerProviderId },
      );
    }
    if (this.entries.has(descriptor.name)) {
      throw new HarnessError(
        'invalid_request',
        `Extension ${descriptor.name} is already registered.`,
        { retryable: false, providerId: this.ownerProviderId },
      );
    }

    const entry: ExtensionEntry = {
      descriptor: { ...descriptor },
      value,
    };
    this.entries.set(descriptor.name, entry);
    return () => {
      if (this.entries.get(descriptor.name) === entry) {
        this.entries.delete(descriptor.name);
      }
    };
  }

  /** @returns Detached descriptors in registration order. */
  list(): readonly ProviderExtensionDescriptor[] {
    return [...this.entries.values()].map(({ descriptor }) => ({
      ...descriptor,
    }));
  }

  /**
   * @param name - Provider-namespaced extension name.
   * @returns Whether the extension is registered.
   */
  has(name: string): boolean {
    return this.entries.has(name);
  }

  /**
   * @param name - Provider-namespaced extension name.
   * @returns The registered typed implementation, if present.
   */
  get<T>(name: string, guard?: (value: unknown) => value is T): T | undefined {
    const value = this.entries.get(name)?.value;
    if (value === undefined || (guard !== undefined && !guard(value))) {
      return undefined;
    }
    return value as T;
  }
}
