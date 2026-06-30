---
id: sync-trails-mcp
runner: mcp
trigger: on-demand
method: mcp
capability: sync-trails
mcp_command: "${env.ALLTRAILS_MCP_COMMAND}"
tool: search_trails_by_name
inputs:
  - { name: query, value: "saved" }
save: alltrails-trails-${date}.json
---
# Sync trails (MCP fallback)

Headless fallback for the sync-trails capability via a local AllTrails MCP
server. Requires ALLTRAILS_MCP_COMMAND to point at the server launch command.
The engine spawns it over stdio and calls a search tool to enrich trail detail.
Read-only.
