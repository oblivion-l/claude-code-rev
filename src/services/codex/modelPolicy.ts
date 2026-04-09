export type CodexModelPolicy = {
  model: string
  supportsStructuredOutput: boolean
  supportsRemoteMcpTools: boolean
  supportsLocalFunctionTools: boolean
  supportsMixedTooling: boolean
}

type CodexModelPolicyOverride = {
  matchPrefix: string
  override: Partial<Omit<CodexModelPolicy, 'model'>>
}

const DEFAULT_CODEX_MODEL_POLICY: Omit<CodexModelPolicy, 'model'> = {
  supportsStructuredOutput: false,
  supportsRemoteMcpTools: true,
  supportsLocalFunctionTools: true,
  supportsMixedTooling: true,
}

const CODEX_MODEL_POLICY_OVERRIDES: CodexModelPolicyOverride[] = [
  {
    matchPrefix: 'gpt-5-codex',
    override: {
      supportsStructuredOutput: true,
    },
  },
  {
    matchPrefix: 'gpt-5.1-codex',
    override: {
      supportsStructuredOutput: true,
    },
  },
  {
    matchPrefix: 'gpt-5.1-codex-max',
    override: {
      supportsStructuredOutput: true,
    },
  },
  {
    matchPrefix: 'gpt-5.2-codex',
    override: {
      supportsStructuredOutput: true,
    },
  },
  {
    matchPrefix: 'gpt-5.3-codex',
    override: {
      supportsStructuredOutput: true,
    },
  },
  {
    matchPrefix: 'gpt-5.4',
    override: {
      supportsStructuredOutput: true,
    },
  },
  {
    matchPrefix: 'gpt-5',
    override: {
      supportsStructuredOutput: true,
    },
  },
]

export function getCodexModelPolicyOverrides(): CodexModelPolicyOverride[] {
  return [...CODEX_MODEL_POLICY_OVERRIDES]
}

function resolveCodexModelPolicyOverride(
  model: string,
): Partial<Omit<CodexModelPolicy, 'model'>> {
  return (
    CODEX_MODEL_POLICY_OVERRIDES.find(override =>
      model.startsWith(override.matchPrefix),
    )?.override ?? {}
  )
}

export function modelSupportsCodexStructuredOutput(model: string): boolean {
  return getCodexModelPolicy(model).supportsStructuredOutput
}

export function getCodexModelPolicy(model: string): CodexModelPolicy {
  return {
    model,
    ...DEFAULT_CODEX_MODEL_POLICY,
    ...resolveCodexModelPolicyOverride(model),
  }
}
