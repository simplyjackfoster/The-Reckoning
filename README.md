# Dead Reckoning (MVP)

Dead Reckoning is a TypeScript monorepo that turns extracted Apollo Guidance Computer
interpretive lines into a runnable guidance simulation pipeline:

1. **extract** interpretive opcode lines from Luminary 099 sources,
2. **compile** them into a compact VM program,
3. **execute** inside an AGC-inspired 15-bit one's-complement VM,
4. **emit replay events** and render a deterministic ASCII timeline.

## MVP status

### What already works

- 15-bit one's-complement arithmetic helpers, opcode encoding, and a deterministic VM core with stack, memory, and call-stack semantics.
- Event stream schema + serialization for replay logs.
- Runtime layer that compiles guidance lines, executes programs, summarizes runtime stats, and verifies deterministic replay.
- Visualizer-side timeline model with playback controls (`paused`, `single-step`, `fixed-rate`, `realtime`) and CLI output.
- End-to-end test coverage across all workspaces.

### Current MVP demo path

```bash
npm install
npm run guidance:extract
npm run guidance:run -- --limit 200 --timeline 12 --replay-out artifacts/latest-replay.json
```

This prints a mission-slice summary, top symbol values, compiler warning summary, and recent execution timeline.

## Why this repo now feels finished as an MVP

- The full extraction → compile → execute → replay → timeline flow is wired together and runnable from root scripts.
- Guidance compiler now degrades malformed/missing control-flow targets into warnings rather than hard-failing the demo path.
- The CLI surfaces compiler warning counts/previews so gaps are visible without breaking execution.

## Repository layout

- `packages/event-stream`: VM event types + replay serialization.
- `packages/vm-core`: AGC-inspired VM core and opcode execution.
- `packages/runtime`: guidance compiler + runtime orchestration utilities.
- `apps/visualizer`: timeline frame builder, playback controller, CLI renderer.
- `scripts/extract-guidance.ts`: builds guidance trace seed artifact from Luminary099 files.
- `scripts/run-guidance-slice.ts`: builds workspaces, runs CLI demo, prints stats.

## Developer commands

```bash
# Build all workspaces
npm run build

# Run all tests
npm test

# Type-check all workspaces
npm run typecheck

# Re-extract guidance artifact
npm run guidance:extract

# Run integrated MVP demo
npm run guidance:run -- --limit 200 --timeline 12
```

## Known polish items (non-blocking)

- Improve extraction fidelity for multi-line interpretive constructs so fewer compiler warnings are emitted.
- Expand opcode mapping fidelity toward historically accurate interpretive semantics.
- Replace ASCII timeline with a browser-rendered panel once the visual runtime is introduced.
