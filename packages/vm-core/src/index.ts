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
const HALF_REVOLUTION_SCALE = 0x3fff;

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
  Vadd3 = 15,
  Vsub3 = 16,
  Vxsc = 17,
  Dot3 = 18,
  Abs = 19,
  Sign = 20,
  Div = 21,
  LoadVec3 = 22,
  StoreVec3 = 23,
  Call = 24,
  Return = 25,
  JumpIfNonZero = 26,
  Vxv = 27,
  Unit = 28,
  Sine = 29,
  Cosine = 30,
  Arcsin = 31,
  Arctan2 = 32,
  Mxv = 33,
  Vxm = 34,
  Transpose = 35,
  LoadMat3 = 36,
  StoreMat3 = 37,
  PopVac = 38
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

export function onesComplementMultiplyFractional(a: Word15, b: Word15): Word15 {
  const signedA = onesComplementToSigned(a);
  const signedB = onesComplementToSigned(b);
  const product = Math.trunc((signedA * signedB) / 16384);
  return signedToOnesComplement(product);
}

export function onesComplementDivide(lhs: Word15, rhs: Word15): Word15 | null {
  const denominator = onesComplementToSigned(rhs);
  if (denominator === 0) {
    return null;
  }

  const quotient = Math.trunc(onesComplementToSigned(lhs) / denominator);
  return signedToOnesComplement(quotient);
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
  readonly callStack: readonly number[];
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
  const normalizedImmediate = immediate & 0x01ff;
  return normalizeWord15(((opcode & 0b111111) << 9) | normalizedImmediate);
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
    callStack: [],
    registers: { a: 0, l: 0, q: 0, z: 0 },
    memory,
    halted: false,
    haltReason: null
  };
}

export class AgcInterpretiveVm {
  private seq = 0;
  private state: VmState;
  private matrixBuffer: Word15[] = Array.from({ length: 9 }, () => 0);

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
    this.matrixBuffer = Array.from({ length: 9 }, () => 0);
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
      callDepth: this.state.callStack.length,
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
    const opcode = ((word >> 9) & 0b111111) as Opcode;
    const immediate9 = word & 0x01ff;

