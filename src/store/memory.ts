// In-memory store for tests and ?demo mode.
import type { Change, Op } from '../domain/ops';
import type { State } from '../domain/types';
import { Store } from './store';

export interface LogEntry {
  id: string;
  at: number;
  by?: string;
  kind: Change['kind'];
  pid?: string;
  details: Record<string, unknown>;
}

export class MemoryStore extends Store {
  readonly log: LogEntry[] = [];
  private n = 0;

  constructor(initial: State, private by?: string) {
    super();
    this.state = initial;
  }

  newProductId(): string {
    return `p${Date.now().toString(36)}${(this.n++).toString(36)}`;
  }

  protected persist(change: Change, inverse: Op[]): string {
    const id = `t${this.log.length + 1}`;
    this.log.push({
      id,
      at: Date.now(),
      ...(this.by ? { by: this.by } : {}),
      kind: change.kind,
      ...(change.pid ? { pid: change.pid } : {}),
      details: { ...(change.details ?? {}), ops: change.ops, inverse },
    });
    return id;
  }
}
