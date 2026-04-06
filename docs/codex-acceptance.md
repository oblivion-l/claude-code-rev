# Codex Acceptance

This document is the release-acceptance checklist for the headless Codex path.

Scope of acceptance:

- headless `--print` only
- single-turn prompts only
- optional `--json-schema` structured outputs
- no REPL changes
- no multi-turn or resume changes
- no MCP or tool orchestration changes

## Environment

Required:

```bash
cd /home/qwer/claude-code-rev

bun --version
node --version
```

Expected:

- `bun` is installed and available on `PATH`
- Node.js is available

Set runtime variables:

```bash
export CLAUDE_CODE_USE_CODEX=1
export OPENAI_API_KEY=your_api_key
export CODEX_MODEL=gpt-5-codex
```

Optional:

```bash
export OPENAI_BASE_URL=https://api.openai.com/v1
export OPENAI_ORG_ID=org_123
export OPENAI_PROJECT_ID=proj_123
```

## Preflight

Run:

```bash
bun test
bun run version
bun run dev --help
```

Expected:

- tests pass
- CLI version prints successfully
- help output renders successfully

## Acceptance Commands

### 1. Plain text success path

Run:

```bash
bun run dev -p "Explain the repository structure"
```

Expected:

- command exits `0`
- text is streamed or printed normally
- no Codex schema validation errors appear

### 2. JSON final result success path

Run:

```bash
bun run dev -p --output-format json "List the top risks in this codebase"
```

Expected:

- command exits `0`
- final output is one JSON result object
- `subtype` is `success`

### 3. Structured output success path

Run:

```bash
bun run dev -p \
  --json-schema '{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"],"additionalProperties":false}' \
  "Return a JSON object with summary"
```

Expected:

- command exits `0`
- final output is valid JSON text matching the schema
- no validation error is printed

### 4. Structured output stream-json success path

Run:

```bash
bun run dev -p \
  --output-format stream-json \
  --verbose \
  --json-schema '{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"],"additionalProperties":false}' \
  "Return a JSON object with summary"
```

Expected:

- command exits `0`
- output stream includes normal streaming events
- final stream includes a `system` event with subtype `codex_json_schema`
- that event contains `parsed_result`
- final result event has `subtype: "success"`

### 5. Local allowlist fail-fast path

Run:

```bash
CODEX_MODEL=gpt-4o-mini \
bun run dev -p \
  --json-schema '{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"],"additionalProperties":false}' \
  "Return a JSON object with summary"
```

Expected:

- command exits non-zero
- request fails before a successful Codex structured-output request is made
- error message includes:
  `Model ... is not enabled for Codex --json-schema mode in this CLI build`

### 6. Invalid JSON schema fail-fast path

Run:

```bash
bun run dev -p \
  --json-schema '{"type":"object","properties":"broken"}' \
  "Return a JSON object with summary"
```

Expected:

- command exits non-zero
- error message includes:
  `Invalid JSON Schema for --json-schema`

### 7. API-side structured-output rejection path

Run:

Use a model/base URL combination that reaches the API but does not accept
`text.format` for this request.

Expected:

- command exits non-zero
- error message is more specific than a generic HTTP error
- error message includes one of:
  - `Codex model ... is not supported for this request`
  - `Codex structured outputs are not supported for model ... or this API parameter set`
  - `Codex structured output request was rejected by the API for model ...`

## Error Reference

| Error text | Meaning | Suggested action |
| --- | --- | --- |
| `Codex provider requires OPENAI_API_KEY when CLAUDE_CODE_USE_CODEX=1.` | Missing API key | Set `OPENAI_API_KEY` |
| `Model ... is not enabled for Codex --json-schema mode in this CLI build` | Local structured-output allowlist rejected the selected model | Use `CODEX_MODEL=gpt-5-codex` or another explicitly supported Codex/GPT-5 model |
| `Codex model ... is not supported for this request` | API explicitly rejected the model or model capability | Change model or feature combination |
| `Codex structured outputs are not supported for model ... or this API parameter set` | API explicitly rejected `text.format` or related structured-output parameters | Change model/backend/path or disable `--json-schema` |
| `Codex structured output request was rejected by the API for model ...` | API rejected a structured-output request, but not via the specific unsupported-parameter branch | Simplify schema or adjust model/backend |
| `Invalid JSON Schema for --json-schema` | Local schema compilation failed | Fix schema shape |
| `Codex structured output is not valid JSON` | Model returned non-JSON text | Tighten prompt and request shape |
| `Codex structured output does not match the provided schema` | Returned JSON failed local schema validation | Fix prompt or schema |

## Rollback

Runtime rollback:

```bash
unset CLAUDE_CODE_USE_CODEX
```

Expected:

- CLI returns to the existing Claude/Anthropic headless path
- no Codex-specific request path is used

Git rollback for the Codex acceptance-related changes only:

```bash
git log --oneline -- docs/codex-provider.md docs/codex-acceptance.md src/services/codex
```

Revert only the relevant Codex commits if needed. Do not revert unrelated
Anthropic or CLI commits.
