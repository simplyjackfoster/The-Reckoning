# Dead Reckoning helpers

## `extract-guidance.ts`

Extracts interpretive-opcode lines from key Luminary 099 powered-descent files and writes structured JSON for annotation processing.

The extractor recognizes both `INTPRET` and `INTPRETX` entry points (`TC` and `TCF` calls), so it can capture interpretive sections that use the indexed entry trampoline.

### Usage

```bash
bun scripts/extract-guidance.ts
bun scripts/extract-guidance.ts --output artifacts/guidance-lines.json
```
