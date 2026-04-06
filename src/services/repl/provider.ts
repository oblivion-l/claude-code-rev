import type React from 'react'
import type { StatsStore } from 'src/context/stats.js'
import type { Root } from 'src/ink.js'
import type { Props as REPLProps } from 'src/screens/REPL.js'
import type { AppState } from 'src/state/AppStateStore.js'
import type { FpsMetrics } from 'src/utils/fpsTracker.js'

export type ReplAppProps = {
  getFpsMetrics: () => FpsMetrics | undefined
  stats?: StatsStore
  initialState: AppState
}

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
  launch(args: ReplProviderLaunchArgs): Promise<void>
}

export type ReplProviderLaunchArgs = {
  root: Root
  appProps: ReplAppProps
  replProps: REPLProps
  renderAndRun: (root: Root, element: React.ReactNode) => Promise<void>
}
