import { randomUUID, createHash } from 'crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import {
  HEADLESS_CONVERSATION_STATE_VERSION,
  type HeadlessConversationState,
  type HeadlessConversationTurnState,
} from './provider.js'

const conversationStateStore = new Map<string, HeadlessConversationState>()

type HeadlessConversationStatePointer = {
  version: number
  providerId: string
  stateId: string
  cwd: string
  updatedAt: string
}

export class HeadlessConversationStateError extends Error {
  kind:
    | 'corrupt'
    | 'unsupported_version'
    | 'provider_mismatch'
    | 'missing_state'
    | 'missing_pointer'

  constructor(
    kind: HeadlessConversationStateError['kind'],
    message: string,
  ) {
    super(message)
    this.kind = kind
    this.name = 'HeadlessConversationStateError'
  }
}

type GetHeadlessConversationStateOptions = {
  cwd?: string
  stateId?: string
}

type SetHeadlessConversationStateOptions = {
  cwd?: string
}

type ClearHeadlessConversationStateOptions = {
  cwd?: string
  stateId?: string
}

function getHeadlessConversationStateRoot(): string {
  return (
    process.env.CLAUDE_CODE_HEADLESS_STATE_DIR ??
    join(homedir(), '.claude', 'headless-provider-state')
  )
}

function getProviderStateDir(providerId: string): string {
  return join(getHeadlessConversationStateRoot(), providerId)
}

function getProviderStatesDir(providerId: string): string {
  return join(getProviderStateDir(providerId), 'states')
}

function getProviderPointersDir(providerId: string): string {
  return join(getProviderStateDir(providerId), 'latest')
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true })
}

function hashCwd(cwd: string): string {
  return createHash('sha256').update(cwd).digest('hex')
}

function getStateFilePath(providerId: string, stateId: string): string {
  return join(getProviderStatesDir(providerId), `${stateId}.json`)
}

