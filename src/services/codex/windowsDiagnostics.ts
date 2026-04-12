export type CodexWindowsScriptName =
  | 'setup-codex'
  | 'install-codex'
  | 'install-launchers'
  | 'codex-selfcheck'
  | 'launcher-runtime'

export type CodexWindowsDiagnostic = {
  errorCode: string
  hint: string
  message: string
}

function normalizeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function looksLikePermissionIssue(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('eacces') ||
    normalized.includes('eperm') ||
    normalized.includes('permission denied') ||
    normalized.includes('access is denied')
  )
}

function looksLikePathIssue(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('enoent') ||
    normalized.includes('not found') ||
    normalized.includes('no such file') ||
    normalized.includes('path')
  )
}

export function classifyCodexWindowsScriptError(args: {
  script: CodexWindowsScriptName
  error: unknown
  stepName?: string
}): CodexWindowsDiagnostic {
  const message = normalizeMessage(args.error)

  if (
    message.includes('Missing value for') ||
    message.includes('Unknown argument')
  ) {
    return {
      errorCode: 'CODEX_WINDOWS_INVALID_ARGUMENT',
      hint: 'use-help',
      message,
    }
  }

  if (message.includes('Missing apiKey')) {
    return {
      errorCode: 'CODEX_WINDOWS_SETUP_API_KEY_MISSING',
      hint: 'set-api-key',
      message,
    }
  }

  if (looksLikePermissionIssue(message)) {
    return {
      errorCode: 'CODEX_WINDOWS_PERMISSION_DENIED',
      hint: 'check-permissions',
      message,
    }
  }

  if (looksLikePathIssue(message)) {
    return {
      errorCode: 'CODEX_WINDOWS_PATH_ERROR',
      hint: 'check-path',
      message,
    }
  }

  if (args.script === 'launcher-runtime') {
    return {
      errorCode: 'CODEX_WINDOWS_LAUNCHER_WRITE_FAILED',
      hint: 'check-launcher-dir',
      message,
    }
  }

  if (args.script === 'codex-selfcheck') {
    return {
      errorCode: 'CODEX_WINDOWS_SELFCHECK_FAILED',
      hint: 'run-selfcheck-skip-api',
      message,
    }
  }

  if (args.script === 'install-codex') {
    const normalizedStep = args.stepName?.trim()
    if (normalizedStep === '安装依赖') {
      return {
        errorCode: 'CODEX_WINDOWS_INSTALL_DEPENDENCY_FAILED',
        hint: 'run-bun-install',
        message,
      }
    }

    if (normalizedStep === '生成 Windows launcher') {
      return {
        errorCode: 'CODEX_WINDOWS_INSTALL_LAUNCHER_FAILED',
        hint: 'check-launcher-dir',
        message,
      }
    }

    if (
      normalizedStep === '执行本地自检' ||
      normalizedStep === '执行完整自检'
    ) {
      return {
        errorCode: 'CODEX_WINDOWS_INSTALL_SELFCHECK_FAILED',
        hint: 'run-selfcheck-skip-api',
        message,
      }
    }
  }

  if (args.script === 'setup-codex') {
    return {
      errorCode: 'CODEX_WINDOWS_SETUP_FAILED',
      hint: 'check-config',
      message,
    }
  }

  if (args.script === 'install-launchers') {
    return {
      errorCode: 'CODEX_WINDOWS_INSTALL_LAUNCHERS_FAILED',
      hint: 'check-launcher-dir',
      message,
    }
  }

  return {
    errorCode: 'CODEX_WINDOWS_SCRIPT_FAILED',
    hint: 'retry',
    message,
  }
}

export function formatCodexWindowsScriptError(args: {
  script: CodexWindowsScriptName
  error: unknown
  stepName?: string
}): string {
  const diagnostic = classifyCodexWindowsScriptError(args)
  const stepSegment = args.stepName ? ` step=${args.stepName}` : ''
  return `[${args.script}] error_code=${diagnostic.errorCode} hint=${diagnostic.hint}${stepSegment} ${diagnostic.message}`
}

export function classifyCodexWindowsSelfCheckFailure(args: {
  name: string
  detail: string
}): CodexWindowsDiagnostic {
  switch (args.name) {
    case 'bun':
      return {
        errorCode: 'CODEX_WINDOWS_DEPENDENCY_BUN_MISSING',
        hint: 'install-bun',
        message: args.detail,
      }
    case 'node':
      return {
        errorCode: 'CODEX_WINDOWS_DEPENDENCY_NODE_MISSING',
        hint: 'install-node',
        message: args.detail,
      }
    case 'codex-config-source':
      return {
        errorCode: 'CODEX_WINDOWS_CONFIG_MISSING',
        hint: 'run-setup',
        message: args.detail,
      }
    case 'codex-api':
      return {
        errorCode: 'CODEX_WINDOWS_API_CHECK_FAILED',
        hint: 'run-selfcheck-skip-api',
        message: args.detail,
      }
    default:
      return {
        errorCode: 'CODEX_WINDOWS_CLI_CHECK_FAILED',
        hint: 'run-bun-install',
        message: args.detail,
      }
  }
}
