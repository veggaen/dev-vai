import { outboxItemSchema, type OutboxItem } from '@vai/contracts/adoption';
import { PERSISTED_NAMES } from '@vai/constants';

export interface OutboxStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface OutboxTransport {
  send(item: OutboxItem): Promise<void>;
}

const STORAGE_KEY = `${PERSISTED_NAMES.outbox}:v1`;

export class DurableOutbox {
  private items: OutboxItem[];
  private flushing: Promise<void> | null = null;

  constructor(private readonly storage: OutboxStorage, private readonly now = () => Date.now()) {
    this.items = this.read().map((item) => item.state === 'sending' ? { ...item, state: 'pending' } : item);
    this.persist();
  }

  list(): readonly OutboxItem[] { return this.items; }

  enqueue(environmentId: string, kind: string, payload: unknown, id: string = crypto.randomUUID()): OutboxItem {
    const item = outboxItemSchema.parse({
      id, environmentId, kind, payload, createdAt: this.now(), attempts: 0, state: 'pending',
    });
    this.items.push(item);
    this.persist();
    return item;
  }

  acknowledge(id: string): void {
    this.items = this.items.filter((item) => item.id !== id);
    this.persist();
  }

  flush(transport: OutboxTransport): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.flushSerial(transport).finally(() => { this.flushing = null; });
    return this.flushing;
  }

  private async flushSerial(transport: OutboxTransport): Promise<void> {
    for (const original of [...this.items]) {
      const index = this.items.findIndex((item) => item.id === original.id);
      if (index < 0) continue;
      this.items[index] = { ...this.items[index], state: 'sending', attempts: this.items[index].attempts + 1 };
      this.persist();
      try {
        await transport.send(this.items[index]);
        this.acknowledge(original.id);
      } catch (error) {
        const current = this.items.find((item) => item.id === original.id);
        if (current) {
          const failed = outboxItemSchema.parse({
            ...current, state: 'failed', lastError: error instanceof Error ? error.message : String(error),
          });
          this.items = this.items.map((item) => item.id === failed.id ? failed : item);
          this.persist();
        }
        break;
      }
    }
  }

  private read(): OutboxItem[] {
    try {
      const parsed = JSON.parse(this.storage.getItem(STORAGE_KEY) ?? '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap((value) => {
        const result = outboxItemSchema.safeParse(value);
        return result.success ? [result.data] : [];
      });
    } catch { return []; }
  }

  private persist(): void { this.storage.setItem(STORAGE_KEY, JSON.stringify(this.items)); }
}

export function createBrowserOutbox(): DurableOutbox | null {
  return typeof window === 'undefined' ? null : new DurableOutbox(window.localStorage);
}
