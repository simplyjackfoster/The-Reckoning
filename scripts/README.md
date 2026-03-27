# Dead Reckoning helpers

## `extract-guidance.ts`

Extracts interpretive-opcode lines from key Luminary 099 powered-descent files and writes structured JSON for annotation processing.

The extractor recognizes both `INTPRET` and `INTPRETX` entry points (`TC` and `TCF` calls), so it can capture interpretive sections that use the indexed entry trampoline.

### Usage

```bash
bun scripts/extract-guidance.ts
bun scripts/extract-guidance.ts --output artifacts/powered-descent-trace-seed.json
```

## `run-guidance-slice.ts`

Builds workspaces, runs the guidance slice through runtime + visualizer integration, and prints execution metrics plus a compact ASCII timeline. The CLI also reports compiler warnings for unresolved/missing control-flow targets so runs remain debuggable without hard failure.

### Usage

```bash
bun scripts/run-guidance-slice.ts
bun scripts/run-guidance-slice.ts --input artifacts/powered-descent-trace-seed.json --limit 500
bun scripts/run-guidance-slice.ts --timeline 20 --replay-out artifacts/latest-replay.json
```

### Flags

- `--input`, `-i`: Guidance-line JSON input file.
- `--limit`, `-n`: Number of lines to compile from input.
- `--max-steps`, `-m`: VM execution step budget.
- `--timeline`, `-t`: Number of recent frames rendered in the ASCII timeline.
- `--replay-out`, `-r`: Optional path to write serialized replay log JSON.
