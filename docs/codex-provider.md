# Codex Provider

This repository now includes a minimal Codex provider path for headless CLI
usage.

The integration is intentionally narrow in scope:

- it does not replace the existing Claude/Anthropic provider stack
- it does not change the existing command tree or CLI bootstrap
- it only activates when an explicit environment flag is enabled
- it only supports single-turn `--print` text requests in this first phase

## What It Supports

- `claude -p "question"` style one-shot prompts
- streaming text output to stdout
- `--output-format stream-json --verbose` streaming events plus a final result
- `--output-format json` final result output
- `--system-prompt` and `--append-system-prompt`

## What It Does Not Support Yet

- interactive REPL mode
- resume / continue / rewind / fork session flows
- `--input-format stream-json`
- tool calling through the existing tool orchestration pipeline
- MCP / agent workflows
- structured output via `--json-schema`

Unsupported combinations fail fast with a direct error message instead of
silently falling back to another path.

## Enable It

Set the following environment variables before running the CLI:

```bash
export CLAUDE_CODE_USE_CODEX=1
export OPENAI_API_KEY=your_api_key
```

Optional variables:

```bash
export CODEX_MODEL=gpt-5-codex
export OPENAI_BASE_URL=https://api.openai.com/v1
export OPENAI_ORG_ID=org_123
export OPENAI_PROJECT_ID=proj_123
```

`CODEX_MODEL` falls back to `OPENAI_MODEL`, then to `gpt-5-codex`.

## Usage Examples

Plain text streaming:

```bash
bun run dev -p "Explain the repository structure"
```

Stream JSON events:

```bash
bun run dev -p --output-format stream-json --verbose "Summarize src/cli/print.ts"
```

JSON final result:

```bash
bun run dev -p --output-format json "List the top risks in this codebase"
```

## Rollback

To return to the previous behavior, unset the feature flag:

```bash
unset CLAUDE_CODE_USE_CODEX
```

Once the flag is unset, `--print` returns to the existing Claude provider path.

## Implementation Notes

The Codex path is routed in the headless CLI entry at
`src/cli/print.ts`.

The provider-specific implementation lives under `src/services/codex`.

This keeps the change isolated and makes later expansion possible without
rewriting the existing query loop in one step.
