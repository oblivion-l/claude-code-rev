import { Ajv } from 'ajv'
import type { ErrorObject, ValidateFunction } from 'ajv'
import type { CodexStructuredOutputFormat } from './types.js'

const STRUCTURED_OUTPUT_MODEL_PREFIXES = [
  'gpt-5-codex',
  'gpt-5.1-codex',
  'gpt-5.1-codex-max',
  'gpt-5.2-codex',
  'gpt-5.3-codex',
  'gpt-5.4',
  'gpt-5',
] as const

type SchemaValidationResult =
  | {
      ok: true
      parsedResult: unknown
      rawText: string
    }
  | {
      ok: false
      error: string
      code: 'invalid_json' | 'schema_mismatch'
      rawText: string
    }

export type CompiledCodexJsonSchema = {
  format: CodexStructuredOutputFormat
  validate: ValidateFunction
}

function sanitizeSchemaName(name: string): string {
  const sanitized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')

  return (sanitized || 'claude_code_output').slice(0, 64)
}

function getSchemaName(jsonSchema: Record<string, unknown>): string {
  if (typeof jsonSchema.title === 'string' && jsonSchema.title.trim()) {
    return sanitizeSchemaName(jsonSchema.title)
  }

  return 'claude_code_output'
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) {
    return 'Unknown schema validation error'
  }

  return errors
    .map(error => `${error.instancePath || 'root'}: ${error.message}`)
    .join(', ')
}

export function modelSupportsCodexStructuredOutput(model: string): boolean {
  return STRUCTURED_OUTPUT_MODEL_PREFIXES.some(prefix =>
    model.startsWith(prefix),
  )
}

export function compileCodexJsonSchema({
  jsonSchema,
  model,
}: {
  jsonSchema: Record<string, unknown>
  model: string
}): CompiledCodexJsonSchema {
  if (!modelSupportsCodexStructuredOutput(model)) {
    throw new Error(
      `Model ${model} is not enabled for Codex --json-schema mode in this CLI build. Use a structured-output-capable Codex/GPT-5 model, or unset CLAUDE_CODE_USE_CODEX.`,
    )
  }

  const ajv = new Ajv({ allErrors: true, strict: false })
  const isValidSchema = ajv.validateSchema(jsonSchema)
  if (!isValidSchema) {
    throw new Error(
      `Invalid JSON Schema for --json-schema: ${ajv.errorsText(ajv.errors)}`,
    )
  }

  let validate: ValidateFunction
  try {
    validate = ajv.compile(jsonSchema)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to compile JSON Schema for --json-schema: ${message}`)
  }

  return {
    format: {
      type: 'json_schema',
      name: getSchemaName(jsonSchema),
      schema: jsonSchema,
      strict: true,
    },
    validate,
  }
}

export function validateCodexStructuredOutput({
  rawText,
  validate,
}: {
  rawText: string
  validate: ValidateFunction
}): SchemaValidationResult {
  let parsedResult: unknown

  try {
    parsedResult = JSON.parse(rawText)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      code: 'invalid_json',
      error: `Codex structured output is not valid JSON: ${message}`,
      rawText,
    }
  }

  if (!validate(parsedResult)) {
    return {
      ok: false,
      code: 'schema_mismatch',
      error: `Codex structured output does not match the provided schema: ${formatAjvErrors(validate.errors)}`,
      rawText,
    }
  }

  return {
    ok: true,
    parsedResult,
    rawText,
  }
}
