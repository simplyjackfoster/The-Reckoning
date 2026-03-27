import {
  Opcode,
  encodeInstruction,
  normalizeWord15,
  onesComplementToSigned,
  signedToOnesComplement,
  type VmProgram
} from '@dead-reckoning/vm-core';

export interface GuidanceLine {
  readonly sourceFile: string;
  readonly lineNumber: number;
  readonly opcodeIndex: number;
  readonly opcode: string;
  readonly operand: string | null;
  readonly comment: string | null;
  readonly isInterpretive: boolean;
  readonly raw: string;
}

export interface CompiledInstruction {
  readonly sourceOpcode: string;
  readonly sourceOperand: string | null;
  readonly words: readonly number[];
}

export interface CompiledGuidanceProgram {
  readonly program: VmProgram;
  readonly compiledInstructions: readonly CompiledInstruction[];
  readonly symbolTable: Readonly<Record<string, number>>;
  readonly initialMemory: readonly number[];
}

interface SymbolAllocation {
  readonly baseAddress: number;
  readonly width: 1 | 3;
}

const VECTOR_HINTS = ['V', 'VEC', 'POS', 'VEL', 'LOS', 'R'];

export function compileGuidanceLines(lines: readonly GuidanceLine[]): CompiledGuidanceProgram {
  const words: number[] = [];
  const compiledInstructions: CompiledInstruction[] = [];
  const symbolPool = new SymbolAllocator();
  const memory = new MemoryBuilder();
  let stackDepth = 0;

  const ensureDepth = (required: number, seed: string): number[] => {
    const emitted: number[] = [];
    while (stackDepth < required) {
      const literal = seededScalar(`${seed}:${stackDepth}`, stackDepth);
      emitted.push(encodeInstruction(Opcode.PushImmediate, onesComplementToSigned(literal)));
      stackDepth += 1;
    }

    return emitted;
  };

  for (const line of lines) {
    const loweredOpcode = line.opcode.toUpperCase();
    const emitted: number[] = [];

    const symbol = line.operand ? sanitizeSymbol(line.operand) : null;

    switch (loweredOpcode) {
      case 'DLOAD': {
        const scalar = symbolPool.allocate(symbol ?? `TMP_DLOAD_${line.opcodeIndex}`, 1);
        memory.ensureScalar(scalar.baseAddress, seededScalar(symbol ?? '', line.opcodeIndex));
        emitted.push(encodeInstruction(Opcode.Load, scalar.baseAddress));
        stackDepth += 1;
        break;
      }
      case 'VLOAD': {
        const vector = symbolPool.allocate(symbol ?? `TMP_VLOAD_${line.opcodeIndex}`, 3);
        memory.ensureVector(vector.baseAddress, seededVector(symbol ?? '', line.opcodeIndex));
        emitted.push(encodeInstruction(Opcode.LoadVec3, vector.baseAddress));
        stackDepth += 3;
        break;
      }
      case 'DAD':
        emitted.push(...ensureDepth(2, 'DAD'));
        emitted.push(encodeInstruction(Opcode.Add));
        stackDepth -= 1;
        break;
      case 'DSU':
        emitted.push(...ensureDepth(2, 'DSU'));
        emitted.push(encodeInstruction(Opcode.Sub));
        stackDepth -= 1;
        break;
      case 'DMP':
        emitted.push(...ensureDepth(2, 'DMP'));
        emitted.push(encodeInstruction(Opcode.Mul));
        stackDepth -= 1;
        break;
      case 'DDV':
        emitted.push(...ensureDepth(2, 'DDV'));
        emitted.push(encodeInstruction(Opcode.Div));
        stackDepth -= 1;
        break;
      case 'ABS':
        emitted.push(...ensureDepth(1, 'ABS'));
        emitted.push(encodeInstruction(Opcode.Abs));
        break;
      case 'SIGN':
        emitted.push(...ensureDepth(1, 'SIGN'));
        emitted.push(encodeInstruction(Opcode.Sign));
        break;
      case 'VAD':
        emitted.push(...ensureDepth(6, 'VAD'));
        emitted.push(encodeInstruction(Opcode.Vadd3));
        stackDepth -= 3;
        break;
      case 'VSU':
        emitted.push(...ensureDepth(6, 'VSU'));
        emitted.push(encodeInstruction(Opcode.Vsub3));
        stackDepth -= 3;
        break;
      case 'VXSC':
        emitted.push(...ensureDepth(4, 'VXSC'));
        emitted.push(encodeInstruction(Opcode.Vxsc));
        stackDepth -= 1;
        break;
      case 'DOT':
        emitted.push(...ensureDepth(6, 'DOT'));
        emitted.push(encodeInstruction(Opcode.Dot3));
        stackDepth -= 5;
        break;
      case 'STORE':
      case 'STODL': {
        emitted.push(...ensureDepth(1, loweredOpcode));
        const scalar = symbolPool.allocate(symbol ?? `TMP_STORE_${line.opcodeIndex}`, 1);
        emitted.push(encodeInstruction(Opcode.Store, scalar.baseAddress));
        break;
      }
      case 'STOVL': {
        emitted.push(...ensureDepth(3, 'STOVL'));
        const vector = symbolPool.allocate(symbol ?? `TMP_STOVL_${line.opcodeIndex}`, 3);
        emitted.push(encodeInstruction(Opcode.StoreVec3, vector.baseAddress));
        break;
      }
      case 'EXIT':
      case 'EXITS':
        break;
      default:
        emitted.push(encodeInstruction(Opcode.Nop));
    }

    if (emitted.length === 0) {
      continue;
    }

    words.push(...emitted);
    compiledInstructions.push({
      sourceOpcode: loweredOpcode,
      sourceOperand: symbol,
      words: emitted
    });
  }

  words.push(encodeInstruction(Opcode.Halt));

  return {
    program: { words },
    compiledInstructions,
    symbolTable: symbolPool.symbolTable(),
    initialMemory: memory.snapshot(symbolPool.maxAllocatedAddress() + 4)
  };
}

