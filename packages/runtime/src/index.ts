import {
  deserializeReplayLog,
  InMemoryEventSink,
  serializeReplayLog,
  type VmEvent,
  type VmReplayLog
} from '@dead-reckoning/event-stream';
import { AgcInterpretiveVm, type VmOptions, type VmProgram, type VmState } from '@dead-reckoning/vm-core';
import { compileGuidanceLines, type CompiledGuidanceProgram, type GuidanceLine } from './guidance-compiler.js';

export type { GuidanceLine, CompiledGuidanceProgram } from './guidance-compiler.js';

export interface RuntimeResult {
  readonly finalState: VmState;
  readonly events: readonly VmEvent[];
}

export interface RuntimeReplayResult extends RuntimeResult {
  readonly replay: string;
}

export interface ReplayMismatch {
  readonly index: number;
  readonly expected: VmEvent | null;
  readonly actual: VmEvent | null;
}

export interface ReplayVerificationResult {
  readonly deterministic: boolean;
  readonly mismatch: ReplayMismatch | null;
  readonly firstRun: RuntimeResult;
  readonly secondRun: RuntimeResult;
}

export interface GuidanceRuntimeResult extends RuntimeReplayResult {
  readonly compiled: CompiledGuidanceProgram;
}

export function runProgram(program: VmProgram, maxSteps = 1_000, options: VmOptions = {}): RuntimeResult {
  const sink = new InMemoryEventSink();
  const vm = new AgcInterpretiveVm(program, sink, options);
  vm.reset();

  for (let i = 0; i < maxSteps; i += 1) {
    vm.step();
    if (vm.snapshot().halted) {
      break;
    }
  }

  return {
    finalState: vm.snapshot(),
    events: sink.all()
  };
}

export function runProgramWithReplay(
  program: VmProgram,
  maxSteps = 1_000,
  options: VmOptions = {}
): RuntimeReplayResult {
  const result = runProgram(program, maxSteps, options);

  return {
    ...result,
    replay: serializeReplayLog(result.events)
  };
}

export function runGuidanceSlice(
  lines: readonly GuidanceLine[],
  maxSteps = 5_000,
  options: VmOptions = {}
): GuidanceRuntimeResult {
  const compiled = compileGuidanceLines(lines);
  const mergedOptions = mergeVmOptions(options, { initialMemory: compiled.initialMemory });
  const result = runProgramWithReplay(compiled.program, maxSteps, mergedOptions);

  return {
    ...result,
    compiled
  };
}

export function readReplay(serialized: string): VmReplayLog {
  return deserializeReplayLog(serialized);
}

export function verifyDeterministicReplay(
  program: VmProgram,
  maxSteps = 1_000,
  options: VmOptions = {}
): ReplayVerificationResult {
  const firstRun = runProgram(program, maxSteps, options);
  const secondRun = runProgram(program, maxSteps, options);

  const mismatch = findFirstReplayMismatch(firstRun.events, secondRun.events);

  return {
    deterministic: mismatch === null,
    mismatch,
    firstRun,
    secondRun
  };
}

function mergeVmOptions(base: VmOptions, override: VmOptions): VmOptions {
  const baseMemory = base.initialMemory ?? [];
  const overrideMemory = override.initialMemory ?? [];
  const memoryLength = Math.max(baseMemory.length, overrideMemory.length);

  const mergedMemory = Array.from({ length: memoryLength }, (_, index) => {
    return overrideMemory[index] ?? baseMemory[index] ?? 0;
  });

  return {
    ...base,
    ...override,
    memorySize: Math.max(base.memorySize ?? 0, override.memorySize ?? 0, mergedMemory.length || 256),
    initialMemory: mergedMemory
  };
}

function findFirstReplayMismatch(
  expected: readonly VmEvent[],
  actual: readonly VmEvent[]
): ReplayMismatch | null {
  const length = Math.max(expected.length, actual.length);

  for (let index = 0; index < length; index += 1) {
    const lhs = expected[index] ?? null;
    const rhs = actual[index] ?? null;

    if (!eventsEqual(lhs, rhs)) {
      return {
        index,
        expected: lhs,
        actual: rhs
      };
    }
  }

  return null;
}

function eventsEqual(lhs: VmEvent | null, rhs: VmEvent | null): boolean {
  return JSON.stringify(lhs) === JSON.stringify(rhs);
}
