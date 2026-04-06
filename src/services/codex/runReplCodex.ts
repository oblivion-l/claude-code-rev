import { createInterface } from 'readline/promises'
import { gracefulShutdown } from 'src/utils/gracefulShutdown.js'
import { errorMessage, isAbortError } from 'src/utils/errors.js'
import type { Props as REPLProps } from 'src/screens/REPL.js'
import type {
  ReplProvider,
  ReplProviderLaunchArgs,
} from 'src/services/repl/provider.js'
import { EMPTY_USAGE } from 'src/services/api/logging.js'
import type { NonNullableUsage } from 'src/entrypoints/sdk/sdkUtilityTypes.js'
import {
  createCodexResponseStream,
  parseCodexSSE,
} from './client.js'
import { getCodexRuntimeConfig } from './config.js'
import {
  extractCompletedResponse,
  extractResponseId,
  extractResponseText,
  extractTextDelta,
  extractUsage,
  getCodexFailureMessage,
} from './stream.js'
import type { CodexRuntimeConfig } from './types.js'

export type CodexReplConversationState = {
  providerId: 'codex'
  lastResponseId?: string
}

export type CodexReplTurnEvent = {
  type: 'assistant.delta'
  delta: string
}

export type CodexReplTurnResult = {
  responseText: string
  responseId?: string
  usage: NonNullableUsage
  conversationState: CodexReplConversationState
}

function buildInstructions({
  systemPrompt,
  appendSystemPrompt,
}: {
  systemPrompt?: string
  appendSystemPrompt?: string
}): string | undefined {
  const parts = [systemPrompt, appendSystemPrompt].filter(
    (value): value is string => Boolean(value?.trim()),
  )

  if (parts.length === 0) {
    return undefined
  }

  return parts.join('\n\n')
}

function writeLine(message = ''): void {
  process.stdout.write(message + '\n')
}

function writeError(message: string): void {
  process.stderr.write(`Error: ${message}\n`)
}

function formatCodexReplError(error: unknown): string {
  return isAbortError(error) ? 'Request interrupted by user.' : errorMessage(error)
}

function isClosedInputError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase()

  return (
    isAbortError(error) ||
    message.includes('closed') ||
    message.includes('cancelled') ||
    message.includes('canceled')
  )
}

function isExitCommand(input: string): boolean {
  const normalized = input.trim().toLowerCase()
  return normalized === '/exit' || normalized === '/quit'
}

function isSlashCommand(input: string): boolean {
  return input.trimStart().startsWith('/')
}

function getUnsupportedCodexReplMessage(replProps: REPLProps): string | null {
  if ((replProps.initialMessages?.length ?? 0) > 0) {
    return 'Codex REPL does not yet support interactive --continue, --resume, or restored sessions.'
  }

  if (
    replProps.pendingHookMessages ||
    (replProps.initialFileHistorySnapshots?.length ?? 0) > 0 ||
    (replProps.initialContentReplacements?.length ?? 0) > 0
  ) {
    return 'Codex REPL does not yet support restored interactive session state.'
  }

  if (
    replProps.remoteSessionConfig ||
    replProps.directConnectConfig ||
    replProps.sshSession
  ) {
    return 'Codex REPL currently only supports local interactive sessions.'
  }

  return null
}

export class CodexReplSession {
  private readonly instructions?: string
  private readonly config: CodexRuntimeConfig
  private conversationState: CodexReplConversationState = {
    providerId: 'codex',
  }

  constructor(
    private readonly options: {
      userSpecifiedModel?: string
      systemPrompt?: string
      appendSystemPrompt?: string
    } = {},
  ) {
    this.config = getCodexRuntimeConfig(this.options.userSpecifiedModel)
    this.instructions = buildInstructions(this.options)
  }

  get model(): string {
    return this.config.model
  }

  get state(): CodexReplConversationState {
    return { ...this.conversationState }
  }

