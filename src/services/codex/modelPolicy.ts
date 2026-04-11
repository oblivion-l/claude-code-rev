export type CodexModelPolicy = {
  model: string
  supportsStructuredOutput: boolean
  supportsRemoteMcpTools: boolean
  supportsLocalFunctionTools: boolean
  supportsMixedTooling: boolean
}

type CodexModelCapabilityKey =
  | 'supportsStructuredOutput'
  | 'supportsRemoteMcpTools'
  | 'supportsLocalFunctionTools'
  | 'supportsMixedTooling'

export type CodexModelCapabilityRegistry = {
  [Key in CodexModelCapabilityKey]: readonly string[]
}

const DEFAULT_CODEX_MODEL_POLICY: Omit<CodexModelPolicy, 'model'> = {
  supportsStructuredOutput: false,
  supportsRemoteMcpTools: true,
  supportsLocalFunctionTools: true,
  supportsMixedTooling: true,
}

const CODEX_MODEL_CAPABILITY_REGISTRY: CodexModelCapabilityRegistry = {
  supportsStructuredOutput: [
    'gpt-5-codex',
    'gpt-5.1-codex',
    'gpt-5.1-codex-max',
    'gpt-5.2-codex',
    'gpt-5.3-codex',
    'gpt-5.4',
    'gpt-5',
  ],
  supportsRemoteMcpTools: [],
  supportsLocalFunctionTools: [],
  supportsMixedTooling: [],
}

export function getCodexModelCapabilityRegistry(): CodexModelCapabilityRegistry {
  return {
    supportsStructuredOutput: [
      ...CODEX_MODEL_CAPABILITY_REGISTRY.supportsStructuredOutput,
    ],
    supportsRemoteMcpTools: [
      ...CODEX_MODEL_CAPABILITY_REGISTRY.supportsRemoteMcpTools,
    ],
    supportsLocalFunctionTools: [
      ...CODEX_MODEL_CAPABILITY_REGISTRY.supportsLocalFunctionTools,
    ],
    supportsMixedTooling: [
      ...CODEX_MODEL_CAPABILITY_REGISTRY.supportsMixedTooling,
    ],
  }
}

function modelMatchesCapabilityPrefix(
  model: string,
  prefixes: readonly string[],
): boolean {
  return prefixes.some(prefix => model.startsWith(prefix))
}

export function modelSupportsCodexStructuredOutput(model: string): boolean {
  return getCodexModelPolicy(model).supportsStructuredOutput
}

export function getCodexModelPolicy(model: string): CodexModelPolicy {
  const registry = getCodexModelCapabilityRegistry()

  return {
    model,
    ...DEFAULT_CODEX_MODEL_POLICY,
    supportsStructuredOutput: modelMatchesCapabilityPrefix(
      model,
      registry.supportsStructuredOutput,
    )
      ? true
      : DEFAULT_CODEX_MODEL_POLICY.supportsStructuredOutput,
    supportsRemoteMcpTools: modelMatchesCapabilityPrefix(
      model,
      registry.supportsRemoteMcpTools,
    )
      ? true
      : DEFAULT_CODEX_MODEL_POLICY.supportsRemoteMcpTools,
    supportsLocalFunctionTools: modelMatchesCapabilityPrefix(
      model,
      registry.supportsLocalFunctionTools,
    )
      ? true
      : DEFAULT_CODEX_MODEL_POLICY.supportsLocalFunctionTools,
    supportsMixedTooling: modelMatchesCapabilityPrefix(
      model,
      registry.supportsMixedTooling,
    )
      ? true
      : DEFAULT_CODEX_MODEL_POLICY.supportsMixedTooling,
  }
}
