#!/usr/bin/env bash

set -u

MODE='full'
DRY_RUN=0
CASE_TIMEOUT_SECONDS="${CASE_TIMEOUT_SECONDS:-45}"

usage() {
  cat <<'EOF'
Usage: bash scripts/codex-acceptance.sh [--dry-run] [--quick|--full]

Options:
  --dry-run  Print the commands that would run without executing them
  --quick    Run preflight checks plus the core happy path only
  --full     Run the full scripted acceptance checklist
  --help     Show this help text
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --quick)
      MODE='quick'
      shift
      ;;
    --full)
      MODE='full'
      shift
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

PASS_COUNT=0
FAIL_COUNT=0
TOTAL_COUNT=0
FAILED_CASE_LABELS=()
FAILED_CASE_REPAIRS=()

DEFAULT_CODEX_MODEL="${CODEX_MODEL:-gpt-5-codex}"
export CLAUDE_CODE_USE_CODEX=1
export CODEX_MODEL="${DEFAULT_CODEX_MODEL}"

print_env_summary() {
  echo "Repository: ${REPO_ROOT}"
  echo "Mode: ${MODE}"
  echo "Dry run: ${DRY_RUN}"
  echo "Case timeout seconds: ${CASE_TIMEOUT_SECONDS}"
  echo "CLAUDE_CODE_USE_CODEX: ${CLAUDE_CODE_USE_CODEX}"
  echo "CODEX_MODEL: ${CODEX_MODEL}"
  if [[ -n "${OPENAI_BASE_URL:-}" ]]; then
    echo "OPENAI_BASE_URL: ${OPENAI_BASE_URL}"
  fi
}

require_runtime_env() {
  if [[ ${DRY_RUN} -eq 1 ]]; then
    return 0
  fi

  if [[ -z "${OPENAI_API_KEY:-}" ]]; then
    echo "Error: OPENAI_API_KEY is required for Codex acceptance runs." >&2
    echo "Set OPENAI_API_KEY, then rerun the script." >&2
    exit 2
  fi
}

print_case_header() {
  local label="$1"
  local cmd="$2"

  echo
  echo "== ${label} =="
  echo "Command: ${cmd}"
}

record_result() {
  local passed="$1"
  local exit_code="$2"
  local label="$3"
  local repair_hint="$4"

  TOTAL_COUNT=$((TOTAL_COUNT + 1))

  if [[ "${passed}" -eq 1 ]]; then
    PASS_COUNT=$((PASS_COUNT + 1))
    echo "Exit code: ${exit_code}"
    echo "Result: PASS"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo "Exit code: ${exit_code}"
    echo "Result: FAIL"
    FAILED_CASE_LABELS+=("${label}")
    FAILED_CASE_REPAIRS+=("${repair_hint}")
  fi
}

run_case() {
  local label="$1"
  local expected_exit="$2"
  local expect_pattern="$3"
  local cmd="$4"
  local repair_hint="${5:-Check the failing command output and rerun the matching local test or CLI step.}"

  print_case_header "${label}" "${cmd}"

  if [[ ${DRY_RUN} -eq 1 ]]; then
    TOTAL_COUNT=$((TOTAL_COUNT + 1))
    echo "Exit code: DRY-RUN"
    echo "Result: PASS"
    PASS_COUNT=$((PASS_COUNT + 1))
    return 0
  fi

  local output_file
  output_file="$(mktemp)"

  timeout "${CASE_TIMEOUT_SECONDS}s" \
    bash -lc "cd '$REPO_ROOT' && ${cmd}" >"${output_file}" 2>&1
  local exit_code=$?

  local passed=0

  if [[ "${expected_exit}" == 'nonzero' ]]; then
    if [[ "${exit_code}" -ne 0 ]]; then
      if [[ -z "${expect_pattern}" ]]; then
        passed=1
      elif grep -Eq "${expect_pattern}" "${output_file}"; then
        passed=1
      fi
    fi
  elif [[ "${exit_code}" -eq "${expected_exit}" ]]; then
    if [[ -z "${expect_pattern}" ]]; then
      passed=1
    elif grep -Eq "${expect_pattern}" "${output_file}"; then
      passed=1
    fi
  fi

  record_result "${passed}" "${exit_code}" "${label}" "${repair_hint}"

  if [[ "${passed}" -eq 0 ]]; then
    echo "Output:"
    sed -n '1,80p' "${output_file}"
    echo "Suggested fix: ${repair_hint}"
  fi

  rm -f "${output_file}"
}

run_preflight() {
  run_case 'Preflight: bun version' 0 '' 'bun --version'
  run_case 'Preflight: node version' 0 '' 'node --version'
  run_case 'Preflight: bun test' 0 '' 'bun test'
  run_case 'Preflight: cli version' 0 '' 'bun run version'
  run_case 'Preflight: cli help' 0 '' 'bun run dev --help'
}

