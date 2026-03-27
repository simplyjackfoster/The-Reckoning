import { InMemoryEventSink, type VmEvent } from '@dead-reckoning/event-stream';
import { AgcInterpretiveVm, type VmProgram, type VmState } from '@dead-reckoning/vm-core';

export interface RuntimeResult {
  readonly finalState: VmState;
  readonly events: readonly VmEvent[];
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
