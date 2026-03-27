export type VmEventType =
  | 'vm.reset'
  | 'vm.step.start'
  | 'vm.opcode.decoded'
  | 'vm.step.end'
  | 'vm.register.write'
  | 'vm.stack.push'
  | 'vm.stack.pop'
  | 'vm.memory.write'
  | 'vm.jump'
  | 'vm.call'
  | 'vm.return'
  | 'vm.snapshot'
  | 'vm.halt';

export type VmRegisterName = 'a' | 'l' | 'q' | 'z';

export interface VmSnapshotPayload {
  readonly pc: number;
  readonly tick: number;
  readonly opcode: number;
  readonly immediate: number;
  readonly stackDepth: number;
  readonly stackTop: number | null;
  readonly callDepth: number;
  readonly registers: Readonly<Record<VmRegisterName, number>>;
  readonly halted: boolean;
  readonly haltReason: string | null;
}

export interface VmEventPayloadMap {
  readonly 'vm.reset': {
    readonly pc: number;
  };
  readonly 'vm.step.start': {
    readonly pc: number;
    readonly word: number | null;
  };
  readonly 'vm.opcode.decoded': {
    readonly pc: number;
    readonly opcode: number;
    readonly immediate: number;
  };
  readonly 'vm.step.end': {
    readonly pc: number;
    readonly tick: number;
    readonly halted: boolean;
    readonly haltReason?: string | null;
  };
  readonly 'vm.register.write': {
    readonly register: VmRegisterName;
    readonly previous: number;
    readonly value: number;
  };
  readonly 'vm.stack.push': {
    readonly value: number;
    readonly depthAfter: number;
  };
  readonly 'vm.stack.pop': {
    readonly value: number;
    readonly depthAfter: number;
  };
  readonly 'vm.memory.write': {
    readonly address: number;
    readonly previous: number;
    readonly value: number;
  };
  readonly 'vm.jump': {
    readonly fromPc: number;
    readonly toPc: number;
    readonly condition: 'always' | 'top-is-zero' | 'top-is-nonzero';
    readonly taken: boolean;
  };
  readonly 'vm.call': {
    readonly fromPc: number;
    readonly toPc: number;
    readonly returnPc: number;
    readonly depthAfter: number;
  };
  readonly 'vm.return': {
    readonly fromPc: number;
    readonly toPc: number;
    readonly depthAfter: number;
  };
  readonly 'vm.snapshot': VmSnapshotPayload;
  readonly 'vm.halt': {
    readonly reason: string;
  };
}

export interface VmEventBase<TType extends VmEventType> {
  readonly seq: number;
  readonly tick: number;
  readonly type: TType;
  readonly payload: Readonly<VmEventPayloadMap[TType]>;
}

export type VmEvent = {
  [TType in VmEventType]: VmEventBase<TType>;
}[VmEventType];

export interface VmReplayLog {
  readonly schemaVersion: 1;
  readonly events: readonly VmEvent[];
}

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

export function serializeReplayLog(events: readonly VmEvent[]): string {
  const replay: VmReplayLog = {
    schemaVersion: 1,
    events
  };

  return JSON.stringify(replay);
}

export function deserializeReplayLog(serialized: string): VmReplayLog {
  const parsed = JSON.parse(serialized) as Partial<VmReplayLog>;

  if (parsed.schemaVersion !== 1) {
    throw new Error('unsupported-replay-schema');
  }

  if (!Array.isArray(parsed.events)) {
    throw new Error('invalid-replay-events');
  }

  const events = parsed.events as VmEvent[];
  return {
    schemaVersion: 1,
    events
  };
}
