import { describe, expect, it } from 'bun:test'
import {
  classifyCodexWindowsScriptError,
  classifyCodexWindowsSelfCheckFailure,
  formatCodexWindowsScriptError,
} from './windowsDiagnostics.js'

describe('classifyCodexWindowsScriptError', () => {
  it('classifies missing setup api keys with a stable code and hint', () => {
    expect(
      classifyCodexWindowsScriptError({
        script: 'setup-codex',
        error: new Error('Missing apiKey. Pass --api-key first.'),
      }),
    ).toEqual({
      errorCode: 'CODEX_WINDOWS_SETUP_API_KEY_MISSING',
      hint: 'set-api-key',
      message: 'Missing apiKey. Pass --api-key first.',
    })
  })

  it('classifies launcher permission failures with a stable code and hint', () => {
    expect(
      classifyCodexWindowsScriptError({
        script: 'launcher-runtime',
        error: new Error('EACCES: permission denied, open launcher file'),
      }),
    ).toEqual({
      errorCode: 'CODEX_WINDOWS_PERMISSION_DENIED',
      hint: 'check-permissions',
      message: 'EACCES: permission denied, open launcher file',
    })
  })

  it('formats install step failures with script and step context', () => {
    expect(
      formatCodexWindowsScriptError({
        script: 'install-codex',
        stepName: '执行完整自检',
        error: new Error('step exited with status 1'),
      }),
    ).toBe(
      '[install-codex] error_code=CODEX_WINDOWS_INSTALL_SELFCHECK_FAILED hint=run-selfcheck-skip-api step=执行完整自检 step exited with status 1',
    )
  })
})

describe('classifyCodexWindowsSelfCheckFailure', () => {
  it('classifies missing configuration with a stable hint', () => {
    expect(
      classifyCodexWindowsSelfCheckFailure({
        name: 'codex-config-source',
        detail: '未找到 OPENAI_API_KEY，且配置文件不存在',
      }),
    ).toEqual({
      errorCode: 'CODEX_WINDOWS_CONFIG_MISSING',
      hint: 'run-setup',
      message: '未找到 OPENAI_API_KEY，且配置文件不存在',
    })
  })

  it('classifies api checks separately from local bootstrap failures', () => {
    expect(
      classifyCodexWindowsSelfCheckFailure({
        name: 'codex-api',
        detail: 'exit=1',
      }),
    ).toEqual({
      errorCode: 'CODEX_WINDOWS_API_CHECK_FAILED',
      hint: 'run-selfcheck-skip-api',
      message: 'exit=1',
    })
  })
})
