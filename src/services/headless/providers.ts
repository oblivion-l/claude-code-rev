import { createCodexHeadlessProvider } from 'src/services/codex/runHeadlessCodex.js'
import { isCodexHeadlessEnabled } from 'src/services/codex/config.js'
import type { HeadlessProvider } from './provider.js'

export function resolveHeadlessProvider(): HeadlessProvider | null {
  if (isCodexHeadlessEnabled()) {
    return createCodexHeadlessProvider()
  }

  return null
}
