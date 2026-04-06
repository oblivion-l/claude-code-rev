# Codex Provider

This repository now includes a minimal Codex provider path for headless CLI
usage.

The integration is intentionally narrow in scope:

- it does not replace the existing Claude/Anthropic provider stack
- it does not change the existing command tree or CLI bootstrap
- it only activates when an explicit environment flag is enabled
- it only supports headless `--print` requests in this phase, with same-process `--continue` as a minimal extension

## What It Supports

- `claude -p "question"` style one-shot prompts
- streaming text output to stdout
- `--output-format stream-json --verbose` streaming events plus a final result
- `--output-format json` final result output
- `--system-prompt` and `--append-system-prompt`
- `--json-schema` strict structured output validation for single-turn headless requests
- same-process `--continue` when an in-memory Codex conversation state already exists

## What It Does Not Support Yet

- interactive REPL mode
- `--resume`, `--resume-session-at`, rewind, or fork session flows
- cross-process conversation recovery for `--continue`
- `--input-format stream-json`
- tool calling through the existing tool orchestration pipeline
- MCP / agent workflows
- interactive tool use or agent orchestration inside a structured-output turn

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

Structured output with `--json-schema`:

```bash
bun run dev -p \
  --json-schema '{"type":"object","properties":{"summary":{"type":"string"},"risk":{"type":"string"}},"required":["summary"],"additionalProperties":false}' \
  "Summarize this repository as JSON"
```

Structured output with stream-json:

```bash
bun run dev -p \
  --output-format stream-json \
  --verbose \
  --json-schema '{"type":"object","properties":{"files":{"type":"array","items":{"type":"string"}}},"required":["files"],"additionalProperties":false}' \
  "Return the main source files as JSON"
```

## Acceptance Checks

For the release acceptance checklist and command-by-command expectations, see
[codex-acceptance.md](./codex-acceptance.md).

When `--json-schema` is enabled:

- the CLI sends the schema to the Codex Responses API using strict structured output mode
- the final response is parsed as JSON locally
- the parsed JSON is validated against the provided schema
- validation failures return a non-zero exit code
- in `stream-json` mode, a final `system` event with subtype `codex_json_schema` is emitted and contains either `parsed_result` or `validation_error`

When `--continue` is enabled:

- Codex only supports continue within the same process
- the provider requires an in-memory prior response id from an earlier Codex headless request
- starting a fresh CLI process does not restore this state
- `--resume` and `--resume-session-at` still fail fast

## Common Errors

`Invalid JSON Schema for --json-schema`

- The schema could not be compiled locally.
- Check for malformed JSON Schema fields such as invalid `properties`, invalid `type`, or broken nested schema objects.

`Model ... is not enabled for Codex --json-schema mode in this CLI build`

- The selected model is outside the current allowlist for this MVP.
- Use `CODEX_MODEL=gpt-5-codex` unless you have explicitly verified another supported Codex/GPT-5 model.

`Codex model ... is not supported for this request`

- The request reached the API, but the API explicitly rejected the model.
- This is more specific than the local allowlist error: it means the backend
  itself rejected the selected model or model capability.

`Codex structured outputs are not supported for model ... or this API parameter set`

- The request reached the API, but the API explicitly rejected `text.format`
  or a closely related structured-output parameter.
- This usually means the model/backend combination does not support structured
  outputs on the Responses API path you are using.

`Codex structured output is not valid JSON`

- The model returned text that could not be parsed as JSON.
- Tighten the prompt and keep the response target narrow.

`Codex structured output does not match the provided schema`

- The model returned JSON, but the object failed local schema validation.
- Check required fields, field types, and `additionalProperties`.

`Codex provider continue requested but no in-process conversation state is available. Continue only works within the same process.`

- `--continue` was used without an in-memory Codex response chain.
- This is expected after starting a new process or before any earlier Codex headless request has completed.

`Codex provider does not support --resume or --resume-session-at in this mode. Use a fresh request, or use --continue within the same process when conversation state is available.`

- `--resume` and `--resume-session-at` remain unsupported on the Codex headless path.
- Use a fresh request, or only use `--continue` when staying inside the same process.

API-side schema rejection or unsupported keyword errors

- This means the schema compiled locally but was rejected by the OpenAI API's structured output subset.
- Remove unsupported keywords or simplify the schema shape.

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
