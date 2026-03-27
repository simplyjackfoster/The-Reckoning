import type { VmEvent } from '@dead-reckoning/event-stream';

export interface Frame {
  readonly tick: number;
  readonly pc: number | null;
  readonly halted: boolean;
}

export function renderFrame(events: readonly VmEvent[]): Frame {
  const lastStep = [...events].reverse().find((event) => event.type === 'vm.step.end');
  const halted = [...events].reverse().some((event) => event.type === 'vm.halt');

  return {
    tick: (lastStep?.payload.tick as number | undefined) ?? 0,
    pc: (lastStep?.payload.pc as number | undefined) ?? null,
    halted
  };
}
