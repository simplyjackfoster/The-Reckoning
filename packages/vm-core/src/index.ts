import type {
  EventSink,
  VmEvent,
  VmEventPayloadMap,
  VmEventType,
  VmSnapshotPayload
} from '@dead-reckoning/event-stream';

export type Word15 = number;

const WORD15_MASK = 0o77777;
const WORD15_MODULUS = 0o100000;
const SIGN_BIT = 0o40000;
const NEGATIVE_ZERO = WORD15_MASK;
const DEFAULT_MEMORY_SIZE = 256;

export enum Opcode {
  Nop = 0,
  PushImmediate = 1,
  PopToA = 2,
  Add = 3,
  SetLImmediate = 4,
  SwapAL = 5,
  Halt = 6,
  Store = 7,
  Load = 8,
  Jump = 9,
  JumpIfZero = 10,
  Sub = 11,
  Mul = 12,
  Dup = 13,
  Pop = 14,
  Vadd3 = 15
}

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

export function onesComplementSubtract(lhs: Word15, rhs: Word15): Word15 {
  return onesComplementAdd(lhs, onesComplementNegate(rhs));
}

export function onesComplementMultiply(lhs: Word15, rhs: Word15): Word15 {
  const signedProduct = onesComplementToSigned(lhs) * onesComplementToSigned(rhs);
  return signedToOnesComplement(signedProduct);
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
  readonly memory: readonly Word15[];
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
  readonly opcode: Opcode;
  readonly immediate: number;
}

export interface VmOptions {
  readonly memorySize?: number;
  readonly initialMemory?: readonly number[];
}

export function encodeInstruction(opcode: Opcode, immediate = 0): Word15 {
  const normalizedImmediate = immediate & 0x03ff;
  return normalizeWord15(((opcode & 0b11111) << 10) | normalizedImmediate);
}

export function createInitialVmState(options: VmOptions = {}): VmState {
  const memorySize = options.memorySize ?? DEFAULT_MEMORY_SIZE;
  const memory = Array.from({ length: memorySize }, (_, index) =>
    normalizeWord15(options.initialMemory?.[index] ?? 0)
  );

  return {
    tick: 0,
    pc: 0,
    stack: [],
    registers: { a: 0, l: 0, q: 0, z: 0 },
    memory,
    halted: false,
    haltReason: null
  };
}

export class AgcInterpretiveVm {
  private seq = 0;
  private state: VmState;

  constructor(
    private readonly program: VmProgram,
    private readonly sink: EventSink,
    private readonly options: VmOptions = {}
  ) {
    this.state = createInitialVmState(options);
  }

  snapshot(): VmState {
    return this.state;
  }

  reset(): VmState {
    this.state = createInitialVmState(this.options);
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
      this.emitStepEnd();

      return { state: this.state, emitted: [] };
    }

    const instruction = this.decodeInstruction(currentWord);
    this.executeInstruction(instruction);
    this.advanceClock();

    this.emit('vm.snapshot', this.createSnapshotPayload(instruction));
    this.emitStepEnd();

