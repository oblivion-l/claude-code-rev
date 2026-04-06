import { describe, expect, it } from 'bun:test'
import {
  compileCodexJsonSchema,
  validateCodexStructuredOutput,
} from './schema.js'

describe('compileCodexJsonSchema', () => {
  it('compiles a valid schema for a supported model', () => {
    const compiled = compileCodexJsonSchema({
      model: 'gpt-5-codex',
      jsonSchema: {
        title: 'ReviewResult',
        type: 'object',
        properties: {
          summary: { type: 'string' },
        },
        required: ['summary'],
        additionalProperties: false,
      },
    })

    expect(compiled.format).toMatchObject({
      type: 'json_schema',
      name: 'reviewresult',
      strict: true,
    })
  })

  it('fails fast for an invalid schema', () => {
    expect(() =>
      compileCodexJsonSchema({
        model: 'gpt-5-codex',
        jsonSchema: {
          type: 'object',
          properties: 'invalid',
        } as unknown as Record<string, unknown>,
      }),
    ).toThrow('Invalid JSON Schema for --json-schema')
  })
})

describe('validateCodexStructuredOutput', () => {
  const compiled = compileCodexJsonSchema({
    model: 'gpt-5-codex',
    jsonSchema: {
      title: 'StructuredAnswer',
      type: 'object',
      properties: {
        answer: { type: 'string' },
        score: { type: 'number' },
      },
      required: ['answer'],
      additionalProperties: false,
    },
  })

  it('accepts valid JSON that matches the schema', () => {
    const result = validateCodexStructuredOutput({
      rawText: '{"answer":"ok","score":1}',
      validate: compiled.validate,
    })

    expect(result).toEqual({
      ok: true,
      parsedResult: {
        answer: 'ok',
        score: 1,
      },
      rawText: '{"answer":"ok","score":1}',
    })
  })

  it('rejects invalid JSON', () => {
    const result = validateCodexStructuredOutput({
      rawText: '{"answer":',
      validate: compiled.validate,
    })

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error('Expected validation failure')
    }
    expect(result.code).toBe('invalid_json')
    expect(result.error).toContain('not valid JSON')
  })

  it('rejects JSON that fails schema validation', () => {
    const result = validateCodexStructuredOutput({
      rawText: '{"answer":42}',
      validate: compiled.validate,
    })

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error('Expected validation failure')
    }
    expect(result.code).toBe('schema_mismatch')
    expect(result.error).toContain('does not match the provided schema')
  })
})