function getPointerFilePath(providerId: string, cwd: string): string {
  return join(getProviderPointersDir(providerId), `${hashCwd(cwd)}.json`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeHistory(
  history: unknown,
): HeadlessConversationTurnState[] {
  if (!Array.isArray(history)) {
    return []
  }

  return history.flatMap(entry => {
    if (!isRecord(entry)) {
      return []
    }

    const assistantMessageUuid = entry.assistantMessageUuid
    const responseId = entry.responseId
    const createdAt = entry.createdAt

    if (
      typeof assistantMessageUuid !== 'string' ||
      typeof responseId !== 'string' ||
      typeof createdAt !== 'string'
    ) {
      return []
    }

    return [
      {
        assistantMessageUuid,
        responseId,
        createdAt,
      },
    ]
  })
}

function normalizeHeadlessConversationState(
  providerId: string,
  state: HeadlessConversationState,
  cwd?: string,
): HeadlessConversationState {
  const timestamp = new Date().toISOString()

  return {
    providerId,
    version: HEADLESS_CONVERSATION_STATE_VERSION,
    stateId: state.stateId ?? randomUUID(),
    cwd: cwd ?? state.cwd,
    createdAt: state.createdAt ?? timestamp,
    updatedAt: timestamp,
    conversationId: state.conversationId,
    lastResponseId: state.lastResponseId,
    lastAssistantMessageUuid: state.lastAssistantMessageUuid,
    history: state.history ?? [],
    metadata: state.metadata,
  }
}

function parsePersistedState(
  providerId: string,
  content: string,
): HeadlessConversationState {
  let parsed: unknown

  try {
    parsed = JSON.parse(content)
  } catch {
    throw new HeadlessConversationStateError(
      'corrupt',
      `Persisted ${providerId} conversation state is not valid JSON.`,
    )
  }

  if (!isRecord(parsed)) {
    throw new HeadlessConversationStateError(
      'corrupt',
      `Persisted ${providerId} conversation state has an invalid shape.`,
    )
  }

  const version = parsed.version
  if (version !== HEADLESS_CONVERSATION_STATE_VERSION) {
    throw new HeadlessConversationStateError(
      'unsupported_version',
      `Persisted ${providerId} conversation state version ${String(version)} is not supported by this CLI build.`,
    )
  }

  if (parsed.providerId !== providerId) {
    throw new HeadlessConversationStateError(
      'provider_mismatch',
      `Persisted conversation state belongs to provider ${String(parsed.providerId)}, not ${providerId}.`,
    )
  }

  if (typeof parsed.stateId !== 'string') {
    throw new HeadlessConversationStateError(
      'corrupt',
      `Persisted ${providerId} conversation state is missing stateId.`,
    )
  }

  return {
    providerId,
    version,
    stateId: parsed.stateId,
    cwd: typeof parsed.cwd === 'string' ? parsed.cwd : undefined,
    createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : undefined,
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined,
    conversationId:
      typeof parsed.conversationId === 'string'
        ? parsed.conversationId
        : undefined,
    lastResponseId:
      typeof parsed.lastResponseId === 'string' ? parsed.lastResponseId : undefined,
    lastAssistantMessageUuid:
      typeof parsed.lastAssistantMessageUuid === 'string'
        ? parsed.lastAssistantMessageUuid
        : undefined,
    history: normalizeHistory(parsed.history),
    metadata: isRecord(parsed.metadata) ? parsed.metadata : undefined,
  }
}

function parsePointer(
  providerId: string,
  content: string,
): HeadlessConversationStatePointer {
  let parsed: unknown

  try {
    parsed = JSON.parse(content)
  } catch {
    throw new HeadlessConversationStateError(
      'corrupt',
      `Persisted ${providerId} latest-conversation pointer is not valid JSON.`,
    )
  }

  if (!isRecord(parsed)) {
    throw new HeadlessConversationStateError(
      'corrupt',
      `Persisted ${providerId} latest-conversation pointer has an invalid shape.`,
    )
  }

  if (parsed.version !== HEADLESS_CONVERSATION_STATE_VERSION) {
    throw new HeadlessConversationStateError(
      'unsupported_version',
      `Persisted ${providerId} latest-conversation pointer version ${String(parsed.version)} is not supported by this CLI build.`,
    )
  }

  if (
    parsed.providerId !== providerId ||
    typeof parsed.stateId !== 'string' ||
    typeof parsed.cwd !== 'string' ||
    typeof parsed.updatedAt !== 'string'
  ) {
    throw new HeadlessConversationStateError(
      'corrupt',
      `Persisted ${providerId} latest-conversation pointer has an invalid shape.`,
    )
  }

  return parsed as HeadlessConversationStatePointer
}

function loadPersistedStateById(
  providerId: string,
  stateId: string,
): HeadlessConversationState {
  const stateFilePath = getStateFilePath(providerId, stateId)
  if (!existsSync(stateFilePath)) {
    throw new HeadlessConversationStateError(
      'missing_state',
      `No persisted ${providerId} conversation state was found for resume id ${stateId}.`,
    )
  }

  return parsePersistedState(providerId, readFileSync(stateFilePath, 'utf8'))
}

function loadPersistedStateByCwd(
  providerId: string,
  cwd: string,
): HeadlessConversationState | null {
  const pointerFilePath = getPointerFilePath(providerId, cwd)
  if (!existsSync(pointerFilePath)) {
    return null
  }

  const pointer = parsePointer(providerId, readFileSync(pointerFilePath, 'utf8'))
  return loadPersistedStateById(providerId, pointer.stateId)
}

export function getHeadlessConversationState(
  providerId: string,
  options: GetHeadlessConversationStateOptions = {},
): HeadlessConversationState | null {
  if (options.stateId) {
    return loadPersistedStateById(providerId, options.stateId)
  }

  const inMemoryState = conversationStateStore.get(providerId) ?? null
  if (inMemoryState) {
    if (!options.cwd || !inMemoryState.cwd || inMemoryState.cwd === options.cwd) {
      return inMemoryState
    }
  }

  if (options.cwd) {
    const persistedState = loadPersistedStateByCwd(providerId, options.cwd)
    if (persistedState) {
      conversationStateStore.set(providerId, persistedState)
    }
    return persistedState
  }

  return inMemoryState
}

export function setHeadlessConversationState(
  providerId: string,
  state: HeadlessConversationState,
  options: SetHeadlessConversationStateOptions = {},
): HeadlessConversationState {
  const normalizedState = normalizeHeadlessConversationState(
    providerId,
    state,
    options.cwd,
  )

  conversationStateStore.set(providerId, normalizedState)

  ensureDir(getProviderStatesDir(providerId))
  writeFileSync(
    getStateFilePath(providerId, normalizedState.stateId!),
    JSON.stringify(normalizedState, null, 2) + '\n',
    'utf8',
  )

  if (normalizedState.cwd) {
    ensureDir(getProviderPointersDir(providerId))
    const pointer: HeadlessConversationStatePointer = {
      version: HEADLESS_CONVERSATION_STATE_VERSION,
      providerId,
      stateId: normalizedState.stateId!,
      cwd: normalizedState.cwd,
      updatedAt: normalizedState.updatedAt!,
    }
    writeFileSync(
      getPointerFilePath(providerId, normalizedState.cwd),
      JSON.stringify(pointer, null, 2) + '\n',
      'utf8',
    )
  }

  return normalizedState
}

export function clearHeadlessConversationState(
  providerId: string,
  options: ClearHeadlessConversationStateOptions = {},
): void {
  conversationStateStore.delete(providerId)

  if (options.stateId) {
    rmSync(getStateFilePath(providerId, options.stateId), {
      force: true,
    })
  }

  if (options.cwd) {
    rmSync(getPointerFilePath(providerId, options.cwd), {
      force: true,
    })
  }
}
