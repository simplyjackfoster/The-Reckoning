# Dead Reckoning Phase 0 Implementation Plan

## Top-level architecture

Dead Reckoning is a TypeScript workspace with strict separation between execution and rendering:

1. `@dead-reckoning/vm-core`: deterministic AGC interpretive VM state machine.
2. `@dead-reckoning/event-stream`: strongly typed execution event protocol.
3. `@dead-reckoning/runtime`: orchestration utilities for controlled execution and replay capture.
4. `@dead-reckoning/visualizer`: renderer-facing adapter that consumes events and maps them into display frames.

This ensures interpreter logic remains pure and testable while rendering can evolve independently.

## Directory structure

```text
.
├─ apps/
│  └─ visualizer/
│     └─ src/
├─ docs/
│  └─ architecture/
│     └─ phase-0-plan.md
├─ packages/
│  ├─ event-stream/
│  │  └─ src/
│  ├─ runtime/
│  │  └─ src/
│  └─ vm-core/
│     └─ src/
├─ Luminary099/
├─ scripts/
├─ package.json
└─ tsconfig.base.json
```

## Module responsibilities

### `packages/event-stream`

- Defines canonical VM event types.
- Provides event sink abstraction.
- Supplies in-memory sink for local execution, tests, and replay serialization.

### `packages/vm-core`

- Owns VM state model (registers, stack, control flow markers).
- Executes one deterministic step at a time.
- Emits events for each observable state transition.

### `packages/runtime`

- Runs VM for bounded step counts.
- Collects event log and final state for deterministic replay.
- Acts as bridge between program source and downstream consumers.

### `apps/visualizer`

- Converts structured events into renderer frames.
- Will later host React + Three scene and timeline controls.

## Data flow: interpreter -> renderer

1. Runtime instantiates VM with an event sink.
2. VM performs `reset` / `step` calls.
3. Each significant action emits typed event objects with monotonic sequence IDs.
4. Runtime returns immutable event array.
5. Visualizer transforms events into frame model (stack/reg snapshots, execution cursor, halt state).
6. Renderer consumes frame model without direct VM coupling.

## Milestone plan

### Phase 1: VM kernel and state primitives

- Expand `VmState` to include AGC-oriented stack + accumulator primitives.
- Add deterministic word normalization helpers.
- Add fixture tests for reset/step invariants.

### Phase 2: Arithmetic and stack behavior

- Implement AGC 1's-complement arithmetic helpers and overflow rules.
- Add push/pop operations as pure transitions.
- Emit stack/register write events for each mutation.

### Phase 3: Opcode execution framework

- Introduce opcode decoding table and instruction handlers.
- Implement minimal opcode subset needed for arithmetic + control flow tests.
- Add deterministic invalid-opcode behavior.

### Phase 4: Structured trace expansion

- Enrich event payload contracts for opcode, operand, and state diffs.
- Add replay serializer/deserializer and deterministic re-run checks.

### Phase 5: Minimal visual pipeline

- Add React + Three.js shell in `apps/visualizer`.
- Render execution cursor, stack columns, and accumulator panel from event-derived frames.

### Phase 6: Mission playback foundation

- Build loader pipeline from AGC source extracts into runnable VM programs.
- Add timeline playback controls and fixed-step scrubbing.
- Keep annotation hooks as typed placeholders only.

## Risks and simplifications

- **Risk: AGC interpretive edge cases are subtle.**
  - Simplification: start with explicit deterministic contracts and tiny verified opcode subset.
- **Risk: event volume could grow quickly.**
  - Simplification: establish typed event schema now and optimize storage later.
- **Risk: renderer coupling to VM internals.**
  - Simplification: renderer consumes only event-derived frame DTOs.
- **Risk: mission data ingestion complexity.**
  - Simplification: delay full parsing and use bounded fixtures through Phase 5.

## TODO inventory

- TODO(phase-1): AGC word model currently aliases `number`; replace with validated opaque type.
- TODO(phase-3): no real opcode decoding yet; current stepping only advances PC.
- TODO(phase-5): visualizer is frame summarization only; no React/Three shell yet.