run_happy_path() {
  run_case \
    'Happy path: plain text prompt' \
    0 \
    'OK' \
    "bun run dev -p 'Reply with OK only. Do not use any tools. Do not inspect files. Output exactly OK.'" \
    'Verify OPENAI_API_KEY/baseUrl/model first, then rerun the plain text prompt.'

  run_case \
    'Happy path: json output' \
    0 \
    '\"subtype\":\"success\"|\"result\":\"OK\"' \
    "bun run dev -p --output-format json 'Reply with OK only. Do not use any tools. Do not inspect files. Output exactly OK.'" \
    'Re-run with --output-format json and inspect provider config plus stdout contract changes.'

  run_case \
    'Happy path: structured output' \
    0 \
    '\"summary\":\"OK\"' \
    "bun run dev -p --json-schema '{\"type\":\"object\",\"properties\":{\"summary\":{\"type\":\"string\"}},\"required\":[\"summary\"],\"additionalProperties\":false}' 'Return exactly this JSON object and nothing else: {\"summary\":\"OK\"}'" \
    'Check structured-output model policy and schema validation before rerunning.'

  run_case \
    'Happy path: structured output stream-json' \
    0 \
    'codex_json_schema|parsed_result|\"summary\":\"OK\"' \
    "bun run dev -p --output-format stream-json --verbose --json-schema '{\"type\":\"object\",\"properties\":{\"summary\":{\"type\":\"string\"}},\"required\":[\"summary\"],\"additionalProperties\":false}' 'Return exactly this JSON object and nothing else: {\"summary\":\"OK\"}'" \
    'Inspect stream-json system events and schema validation output for regressions.'
}

run_fail_fast() {
  run_case \
    'Fail-fast: local allowlist' \
    'nonzero' \
    'Model .* is not enabled for Codex --json-schema mode in this CLI build' \
    "CODEX_MODEL=gpt-4o-mini bun run dev -p --json-schema '{\"type\":\"object\",\"properties\":{\"summary\":{\"type\":\"string\"}},\"required\":[\"summary\"],\"additionalProperties\":false}' 'Return a JSON object with summary'" \
    'Restore a supported CODEX_MODEL or update the structured-output allowlist expectation.'

  run_case \
    'Fail-fast: invalid json schema' \
    'nonzero' \
    'Invalid JSON Schema for --json-schema' \
    "bun run dev -p --json-schema '{\"type\":\"object\",\"properties\":\"broken\"}' 'Return a JSON object with summary'" \
    'Fix the JSON Schema payload or rerun the schema compiler tests.'

  run_case \
    'Fail-fast: continue without state' \
    'nonzero' \
    'Codex provider continue requested but no persisted conversation state is available for the current directory\.' \
    "bun run dev -p --continue 'Follow up on the prior answer'" \
    'Check persisted-state scanning and sessionText wording before rerunning.'

  run_case \
    'Fail-fast: resume without persisted state' \
    'nonzero' \
    'Codex provider resume requested but no persisted conversation state is available\.' \
    "bun run dev -p --resume 'Follow up on the prior answer'" \
    'Check resume fail-fast wording and persisted-state availability handling.'
}

run_targeted_proxies() {
  run_case \
    'Proxy: REPL session and slash command coverage' \
    0 \
    '' \
    'bun test ./src/services/codex/runReplCodex.test.ts' \
    'Inspect REPL slash command, MCP status, and resume tests.'

  run_case \
    'Proxy: MCP mapping and diagnostics coverage' \
    0 \
    '' \
    'bun test ./src/services/codex/mcp.test.ts' \
    'Inspect MCP config mapping, bridge passthrough rules, and diagnostics expectations.'

  run_case \
    'Proxy: ToolSearch and deferred tooling coverage' \
    0 \
    '' \
    'bun test ./src/services/codex/toolBridge.test.ts ./src/services/codex/orchestration.test.ts' \
    'Inspect deferred tool selection, priority, and mixed-tooling matrix tests.'

  run_case \
    'Proxy: Windows diagnostics coverage' \
    0 \
    '' \
    'bun test ./src/services/codex/windowsDiagnostics.test.ts ./src/services/codex/windowsLaunchers.test.ts' \
    'Inspect Windows launcher diagnostics, selfcheck hints, and launcher-dir error handling.'

  run_case \
    'Proxy: Windows selfcheck local mode' \
    0 \
    'Codex 自检结果：|PASS|汇总：' \
    'bun run codex:selfcheck --skip-api' \
    'Run codex:selfcheck --skip-api directly and inspect bun/node/config diagnostics.'
}

print_summary() {
  echo
  echo '== Summary =='
  echo "Mode profile: ${MODE}"
  echo "Passed: ${PASS_COUNT}"
  echo "Failed: ${FAIL_COUNT}"
  echo "Total: ${TOTAL_COUNT}"

  if [[ "${FAIL_COUNT}" -gt 0 ]]; then
    echo
    echo 'Failed cases with suggested fixes:'
    local index
    for ((index = 0; index < ${#FAILED_CASE_LABELS[@]}; index += 1)); do
      echo "- ${FAILED_CASE_LABELS[$index]}"
      echo "  repair: ${FAILED_CASE_REPAIRS[$index]}"
    done
  fi
}

main() {
  print_env_summary
  require_runtime_env
  run_preflight
  run_happy_path

  if [[ "${MODE}" == 'full' ]]; then
    run_targeted_proxies
    run_fail_fast
  fi

  print_summary

  if [[ "${FAIL_COUNT}" -gt 0 ]]; then
    exit 1
  fi
}

main
