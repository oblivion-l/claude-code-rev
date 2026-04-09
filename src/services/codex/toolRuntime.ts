import type { Command } from 'src/commands.js'
import type { CanUseToolFn } from 'src/hooks/useCanUseTool.js'
import type { MCPServerConnection } from 'src/services/mcp/types.js'
import type { AppState } from 'src/state/AppState.js'
import type { Tools } from 'src/Tool.js'
import type { AgentDefinition } from 'src/tools/AgentTool/loadAgentsDir.js'

export type CodexToolRuntime = {
  cwd: string
  commands: Command[]
  tools: Tools
  mcpClients: MCPServerConnection[]
  agents: AgentDefinition[]
  canUseTool: CanUseToolFn
  getAppState: () => AppState
  setAppState: (f: (prev: AppState) => AppState) => void
}
