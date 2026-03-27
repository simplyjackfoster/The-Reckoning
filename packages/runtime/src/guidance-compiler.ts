import { Opcode, encodeInstruction, type VmProgram } from '@dead-reckoning/vm-core';

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

export interface CompiledGuidanceProgram {
  readonly program: VmProgram;
  readonly compiledInstructions: readonly {
    readonly sourceOpcode: string;
    readonly sourceOperand: string | null;
    readonly words: readonly number[];
  }[];
}

export function compileGuidanceLines(lines: readonly GuidanceLine[]): CompiledGuidanceProgram {
  const words: number[] = [];
  const compiledInstructions: Array<{
    sourceOpcode: string;
    sourceOperand: string | null;
    words: number[];
  }> = [];

  let stackDepth = 0;

  const ensureDepth = (required: number, seed: string): number[] => {
    const emitted: number[] = [];
    while (stackDepth < required) {
      emitted.push(encodeInstruction(Opcode.PushImmediate, symbolHash(`${seed}:${stackDepth}`, 64) + 1));
      stackDepth += 1;
    }

    return emitted;
  };

  for (const line of lines) {
    const loweredOpcode = line.opcode.toUpperCase();
    const emitted: number[] = [];

    switch (loweredOpcode) {
      case 'DLOAD':
        emitted.push(encodeInstruction(Opcode.PushImmediate, symbolHash(line.operand ?? '', 256)));
        stackDepth += 1;
        break;
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
      case 'STORE':
      case 'STODL':
      case 'STOVL':
        emitted.push(...ensureDepth(1, loweredOpcode));
        emitted.push(encodeInstruction(Opcode.Store, symbolHash(line.operand ?? '', 128)));
        break;
      case 'VLOAD': {
        const [x, y, z] = vectorTriplet(line.operand ?? '');
        emitted.push(
          encodeInstruction(Opcode.PushImmediate, x),
          encodeInstruction(Opcode.PushImmediate, y),
          encodeInstruction(Opcode.PushImmediate, z)
        );
        stackDepth += 3;
        break;
      }
      case 'VAD':
        emitted.push(...ensureDepth(6, 'VAD'));
        emitted.push(encodeInstruction(Opcode.Vadd3));
        stackDepth -= 3;
        break;
      case 'VXSC':
        emitted.push(...ensureDepth(2, 'VXSC'));
        emitted.push(encodeInstruction(Opcode.Mul));
        stackDepth -= 1;
        break;
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
      sourceOperand: line.operand,
      words: emitted
    });
  }

  words.push(encodeInstruction(Opcode.Halt));

  return {
    program: { words },
    compiledInstructions
  };
}

function vectorTriplet(input: string): readonly [number, number, number] {
  const seed = symbolHash(input, 128);
  return [seed, symbolHash(`${input}:y`, 128), symbolHash(`${input}:z`, 128)];
}

function symbolHash(input: string, modulo: number): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) % modulo;
  }

  return hash;
}