    return { state: this.state, emitted: [] };
  }

  private emitStepEnd(): void {
    this.emit('vm.step.end', {
      pc: this.state.pc,
      tick: this.state.tick,
      halted: this.state.halted,
      haltReason: this.state.haltReason
    });
  }

  private createSnapshotPayload(instruction: DecodedInstruction): VmSnapshotPayload {
    return {
      pc: this.state.pc,
      tick: this.state.tick,
      opcode: instruction.opcode,
      immediate: instruction.immediate,
      stackDepth: this.state.stack.length,
      stackTop: this.state.stack.at(-1) ?? null,
      registers: this.state.registers,
      halted: this.state.halted,
      haltReason: this.state.haltReason
    };
  }

  private readCurrentWord(): Word15 | null {
    const rawWord = this.program.words[this.state.pc];
    if (rawWord === undefined) {
      return null;
    }

    return normalizeWord15(rawWord);
  }

  private decodeInstruction(word: Word15): DecodedInstruction {
    const opcode = ((word >> 10) & 0b11111) as Opcode;
    const immediate10 = word & 0x03ff;

    return {
      opcode,
      immediate: signExtend10(immediate10)
    };
  }

  private executeInstruction(instruction: DecodedInstruction): void {
    this.emit('vm.opcode.decoded', {
      pc: this.state.pc,
      opcode: instruction.opcode,
      immediate: instruction.immediate
    });

    switch (instruction.opcode) {
      case Opcode.Nop:
        this.advancePc();
        return;
      case Opcode.PushImmediate:
        this.pushWord(signedToOnesComplement(instruction.immediate));
        this.advancePc();
        return;
      case Opcode.PopToA:
        this.popIntoRegister('a');
        this.advancePc();
        return;
      case Opcode.Add:
        this.binaryStackOp(onesComplementAdd, 'stack-underflow:add');
        this.advancePc();
        return;
      case Opcode.SetLImmediate:
        this.writeRegister('l', signedToOnesComplement(instruction.immediate));
        this.advancePc();
        return;
      case Opcode.SwapAL:
        this.swapRegisters('a', 'l');
        this.advancePc();
        return;
      case Opcode.Halt:
        this.halt('halt-instruction');
        this.advancePc();
        return;
      case Opcode.Store:
        this.storeTopToMemory(instruction.immediate);
        this.advancePc();
        return;
      case Opcode.Load:
        this.pushWord(this.readMemory(instruction.immediate));
        this.advancePc();
        return;
      case Opcode.Jump:
        this.jumpRelative(instruction.immediate, 'always', true);
        return;
      case Opcode.JumpIfZero:
        this.jumpIfZero(instruction.immediate);
        return;
      case Opcode.Sub:
        this.binaryStackOp(onesComplementSubtract, 'stack-underflow:sub');
        this.advancePc();
        return;
      case Opcode.Mul:
        this.binaryStackOp(onesComplementMultiply, 'stack-underflow:mul');
        this.advancePc();
        return;
      case Opcode.Dup:
        this.dupTop();
        this.advancePc();
        return;
      case Opcode.Pop:
        if (this.popWord() === null) {
          this.halt('stack-underflow:pop');
        }
        this.advancePc();
        return;
      case Opcode.Vadd3:
        this.vadd3();
        this.advancePc();
        return;
      default:
        this.halt(`invalid-opcode:${instruction.opcode}`);
        this.advancePc();
    }
  }

  private jumpIfZero(offset: number): void {
    const top = this.state.stack.at(-1);
    const isZero = top !== undefined && normalizeZero(top) === 0;

    if (isZero) {
      this.jumpRelative(offset, 'top-is-zero', true);
      return;
    }

    this.emit('vm.jump', {
      fromPc: this.state.pc,
      toPc: this.state.pc + 1,
      condition: 'top-is-zero',
      taken: false
    });
    this.advancePc();
  }

  private jumpRelative(offset: number, condition: 'always' | 'top-is-zero', taken: boolean): void {
    const fromPc = this.state.pc;
    const toPc = Math.max(0, this.state.pc + offset);

    this.emit('vm.jump', {
      fromPc,
      toPc,
      condition,
      taken
    });

    this.state = {
      ...this.state,
      pc: toPc
    };
  }

  private dupTop(): void {
    const top = this.state.stack.at(-1);
    if (top === undefined) {
      this.halt('stack-underflow:dup');
      return;
    }

    this.pushWord(top);
  }

  private vadd3(): void {
    const b3 = this.popWord();
    const b2 = this.popWord();
    const b1 = this.popWord();
    const a3 = this.popWord();
    const a2 = this.popWord();
    const a1 = this.popWord();

    if ([a1, a2, a3, b1, b2, b3].some((value) => value === null)) {
      this.halt('stack-underflow:vadd3');
      return;
    }

    this.pushWord(onesComplementAdd(a1 as Word15, b1 as Word15));
    this.pushWord(onesComplementAdd(a2 as Word15, b2 as Word15));
    this.pushWord(onesComplementAdd(a3 as Word15, b3 as Word15));
  }

  private binaryStackOp(operation: (lhs: Word15, rhs: Word15) => Word15, underflowReason: string): void {
    const rhs = this.popWord();
    const lhs = this.popWord();
    if (lhs === null || rhs === null) {
      this.halt(underflowReason);
      return;
    }

    const output = operation(lhs, rhs);
    this.pushWord(output);
  }

  private storeTopToMemory(addressValue: number): void {
    const top = this.state.stack.at(-1);
    if (top === undefined) {
      this.halt('stack-underflow:store');
      return;
    }

    this.writeMemory(addressValue, top);
  }

  private readMemory(addressValue: number): Word15 {
    const address = normalizeAddress(addressValue, this.state.memory.length);
    return this.state.memory[address] ?? 0;
  }

  private writeMemory(addressValue: number, value: Word15): void {
    const address = normalizeAddress(addressValue, this.state.memory.length);
    const normalized = normalizeWord15(value);
    const previous = this.state.memory[address] ?? 0;
    const nextMemory = [...this.state.memory];
    nextMemory[address] = normalized;

    this.state = {
      ...this.state,
      memory: nextMemory
    };

    this.emit('vm.memory.write', {
      address,
      previous,
      value: normalized
    });
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

  private emit<TType extends VmEventType>(
    type: TType,
    payload: VmEventPayloadMap[TType]
  ): void {
    const event = {
      seq: this.seq,
      tick: this.state.tick,
      type,
      payload
    } as VmEvent;
    this.seq += 1;

    this.sink.append(event);
  }
}

function signExtend10(value: number): number {
  const normalized = value & 0x03ff;
  return (normalized & 0x0200) === 0 ? normalized : normalized - 0x0400;
}

function normalizeAddress(value: number, memoryLength: number): number {
  const address = Math.trunc(Math.abs(value));
  return address % memoryLength;
}