    return {
      opcode,
      immediate: signExtend9(immediate9)
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
        this.jumpOnZero(instruction.immediate, true);
        return;
      case Opcode.JumpIfNonZero:
        this.jumpOnZero(instruction.immediate, false);
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
      case Opcode.Vsub3:
        this.vsub3();
        this.advancePc();
        return;
      case Opcode.Vxsc:
        this.vxsc();
        this.advancePc();
        return;
      case Opcode.Dot3:
        this.dot3();
        this.advancePc();
        return;
      case Opcode.Abs:
        this.absTop();
        this.advancePc();
        return;
      case Opcode.Sign:
        this.signTop();
        this.advancePc();
        return;
      case Opcode.Div:
        this.divTop();
        this.advancePc();
        return;
      case Opcode.LoadVec3:
        this.loadVec3(instruction.immediate);
        this.advancePc();
        return;
      case Opcode.StoreVec3:
        this.storeVec3(instruction.immediate);
        this.advancePc();
        return;
      case Opcode.Call:
        this.callRelative(instruction.immediate);
        return;
      case Opcode.Return:
      case Opcode.PopVac:
        this.returnFromCall();
        return;
      case Opcode.Vxv:
        this.vxv();
        this.advancePc();
        return;
      case Opcode.Unit:
        this.unit();
        this.advancePc();
        return;
      case Opcode.Sine:
        this.unaryTrig((x) => Math.sin(x));
        this.advancePc();
        return;
      case Opcode.Cosine:
        this.unaryTrig((x) => Math.cos(x));
        this.advancePc();
        return;
      case Opcode.Arcsin:
        this.arcsin();
        this.advancePc();
        return;
      case Opcode.Arctan2:
        this.arctan2();
        this.advancePc();
        return;
      case Opcode.Mxv:
        this.mxv(false);
        this.advancePc();
        return;
      case Opcode.Vxm:
        this.mxv(true);
        this.advancePc();
        return;
      case Opcode.Transpose:
        this.transpose();
        this.advancePc();
        return;
      case Opcode.LoadMat3:
        this.loadMat3(instruction.immediate);
        this.advancePc();
        return;
      case Opcode.StoreMat3:
        this.storeMat3(instruction.immediate);
        this.advancePc();
        return;
      default:
        this.halt(`invalid-opcode:${instruction.opcode}`);
        this.advancePc();
    }
  }

  private jumpOnZero(offset: number, zeroBranch: boolean): void {
    const top = this.state.stack.at(-1);
    const isZero = top !== undefined && normalizeZero(top) === 0;
    const taken = zeroBranch ? isZero : !isZero;
    const condition = zeroBranch ? 'top-is-zero' : 'top-is-nonzero';

    if (taken) {
      this.jumpRelative(offset, condition, true);
      return;
    }

    this.emit('vm.jump', {
      fromPc: this.state.pc,
      toPc: this.state.pc + 1,
      condition,
      taken: false
    });
    this.advancePc();
  }

  private jumpRelative(offset: number, condition: 'always' | 'top-is-zero' | 'top-is-nonzero', taken: boolean): void {
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

  private callRelative(offset: number): void {
    const fromPc = this.state.pc;
    const toPc = Math.max(0, fromPc + offset);
    const returnPc = fromPc + 1;
    const nextCallStack = [...this.state.callStack, returnPc];

    this.writeRegister('q', signedToOnesComplement(returnPc));
    this.state = {
      ...this.state,
      callStack: nextCallStack,
      pc: toPc
    };

    this.emit('vm.call', {
      fromPc,
      toPc,
      returnPc,
      depthAfter: nextCallStack.length
    });
  }

  private returnFromCall(): void {
    const fromPc = this.state.pc;
    const returnPc = this.state.callStack.at(-1);
    if (returnPc === undefined) {
      this.halt('callstack-underflow:return');
      this.advancePc();
      return;
    }

    const nextCallStack = this.state.callStack.slice(0, -1);
    this.state = {
      ...this.state,
      callStack: nextCallStack,
      pc: returnPc
    };

    this.emit('vm.return', {
      fromPc,
      toPc: returnPc,
      depthAfter: nextCallStack.length
    });
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
    const rhs = this.popVector3();
    const lhs = this.popVector3();
    if (!rhs || !lhs) {
      this.halt('stack-underflow:vadd3');
      return;
    }

    this.pushWord(onesComplementAdd(lhs[0], rhs[0]));
    this.pushWord(onesComplementAdd(lhs[1], rhs[1]));
    this.pushWord(onesComplementAdd(lhs[2], rhs[2]));
  }

  private vsub3(): void {
    const rhs = this.popVector3();
    const lhs = this.popVector3();
    if (!rhs || !lhs) {
      this.halt('stack-underflow:vsub3');
      return;
    }

    this.pushWord(onesComplementSubtract(lhs[0], rhs[0]));
    this.pushWord(onesComplementSubtract(lhs[1], rhs[1]));
    this.pushWord(onesComplementSubtract(lhs[2], rhs[2]));
  }

  private vxsc(): void {
    const scalar = this.popWord();
    const vector = this.popVector3();
    if (!vector || scalar === null) {
      this.halt('stack-underflow:vxsc');
      return;
    }

    this.pushWord(onesComplementMultiply(vector[0], scalar));
    this.pushWord(onesComplementMultiply(vector[1], scalar));
    this.pushWord(onesComplementMultiply(vector[2], scalar));
  }

  private vxv(): void {
    const rhs = this.popVector3();
    const lhs = this.popVector3();
    if (!rhs || !lhs) {
      this.halt('stack-underflow:vxv');
      return;
    }

    const x = onesComplementSubtract(
      onesComplementMultiplyFractional(lhs[1], rhs[2]),
      onesComplementMultiplyFractional(lhs[2], rhs[1])
    );
    const y = onesComplementSubtract(
      onesComplementMultiplyFractional(lhs[2], rhs[0]),
      onesComplementMultiplyFractional(lhs[0], rhs[2])
    );
    const z = onesComplementSubtract(
      onesComplementMultiplyFractional(lhs[0], rhs[1]),
      onesComplementMultiplyFractional(lhs[1], rhs[0])
    );

    this.pushWord(x);
    this.pushWord(y);
    this.pushWord(z);

    this.emit('vm.vector.op', {
      opcode: 'vxv',
      inputA: lhs,
      inputB: rhs,
      output: [x, y, z]
    });
  }

  private unit(): void {
    const vector = this.popVector3();
    if (!vector) {
      this.halt('stack-underflow:unit');
      return;
    }

    const sx = onesComplementToSigned(vector[0]);
    const sy = onesComplementToSigned(vector[1]);
    const sz = onesComplementToSigned(vector[2]);
    const mag = Math.sqrt(sx * sx + sy * sy + sz * sz);

    if (mag < 1e-6) {
      this.halt('division-by-zero:unit');
      return;
    }

    const out: [Word15, Word15, Word15] = [
      signedToOnesComplement(Math.round(sx / mag)),
      signedToOnesComplement(Math.round(sy / mag)),
      signedToOnesComplement(Math.round(sz / mag))
    ];

    this.pushWord(out[0]);
    this.pushWord(out[1]);
    this.pushWord(out[2]);

    this.emit('vm.vector.op', {
      opcode: 'unit',
      inputA: vector,
      output: out
    });
  }

  private dot3(): void {
    const rhs = this.popVector3();
    const lhs = this.popVector3();
    if (!rhs || !lhs) {
      this.halt('stack-underflow:dot3');
      return;
    }

    const product0 = onesComplementMultiply(lhs[0], rhs[0]);
    const product1 = onesComplementMultiply(lhs[1], rhs[1]);
    const product2 = onesComplementMultiply(lhs[2], rhs[2]);
    const sum = onesComplementAdd(onesComplementAdd(product0, product1), product2);
    this.pushWord(sum);
  }

  private absTop(): void {
    const value = this.popWord();
    if (value === null) {
      this.halt('stack-underflow:abs');
      return;
    }

    const signed = Math.abs(onesComplementToSigned(value));
    this.pushWord(signedToOnesComplement(signed));
  }

  private signTop(): void {
    const value = this.popWord();
    if (value === null) {
      this.halt('stack-underflow:sign');
      return;
    }

    const signed = onesComplementToSigned(value);
    const sign = signed === 0 ? 0 : signed > 0 ? 1 : -1;
    this.pushWord(signedToOnesComplement(sign));
  }

  private divTop(): void {
    const rhs = this.popWord();
    const lhs = this.popWord();

    if (lhs === null || rhs === null) {
      this.halt('stack-underflow:div');
      return;
    }

    const quotient = onesComplementDivide(lhs, rhs);
    if (quotient === null) {
      this.halt('division-by-zero');
      return;
    }

    this.pushWord(quotient);
  }

  private unaryTrig(fn: (value: number) => number): void {
    const value = this.popWord();
    if (value === null) {
      this.halt('stack-underflow:trig');
      return;
    }

    const radians = (onesComplementToSigned(value) / HALF_REVOLUTION_SCALE) * Math.PI;
    const output = fn(radians);
    this.pushWord(signedToOnesComplement(Math.round(output * HALF_REVOLUTION_SCALE)));
  }

  private arcsin(): void {
    const value = this.popWord();
    if (value === null) {
      this.halt('stack-underflow:arcsin');
      return;
    }

    const normalized = onesComplementToSigned(value) / HALF_REVOLUTION_SCALE;
    if (Math.abs(normalized) > 1) {
      this.halt('domain-error:arcsin');
      return;
    }

    const angle = Math.asin(normalized);
    this.pushWord(signedToOnesComplement(Math.round((angle / Math.PI) * HALF_REVOLUTION_SCALE)));
  }

  private arctan2(): void {
    const x = this.popWord();
    const y = this.popWord();
    if (x === null || y === null) {
      this.halt('stack-underflow:arctan2');
      return;
    }

    const xs = onesComplementToSigned(x) / HALF_REVOLUTION_SCALE;
    const ys = onesComplementToSigned(y) / HALF_REVOLUTION_SCALE;
    const angle = Math.atan2(ys, xs);
    this.pushWord(signedToOnesComplement(Math.round((angle / Math.PI) * HALF_REVOLUTION_SCALE)));
  }

  private mxv(transpose: boolean): void {
    const v = this.popVector3();
    if (!v) {
      this.halt(`stack-underflow:${transpose ? 'vxm' : 'mxv'}`);
      return;
    }

    const matrix = transpose ? transposeMatrix(this.matrixBuffer) : this.matrixBuffer;
    const x = onesComplementAdd(
      onesComplementAdd(
        onesComplementMultiplyFractional(matrix[0] ?? 0, v[0]),
        onesComplementMultiplyFractional(matrix[3] ?? 0, v[1])
      ),
      onesComplementMultiplyFractional(matrix[6] ?? 0, v[2])
    );
    const y = onesComplementAdd(
      onesComplementAdd(
        onesComplementMultiplyFractional(matrix[1] ?? 0, v[0]),
        onesComplementMultiplyFractional(matrix[4] ?? 0, v[1])
      ),
      onesComplementMultiplyFractional(matrix[7] ?? 0, v[2])
    );
    const z = onesComplementAdd(
      onesComplementAdd(
        onesComplementMultiplyFractional(matrix[2] ?? 0, v[0]),
        onesComplementMultiplyFractional(matrix[5] ?? 0, v[1])
      ),
      onesComplementMultiplyFractional(matrix[8] ?? 0, v[2])
    );

    this.pushWord(x);
    this.pushWord(y);
    this.pushWord(z);
  }

  private transpose(): void {
    this.matrixBuffer = transposeMatrix(this.matrixBuffer);
  }

  private loadMat3(baseAddress: number): void {
    this.matrixBuffer = Array.from({ length: 9 }, (_, idx) => this.readMemory(baseAddress + idx));
  }

  private storeMat3(baseAddress: number): void {
    for (let idx = 0; idx < 9; idx += 1) {
      this.writeMemory(baseAddress + idx, this.matrixBuffer[idx] ?? 0);
    }
  }

  private loadVec3(baseAddress: number): void {
    this.pushWord(this.readMemory(baseAddress));
    this.pushWord(this.readMemory(baseAddress + 1));
    this.pushWord(this.readMemory(baseAddress + 2));
  }

  private storeVec3(baseAddress: number): void {
    const x = this.state.stack.at(-3);
    const y = this.state.stack.at(-2);
    const z = this.state.stack.at(-1);
    if (x === undefined || y === undefined || z === undefined) {
      this.halt('stack-underflow:store-vec3');
      return;
    }

    this.writeMemory(baseAddress, x);
    this.writeMemory(baseAddress + 1, y);
    this.writeMemory(baseAddress + 2, z);
  }

  private popVector3(): readonly [Word15, Word15, Word15] | null {
    const z = this.popWord();
    const y = this.popWord();
    const x = this.popWord();

    if (x === null || y === null || z === null) {
      return null;
    }

    return [x, y, z];
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

function signExtend9(value: number): number {
  const normalized = value & 0x01ff;
  return (normalized & 0x0100) === 0 ? normalized : normalized - 0x0200;
}

function normalizeAddress(value: number, memoryLength: number): number {
  const address = Math.trunc(Math.abs(value));
  return address % memoryLength;
}

function transposeMatrix(input: readonly Word15[]): Word15[] {
  return [input[0] ?? 0, input[3] ?? 0, input[6] ?? 0, input[1] ?? 0, input[4] ?? 0, input[7] ?? 0, input[2] ?? 0, input[5] ?? 0, input[8] ?? 0];
}
