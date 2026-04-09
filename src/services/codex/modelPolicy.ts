export type CodexModelPolicy = {
  model: string
  supportsStructuredOutput: boolean
  supportsRemoteMcpTools: boolean
  supportsLocalFunctionTools: boolean
  supportsMixedTooling: boolean
}

const STRUCTURED_OUTPUT_MODEL_PREFIXES = [
  'gpt-5-codex',
  'gpt-5.1-codex',
  'gpt-5.1-codex-max',
  'gpt-5.2-codex',
  'gpt-5.3-codex',
  'gpt-5.4',
  'gpt-5',
] as const

export function modelSupportsCodexStructuredOutput(model: string): boolean {
  return STRUCTURED_OUTPUT_MODEL_PREFIXES.some(prefix =>
    model.startsWith(prefix),
  )
}

export function getCodexModelPolicy(model: string): CodexModelPolicy {
  return {
    model,
    supportsStructuredOutput: modelSupportsCodexStructuredOutput(model),
    supportsRemoteMcpTools: true,
    supportsLocalFunctionTools: true,
    supportsMixedTooling: true,
  }
}
