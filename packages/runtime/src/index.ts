import {
  deserializeReplayLog,
  InMemoryEventSink,
  serializeReplayLog,
  type VmEvent,
  type VmReplayLog
} from '@dead-reckoning/event-stream';
import { AgcInterpretiveVm, type VmProgram, type VmState } from '@dead-reckoning/vm-core';

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

export function runProgram(program: VmProgram, maxSteps = 1_000): RuntimeResult {
  const sink = new InMemoryEventSink();
  const vm = new AgcInterpretiveVm(program, sink);
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

export function runProgramWithReplay(program: VmProgram, maxSteps = 1_000): RuntimeReplayResult {
  const result = runProgram(program, maxSteps);

  return {
    ...result,
    replay: serializeReplayLog(result.events)
  };
}

export function readReplay(serialized: string): VmReplayLog {
  return deserializeReplayLog(serialized);
}

export function verifyDeterministicReplay(
  program: VmProgram,
  maxSteps = 1_000
): ReplayVerificationResult {
  const firstRun = runProgram(program, maxSteps);
  const secondRun = runProgram(program, maxSteps);

  const mismatch = findFirstReplayMismatch(firstRun.events, secondRun.events);

  return {
    deterministic: mismatch === null,
    mismatch,
    firstRun,
    secondRun
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
