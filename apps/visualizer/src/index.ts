import type { VmEvent } from '@dead-reckoning/event-stream';

export interface Frame {
  readonly tick: number;
  readonly pc: number | null;
  readonly halted: boolean;
  readonly haltReason: string | null;
  readonly stackDepth: number;
  readonly topOfStack: number | null;
  readonly registers: {
    readonly a: number;
    readonly l: number;
    readonly q: number;
    readonly z: number;
  };
}

export function renderFrame(events: readonly VmEvent[]): Frame {
  const lastStep = [...events].reverse().find((event) => event.type === 'vm.step.end');
  const haltedEvent = [...events].reverse().find((event) => event.type === 'vm.halt');

  const stack: number[] = [];
  const registers = { a: 0, l: 0, q: 0, z: 0 };

  for (const event of events) {
    if (event.type === 'vm.stack.push') {
      stack.push(Number(event.payload.value));
      continue;
    }

    if (event.type === 'vm.stack.pop') {
      stack.pop();
      continue;
    }

    if (event.type === 'vm.register.write') {
      const register = event.payload.register;
      if (isRegisterName(register)) {
        registers[register] = Number(event.payload.value);
      }
    }
  }

  return {
    tick: (lastStep?.payload.tick as number | undefined) ?? 0,
    pc: (lastStep?.payload.pc as number | undefined) ?? null,
    halted: Boolean(haltedEvent),
    haltReason: (haltedEvent?.payload.reason as string | undefined) ?? null,
    stackDepth: stack.length,
    topOfStack: stack.at(-1) ?? null,
    registers
  };
}


function isRegisterName(value: unknown): value is keyof Frame['registers'] {
  return value === 'a' || value === 'l' || value === 'q' || value === 'z';
}
