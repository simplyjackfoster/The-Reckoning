import type { VmEvent, VmRegisterName } from '@dead-reckoning/event-stream';

export interface Frame {
  readonly tick: number;
  readonly pc: number | null;
  readonly halted: boolean;
  readonly haltReason: string | null;
  readonly stackDepth: number;
  readonly callDepth: number;
  readonly topOfStack: number | null;
  readonly registers: {
    readonly a: number;
    readonly l: number;
    readonly q: number;
    readonly z: number;
  };
  readonly lastOpcode: number | null;
  readonly lastImmediate: number | null;
}

export interface TimelineRenderOptions {
  readonly maxFrames?: number;
}

export type PlaybackMode = 'realtime' | 'fixed-rate' | 'single-step' | 'paused';

export interface PlaybackState {
  readonly mode: PlaybackMode;
  readonly cursor: number;
  readonly frames: readonly Frame[];
}

export function renderFrame(events: readonly VmEvent[]): Frame {
  return buildFrameTimeline(events).at(-1) ?? createInitialFrame();
}

export function buildFrameTimeline(events: readonly VmEvent[]): readonly Frame[] {
  const stack: number[] = [];
  const registers: Record<VmRegisterName, number> = { a: 0, l: 0, q: 0, z: 0 };
  const frames: Frame[] = [];
  let haltedReason: string | null = null;
  let lastOpcode: number | null = null;
  let lastImmediate: number | null = null;
  let callDepth = 0;

  for (const event of events) {
    if (event.type === 'vm.stack.push') {
      stack.push(event.payload.value);
      continue;
    }

    if (event.type === 'vm.stack.pop') {
      stack.pop();
      continue;
    }

    if (event.type === 'vm.call') {
      callDepth = event.payload.depthAfter;
      continue;
    }

    if (event.type === 'vm.return') {
      callDepth = event.payload.depthAfter;
      continue;
    }

    if (event.type === 'vm.register.write') {
      const register = event.payload.register;
      if (isRegisterName(register)) {
        registers[register] = event.payload.value;
      }
      continue;
    }

    if (event.type === 'vm.opcode.decoded') {
      lastOpcode = event.payload.opcode;
      lastImmediate = event.payload.immediate;
      continue;
    }

    if (event.type === 'vm.halt') {
      haltedReason = event.payload.reason;
      continue;
    }

    if (event.type === 'vm.step.end') {
      frames.push({
        tick: event.payload.tick,
        pc: event.payload.pc,
        halted: event.payload.halted,
        haltReason: haltedReason,
        stackDepth: stack.length,
        callDepth,
        topOfStack: stack.at(-1) ?? null,
        registers: {
          a: registers.a,
          l: registers.l,
          q: registers.q,
          z: registers.z
        },
        lastOpcode,
        lastImmediate
      });
    }
  }

  return frames;
}

export function renderAsciiTimeline(frames: readonly Frame[], options: TimelineRenderOptions = {}): string {
  if (frames.length === 0) {
    return 'No frames.';
  }

  const maxFrames = Math.max(1, options.maxFrames ?? 20);
  const sliced = frames.slice(-maxFrames);
  const lines = sliced.map((frame, index) => {
    const marker = frame.halted ? '■' : '•';
    return `${String(index + 1).padStart(2, '0')} ${marker} tick=${frame.tick} pc=${frame.pc ?? 'n/a'} stack=${frame.stackDepth} call=${frame.callDepth} top=${frame.topOfStack ?? '∅'} op=${frame.lastOpcode ?? '∅'} imm=${frame.lastImmediate ?? '∅'}`;
  });

  return lines.join('\n');
}

export class PlaybackController {
  private state: PlaybackState;

  constructor(frames: readonly Frame[]) {
    this.state = {
      mode: 'paused',
      cursor: 0,
      frames
    };
  }

  snapshot(): PlaybackState {
    return this.state;
  }

  setMode(mode: PlaybackMode): PlaybackState {
    this.state = {
      ...this.state,
      mode
    };

    return this.state;
  }

  stepForward(count = 1): PlaybackState {
    const maxIndex = Math.max(this.state.frames.length - 1, 0);
    const nextCursor = Math.min(maxIndex, this.state.cursor + Math.max(1, count));

    this.state = {
      ...this.state,
      cursor: nextCursor,
      mode: 'single-step'
    };

    return this.state;
  }

  seek(cursor: number): PlaybackState {
    const boundedCursor = Math.max(0, Math.min(this.state.frames.length - 1, Math.trunc(cursor)));
    this.state = {
      ...this.state,
      cursor: Number.isFinite(boundedCursor) ? boundedCursor : 0
    };

    return this.state;
  }

  currentFrame(): Frame {
    return this.state.frames[this.state.cursor] ?? createInitialFrame();
  }
}

function createInitialFrame(): Frame {
  return {
    tick: 0,
    pc: null,
    halted: false,
    haltReason: null,
    stackDepth: 0,
    callDepth: 0,
    topOfStack: null,
    registers: {
      a: 0,
      l: 0,
      q: 0,
      z: 0
    },
    lastOpcode: null,
    lastImmediate: null
  };
}

function isRegisterName(value: unknown): value is VmRegisterName {
  return value === 'a' || value === 'l' || value === 'q' || value === 'z';
}