class SymbolAllocator {
  private readonly symbols = new Map<string, SymbolAllocation>();
  private nextAddress = 1;

  allocate(name: string, width: 1 | 3): SymbolAllocation {
    const existing = this.symbols.get(name);
    if (existing) {
      return existing;
    }

    const allocation: SymbolAllocation = {
      baseAddress: this.nextAddress,
      width
    };
    this.symbols.set(name, allocation);
    this.nextAddress += width;
    return allocation;
  }

  maxAllocatedAddress(): number {
    return this.nextAddress;
  }

  symbolTable(): Readonly<Record<string, number>> {
    return Object.fromEntries(
      [...this.symbols.entries()].map(([name, allocation]) => [name, allocation.baseAddress])
    );
  }
}

class MemoryBuilder {
  private readonly values = new Map<number, number>();

  ensureScalar(address: number, value: number): void {
    if (!this.values.has(address)) {
      this.values.set(address, normalizeWord15(value));
    }
  }

  ensureVector(baseAddress: number, value: readonly [number, number, number]): void {
    this.ensureScalar(baseAddress, value[0]);
    this.ensureScalar(baseAddress + 1, value[1]);
    this.ensureScalar(baseAddress + 2, value[2]);
  }

  snapshot(minSize: number): readonly number[] {
    const maxAddress = Math.max(minSize, ...this.values.keys(), 0);
    return Array.from({ length: maxAddress + 1 }, (_, index) => normalizeWord15(this.values.get(index) ?? 0));
  }
}

function seededScalar(symbol: string, seed: number): number {
  const hash = symbolHash(symbol, 256) + seed;
  const signed = (hash % 40) - 20;
  return signedToOnesComplement(signed === 0 ? seed % 9 || 1 : signed);
}

function seededVector(symbol: string, seed: number): readonly [number, number, number] {
  const x = seededScalar(`${symbol}:x`, seed);
  const y = seededScalar(`${symbol}:y`, seed + 1);
  const z = seededScalar(`${symbol}:z`, seed + 2);

  if (onesComplementToSigned(x) === 0 && onesComplementToSigned(y) === 0 && onesComplementToSigned(z) === 0) {
    return [signedToOnesComplement(1), signedToOnesComplement(1), signedToOnesComplement(1)];
  }

  return [x, y, z];
}

function sanitizeSymbol(input: string): string {
  return input.trim().replace(/[,\s]+/g, '_').replace(/[^A-Z0-9_]/gi, '').toUpperCase();
}

function symbolHash(input: string, modulo: number): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) % modulo;
  }

  return hash;
}

export function isLikelyVectorSymbol(symbol: string): boolean {
  const upper = symbol.toUpperCase();
  return VECTOR_HINTS.some((hint) => upper.includes(hint));
}
