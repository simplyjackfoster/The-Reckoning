import type { EventSink, VmEvent, VmEventType } from '@dead-reckoning/event-stream';

export type Word15 = number;

const WORD15_MASK = 0o77777;
const WORD15_MODULUS = 0o100000;
const SIGN_BIT = 0o40000;
const NEGATIVE_ZERO = WORD15_MASK;

export interface ZeroNormalizationOptions {
  readonly preserveNegativeZero?: boolean;
}

export function normalizeWord15(value: number): Word15 {
  const integer = Math.trunc(value);
  return ((integer % WORD15_MODULUS) + WORD15_MODULUS) % WORD15_MODULUS;
}

export function isNegativeZero(word: Word15): boolean {
  return normalizeWord15(word) === NEGATIVE_ZERO;
}

export function normalizeZero(word: Word15, options: ZeroNormalizationOptions = {}): Word15 {
  const normalized = normalizeWord15(word);
  if (normalized === NEGATIVE_ZERO && options.preserveNegativeZero !== true) {
    return 0;
  }

  return normalized;
}

export function onesComplementNegate(word: Word15): Word15 {
  return normalizeWord15(~normalizeWord15(word));
}

export function signedToOnesComplement(value: number): Word15 {
  const integer = Math.trunc(value);
  if (integer === 0) {
    return 0;
  }

  const magnitude = normalizeWord15(Math.abs(integer));
  if (integer > 0) {
    return magnitude;
  }

  return onesComplementNegate(magnitude);
}

export function onesComplementToSigned(word: Word15): number {
  const normalized = normalizeWord15(word);
  if (normalized === 0 || normalized === NEGATIVE_ZERO) {
    return 0;
  }

  if ((normalized & SIGN_BIT) === 0) {
    return normalized;
  }

  const magnitude = onesComplementNegate(normalized);
  return -magnitude;
}

export function onesComplementAdd(lhs: Word15, rhs: Word15): Word15 {
  let sum = normalizeWord15(lhs) + normalizeWord15(rhs);
  let carry = Math.floor(sum / WORD15_MODULUS);
  sum &= WORD15_MASK;

  while (carry > 0) {
    sum += 1;
    carry = Math.floor(sum / WORD15_MODULUS);
    sum &= WORD15_MASK;
  }

  return normalizeWord15(sum);
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
  readonly haltReason: string | null;
}

export interface VmProgram {
  readonly words: readonly Word15[];
}

export interface StepResult {
  readonly state: VmState;
  readonly emitted: readonly VmEvent[];
}

interface DecodedInstruction {
  readonly opcode: number;
  readonly immediate: number;
}

export function createInitialVmState(): VmState {
  return {
    tick: 0,
    pc: 0,
    stack: [],
    registers: { a: 0, l: 0, q: 0, z: 0 },
    halted: false,
    haltReason: null
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

    if (currentWord === null) {
      this.advanceClock();
      this.halt('end-of-program');
      this.emit('vm.step.end', {
        pc: this.state.pc,
        tick: this.state.tick,
        halted: this.state.halted,
        haltReason: this.state.haltReason
      });

      return { state: this.state, emitted: [] };
    }

    const instruction = this.decodeInstruction(currentWord);
    this.executeInstruction(instruction);
    this.advanceClock();

    this.emit('vm.step.end', {
      pc: this.state.pc,
      tick: this.state.tick,
      halted: this.state.halted,
      haltReason: this.state.haltReason
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

  private decodeInstruction(word: Word15): DecodedInstruction {
    const opcode = (word >> 12) & 0b111;
    const immediate12 = word & 0o7777;

    return {
      opcode,
      immediate: signExtend12(immediate12)
    };
  }

  private executeInstruction(instruction: DecodedInstruction): void {
    this.emit('vm.opcode.decoded', {
      pc: this.state.pc,
      opcode: instruction.opcode,
      immediate: instruction.immediate
    });

    switch (instruction.opcode) {
      case 0:
        this.advancePc();
        return;
      case 1:
        this.pushWord(signedToOnesComplement(instruction.immediate));
        this.advancePc();
        return;
      case 2:
        this.popIntoRegister('a');
        this.advancePc();
        return;
      case 3:
        this.addTopTwo();
        this.advancePc();
        return;
      case 4:
        this.writeRegister('l', signedToOnesComplement(instruction.immediate));
        this.advancePc();
        return;
      case 5:
        this.swapRegisters('a', 'l');
        this.advancePc();
        return;
      case 6:
        this.halt('halt-instruction');
        this.advancePc();
        return;
      default:
        this.halt(`invalid-opcode:${instruction.opcode}`);
        this.advancePc();
    }
  }

  private addTopTwo(): void {
    const rhs = this.popWord();
    const lhs = this.popWord();
    if (lhs === null || rhs === null) {
      this.halt('stack-underflow:add');
      return;
    }

    const sum = onesComplementAdd(lhs, rhs);
    this.pushWord(sum);
  }

  private popIntoRegister(register: keyof VmRegisters): void {
    const popped = this.popWord();
    if (popped === null) {
      this.halt(`stack-underflow:pop-${register}`);
      return;
    }

    this.writeRegister(register, popped);
  }

  private popWord(): Word15 | null {
    const last = this.state.stack[this.state.stack.length - 1];
    if (last === undefined) {
      return null;
    }

    const nextStack = this.state.stack.slice(0, -1);
    this.state = {
      ...this.state,
      stack: nextStack
    };

    this.emit('vm.stack.pop', {
      value: last,
      depthAfter: nextStack.length
    });

    return last;
  }

  private pushWord(value: Word15): void {
    const normalized = normalizeWord15(value);
    const nextStack = [...this.state.stack, normalized];
    this.state = {
      ...this.state,
      stack: nextStack
    };

    this.emit('vm.stack.push', {
      value: normalized,
      depthAfter: nextStack.length
    });
  }

  private writeRegister(register: keyof VmRegisters, value: Word15): void {
    const normalized = normalizeWord15(value);
    const previous = this.state.registers[register];
    this.state = {
      ...this.state,
      registers: {
        ...this.state.registers,
        [register]: normalized
      }
    };

    this.emit('vm.register.write', {
      register,
      previous,
      value: normalized
    });
  }

  private swapRegisters(lhs: keyof VmRegisters, rhs: keyof VmRegisters): void {
    const lhsValue = this.state.registers[lhs];
    const rhsValue = this.state.registers[rhs];
    this.writeRegister(lhs, rhsValue);
    this.writeRegister(rhs, lhsValue);
  }

  private advancePc(): void {
    this.state = {
      ...this.state,
      pc: this.state.pc + 1
    };
  }

  private advanceClock(): void {
    this.state = {
      ...this.state,
      tick: this.state.tick + 1
    };
  }

  private halt(reason: string): void {
    this.state = {
      ...this.state,
      halted: true,
      haltReason: reason
    };

    this.emit('vm.halt', { reason });
  }

  private emit(type: VmEventType, payload: Record<string, unknown>): void {
    const event: VmEvent = {
      seq: this.seq,
      tick: this.state.tick,
      type,
      payload
    };
    this.seq += 1;

    this.sink.append(event);
  }
}

function signExtend12(value: number): number {
  const normalized = value & 0xfff;
  return (normalized & 0x800) === 0 ? normalized : normalized - 0x1000;
}