  async *submitTurn(
    prompt: string,
    signal?: AbortSignal,
  ): AsyncGenerator<CodexReplTurnEvent, CodexReplTurnResult, unknown> {
    if (!prompt.trim()) {
      throw new Error('Prompt must not be empty.')
    }

    const response = await createCodexResponseStream({
      config: this.config,
      input: prompt,
      instructions: this.instructions,
      previousResponseId: this.conversationState.lastResponseId,
      signal,
    })

    let accumulatedText = ''
    let responseId: string | undefined
    let usage: NonNullableUsage = EMPTY_USAGE

    for await (const event of parseCodexSSE(response.body!)) {
      const failureMessage = getCodexFailureMessage(event)
      if (failureMessage) {
        throw new Error(failureMessage)
      }

      const delta = extractTextDelta(event)
      if (delta) {
        accumulatedText += delta
        yield {
          type: 'assistant.delta',
          delta,
        }
      }

      const completedResponse = extractCompletedResponse(event)
      if (!completedResponse) {
        continue
      }

      const completedText = extractResponseText(completedResponse)
      if (completedText && !accumulatedText) {
        accumulatedText = completedText
      }

      responseId = extractResponseId(completedResponse)
      usage = extractUsage(completedResponse)
    }

    this.conversationState = {
      providerId: 'codex',
      lastResponseId: responseId ?? this.conversationState.lastResponseId,
    }

    return {
      responseText: accumulatedText,
      responseId,
      usage,
      conversationState: this.state,
    }
  }
}

export function createCodexReplSession(options?: {
  userSpecifiedModel?: string
  systemPrompt?: string
  appendSystemPrompt?: string
}): CodexReplSession {
  return new CodexReplSession(options)
}

export async function runCodexRepl({
  replProps,
}: ReplProviderLaunchArgs): Promise<number> {
  const unsupportedMessage = getUnsupportedCodexReplMessage(replProps)
  if (unsupportedMessage) {
    writeError(unsupportedMessage)
    return 1
  }

  let session: CodexReplSession
  try {
    session = createCodexReplSession({
      userSpecifiedModel: undefined,
      systemPrompt: replProps.systemPrompt,
      appendSystemPrompt: replProps.appendSystemPrompt,
    })
  } catch (error) {
    writeError(formatCodexReplError(error))
    return 1
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  })

  writeLine(`Codex REPL ready (${session.model}). Type /exit to quit.`)

  try {
    for (;;) {
      let input: string
      try {
        input = await rl.question('codex> ')
      } catch (error) {
        if (isClosedInputError(error)) {
          return 0
        }

        writeError(formatCodexReplError(error))
        return 1
      }

      const prompt = input.trim()

      if (!prompt) {
        continue
      }

      if (isExitCommand(prompt)) {
        return 0
      }

      if (isSlashCommand(prompt)) {
        writeError('Codex REPL currently only supports text prompts and /exit.')
        continue
      }

      const abortController = new AbortController()
      const sigintHandler = () => abortController.abort()
      process.on('SIGINT', sigintHandler)

      try {
        const iterator = session.submitTurn(prompt, abortController.signal)
        let result: CodexReplTurnResult | undefined

        for (;;) {
          const next = await iterator.next()
          if (next.done) {
            result = next.value
            break
          }

          if (next.value.type === 'assistant.delta') {
            process.stdout.write(next.value.delta)
          }
        }

        if (!result?.responseText.endsWith('\n')) {
          writeLine()
        }

        writeLine()
      } catch (error) {
        writeError(formatCodexReplError(error))
        return 1
      } finally {
        process.off('SIGINT', sigintHandler)
      }
    }
  } finally {
    rl.close()
  }
}

export function createCodexReplProvider(): ReplProvider {
  return {
    metadata: {
      id: 'codex',
      displayName: 'Codex',
    },
    capabilities: {
      supportsContinue: false,
      supportsResume: false,
      supportsPersistedState: false,
      supportsTools: false,
    },
    async launch(args: ReplProviderLaunchArgs): Promise<void> {
      const exitCode = await runCodexRepl(args)
      await gracefulShutdown(exitCode)
    },
  }
}
