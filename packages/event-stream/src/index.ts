export type VmEventType =
  | 'vm.reset'
  | 'vm.step.start'
  | 'vm.step.end'
  | 'vm.register.write'
  | 'vm.stack.push'
  | 'vm.stack.pop'
  | 'vm.halt';

export interface VmEventBase {
  readonly seq: number;
  readonly tick: number;
  readonly type: VmEventType;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type VmEvent = VmEventBase;

export interface EventSink {
  append(event: VmEvent): void;
}

export class InMemoryEventSink implements EventSink {
  private readonly events: VmEvent[] = [];

  append(event: VmEvent): void {
    this.events.push(event);
  }

  all(): readonly VmEvent[] {
    return this.events;
  }

  clear(): void {
    this.events.length = 0;
  }
}
