import type { EventSink, VmEvent, VmEventType } from '@dead-reckoning/event-stream';

export type Word15 = number;

const WORD15_MODULUS = 0o100000;

export function normalizeWord15(value: number): Word15 {
  const integer = Math.trunc(value);
  const wrapped = ((integer % WORD15_MODULUS) + WORD15_MODULUS) % WORD15_MODULUS;
  return wrapped;
}

export interface VmRegisters {
  readonly a: Word15;
  readonly l: Word15;
  readonly q: Word15;
  readonly z: Word15;
}

export interface VmState {
  readonly tick: number;
  readonly pc: number;
  readonly stack: readonly Word15[];
  readonly registers: VmRegisters;
  readonly halted: boolean;
}

export interface VmProgram {
  readonly words: readonly Word15[];
}

export interface StepResult {
  readonly state: VmState;
  readonly emitted: readonly VmEvent[];
}

export function createInitialVmState(): VmState {
  return {
    tick: 0,
    pc: 0,
    stack: [],
    registers: { a: 0, l: 0, q: 0, z: 0 },
    halted: false
  };
}

export class AgcInterpretiveVm {
  private seq = 0;
  private state: VmState = createInitialVmState();

  constructor(
    private readonly program: VmProgram,
    private readonly sink: EventSink
  ) {}

  snapshot(): VmState {
    return this.state;
  }

  reset(): VmState {
    this.state = createInitialVmState();
    this.emit('vm.reset', { pc: 0 });
    return this.state;
  }

  step(): StepResult {
    if (this.state.halted) {
      return { state: this.state, emitted: [] };
    }

    const currentWord = this.readCurrentWord();
    this.emit('vm.step.start', { pc: this.state.pc, word: currentWord });

    const halted = currentWord === null;
    const nextPc = halted ? this.state.pc : this.state.pc + 1;

    this.state = {
      ...this.state,
      tick: this.state.tick + 1,
      pc: nextPc,
      halted
    };

    if (halted) {
      this.emit('vm.halt', { reason: 'end-of-program' });
    }

    this.emit('vm.step.end', {
      pc: this.state.pc,
      tick: this.state.tick,
      halted: this.state.halted
    });

    return { state: this.state, emitted: [] };
  }

  private readCurrentWord(): Word15 | null {
    const rawWord = this.program.words[this.state.pc];
    if (rawWord === undefined) {
      return null;
    }

    return normalizeWord15(rawWord);
  }

  private emit(type: VmEventType, payload: Record<string, unknown>): void {
    const event: VmEvent = {
      seq: this.seq++,
      tick: this.state.tick,
      type,
      payload
    };

    this.sink.append(event);
  }
}
