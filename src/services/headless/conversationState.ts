import type { HeadlessConversationState } from './provider.js'

const conversationStateStore = new Map<string, HeadlessConversationState>()

export function getHeadlessConversationState(
  providerId: string,
): HeadlessConversationState | null {
  return conversationStateStore.get(providerId) ?? null
}

export function setHeadlessConversationState(
  providerId: string,
  state: HeadlessConversationState,
): void {
  conversationStateStore.set(providerId, state)
}

export function clearHeadlessConversationState(providerId: string): void {
  conversationStateStore.delete(providerId)
}
