export type ReplProviderCapabilities = {
  supportsContinue: boolean
  supportsResume: boolean
  supportsPersistedState: boolean
  supportsTools: boolean
}

export type ReplProviderMetadata = {
  id: string
  displayName: string
}

export type ReplProvider = {
  metadata: ReplProviderMetadata
  capabilities: ReplProviderCapabilities
}
