import { getClaudeCodeMcpConfigs } from 'src/services/mcp/config.js'
import type { ScopedMcpServerConfig } from 'src/services/mcp/types.js'
import type { CodexMcpTool } from './types.js'

function isIgnoredInternalCodexMcpConfig(
  config: ScopedMcpServerConfig,
): boolean {
  return (
    config.type === 'sdk' ||
    config.type === 'sse-ide' ||
    config.type === 'ws-ide' ||
    config.type === 'claudeai-proxy'
  )
}

function assertRemoteCodexMcpUrl(name: string, url: string): string {
  let parsed: URL

  try {
    parsed = new URL(url)
  } catch {
    throw new Error(
      `Codex MCP server "${name}" must use an absolute http(s) URL.`,
    )
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `Codex MCP server "${name}" must use an absolute http(s) URL.`,
    )
  }

  return parsed.toString()
}

function assertNoUnsupportedRemoteMcpOptions(
  name: string,
  config: Extract<
    ScopedMcpServerConfig,
    { type: 'http' | 'sse' | 'ws' }
  >,
): void {
  if (config.type === 'ws') {
    throw new Error(
      `Codex MCP server "${name}" uses unsupported transport "ws". Only remote http and sse servers are currently supported.`,
    )
  }

  if (config.headers && Object.keys(config.headers).length > 0) {
    throw new Error(
      `Codex MCP server "${name}" uses custom headers, which are not yet supported in Codex MCP mode.`,
    )
  }

  if (config.headersHelper) {
    throw new Error(
      `Codex MCP server "${name}" uses headersHelper, which is not yet supported in Codex MCP mode.`,
    )
  }

  if ('oauth' in config && config.oauth) {
    throw new Error(
      `Codex MCP server "${name}" uses oauth, which is not yet supported in Codex MCP mode.`,
    )
  }
}

export function mapCodexMcpTools(
  configs: Record<string, ScopedMcpServerConfig>,
): CodexMcpTool[] {
  return Object.entries(configs)
    .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
    .flatMap(([name, config]) => {
      const transport = config.type ?? 'stdio'

      if (isIgnoredInternalCodexMcpConfig(config)) {
        return []
      }

      if (transport === 'stdio') {
        throw new Error(
          `Codex MCP server "${name}" uses unsupported transport "stdio". Only remote http and sse servers are currently supported.`,
        )
      }

      if (transport === 'http' || transport === 'sse' || transport === 'ws') {
        assertNoUnsupportedRemoteMcpOptions(
          name,
          config as Extract<ScopedMcpServerConfig, { type: 'http' | 'sse' | 'ws' }>,
        )

        return [
          {
            type: 'mcp',
            server_label: name,
            server_url: assertRemoteCodexMcpUrl(
              name,
              (
                config as Extract<
                  ScopedMcpServerConfig,
                  { type: 'http' | 'sse' | 'ws' }
                >
              ).url,
            ),
          },
        ]
      }

      throw new Error(
        `Codex MCP server "${name}" uses unsupported transport "${transport}". Only remote http and sse servers are currently supported.`,
      )
    })
}

export async function resolveCodexMcpTools(options?: {
  dynamicMcpConfig?: Record<string, ScopedMcpServerConfig>
  strictMcpConfig?: boolean
}): Promise<CodexMcpTool[]> {
  const dynamicMcpConfig = options?.dynamicMcpConfig ?? {}
  const configs = options?.strictMcpConfig
    ? dynamicMcpConfig
    : (
        await getClaudeCodeMcpConfigs(dynamicMcpConfig)
      ).servers

  return mapCodexMcpTools(configs)
}
