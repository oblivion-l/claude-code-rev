import { randomUUID, createHash } from 'crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
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

export type PersistedHeadlessConversationStateDiagnostics = {
  skippedBrokenCount: number
  repairedPointer: boolean
  recoveredFromScan: boolean
  usedGlobalFallback: boolean
}

export type PersistedHeadlessConversationStateResolution = {
  state: HeadlessConversationState | null
  diagnostics: PersistedHeadlessConversationStateDiagnostics
}

export type PersistedHeadlessConversationStateList = {
  states: HeadlessConversationState[]
  diagnostics: Pick<
    PersistedHeadlessConversationStateDiagnostics,
    'skippedBrokenCount'
  >
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

function createPersistedStateDiagnostics(): PersistedHeadlessConversationStateDiagnostics {
  return {
    skippedBrokenCount: 0,
    repairedPointer: false,
    recoveredFromScan: false,
    usedGlobalFallback: false,
  }
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
  try {
    return loadPersistedStateById(providerId, pointer.stateId)
  } catch (error) {
    if (
      error instanceof HeadlessConversationStateError &&
      error.kind === 'missing_state'
    ) {
      rmSync(pointerFilePath, { force: true })
      throw new HeadlessConversationStateError(
        'missing_pointer',
        `Persisted ${providerId} latest-conversation pointer for ${cwd} referenced missing state ${pointer.stateId}. The stale pointer was cleaned up.`,
      )
    }

    throw error
  }
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

function listPersistedStates(
  providerId: string,
): PersistedHeadlessConversationStateList {
  const statesDir = getProviderStatesDir(providerId)
  if (!existsSync(statesDir)) {
    return {
      states: [],
      diagnostics: {
        skippedBrokenCount: 0,
      },
    }
  }

  const states: HeadlessConversationState[] = []
  let skippedBrokenCount = 0

  for (const entry of readdirSync(statesDir)) {
    if (!entry.endsWith('.json')) {
      continue
    }

    const stateId = entry.slice(0, -'.json'.length)
    try {
      states.push(loadPersistedStateById(providerId, stateId))
    } catch (error) {
      if (error instanceof HeadlessConversationStateError) {
        skippedBrokenCount += 1
        continue
      }

      throw error
    }
  }

  states.sort((left, right) => {
    const leftTime =
      Date.parse(left.updatedAt ?? left.createdAt ?? '') || 0
    const rightTime =
      Date.parse(right.updatedAt ?? right.createdAt ?? '') || 0

    if (leftTime !== rightTime) {
      return rightTime - leftTime
    }

    return (right.stateId ?? '').localeCompare(left.stateId ?? '')
  })

  return {
    states,
    diagnostics: {
      skippedBrokenCount,
    },
  }
}

function setPointerForRecoveredState(args: {
  providerId: string
  cwd: string
  stateId: string
  updatedAt?: string
}): void {
  ensureDir(getProviderPointersDir(args.providerId))
  const pointer: HeadlessConversationStatePointer = {
    version: HEADLESS_CONVERSATION_STATE_VERSION,
    providerId: args.providerId,
    stateId: args.stateId,
    cwd: args.cwd,
    updatedAt: args.updatedAt ?? new Date().toISOString(),
  }
  writeFileSync(
    getPointerFilePath(args.providerId, args.cwd),
    JSON.stringify(pointer, null, 2) + '\n',
    'utf8',
  )
}

export function listPersistedHeadlessConversationStates(
  providerId: string,
): PersistedHeadlessConversationStateList {
  return listPersistedStates(providerId)
}

export function resolvePersistedHeadlessConversationStateWithRepair(
  providerId: string,
  options: GetHeadlessConversationStateOptions = {},
): PersistedHeadlessConversationStateResolution {
  const diagnostics = createPersistedStateDiagnostics()

  if (options.stateId) {
    return {
      state: loadPersistedStateById(providerId, options.stateId),
      diagnostics,
    }
  }

  if (!options.cwd) {
    return {
      state: null,
      diagnostics,
    }
  }

  const pointerFilePath = getPointerFilePath(providerId, options.cwd)
  if (existsSync(pointerFilePath)) {
    try {
      const pointer = parsePointer(providerId, readFileSync(pointerFilePath, 'utf8'))
      const state = loadPersistedStateById(providerId, pointer.stateId)
      conversationStateStore.set(providerId, state)
      return {
        state,
        diagnostics,
      }
    } catch (error) {
      if (error instanceof HeadlessConversationStateError) {
        rmSync(pointerFilePath, { force: true })
        diagnostics.repairedPointer = true
      } else {
        throw error
      }
    }
  }

  const { states, diagnostics: listDiagnostics } = listPersistedStates(providerId)
  diagnostics.skippedBrokenCount = listDiagnostics.skippedBrokenCount

  const sameCwdState =
    states.find(state => state.cwd === options.cwd) ?? null
  const recoveredState = sameCwdState ?? states[0] ?? null
  if (!recoveredState) {
    return {
      state: null,
      diagnostics,
    }
  }

  diagnostics.recoveredFromScan = true
  diagnostics.usedGlobalFallback = recoveredState.cwd !== options.cwd
  setPointerForRecoveredState({
    providerId,
    cwd: options.cwd,
    stateId: recoveredState.stateId!,
    updatedAt: recoveredState.updatedAt,
  })
  conversationStateStore.set(providerId, recoveredState)

  return {
    state: recoveredState,
    diagnostics,
  }
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
    setPointerForRecoveredState({
      providerId,
      cwd: normalizedState.cwd,
      stateId: normalizedState.stateId!,
      updatedAt: normalizedState.updatedAt,
    })
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
