# @chaprola/mcp-server

MCP server for [Chaprola](https://chaprola.org) — the agent-first data platform.

Gives AI agents 40 tools for structured data storage, querying, web search, URL fetching, scheduled jobs, and execution through the [Model Context Protocol](https://modelcontextprotocol.io).

## Quick Start

### Claude Code

```bash
claude mcp add chaprola-mcp -e CHAPROLA_USERNAME=yourusername -e CHAPROLA_API_KEY=chp_yourkey -- npx @chaprola/mcp-server
```

> **Note:** After installing, restart Claude Code to load the MCP server. The server description and tools will then be available to Claude.

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "chaprola": {
      "command": "npx",
      "args": ["@chaprola/mcp-server"],
      "env": {
        "CHAPROLA_USERNAME": "yourusername",
        "CHAPROLA_API_KEY": "chp_yourkey"
      }
    }
  }
}
```

### VS Code / Copilot

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "chaprola": {
      "command": "npx",
      "args": ["@chaprola/mcp-server"],
      "env": {
        "CHAPROLA_USERNAME": "yourusername",
        "CHAPROLA_API_KEY": "chp_yourkey"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "chaprola": {
      "command": "npx",
      "args": ["@chaprola/mcp-server"],
      "env": {
        "CHAPROLA_USERNAME": "yourusername",
        "CHAPROLA_API_KEY": "chp_yourkey"
      }
    }
  }
}
```

## Getting Credentials

```bash
# Register (returns your API key — save it immediately)
curl -X POST https://api.chaprola.org/register \
  -H "Content-Type: application/json" \
  -d '{"username": "myname", "passcode": "my-secure-passcode-16chars"}'
```

Or use the `chaprola_register` tool after connecting.

## Available Tools

| Tool | Description |
|------|-------------|
| `chaprola_hello` | Health check |
| `chaprola_register` | Create account |
| `chaprola_login` | Login (get new API key) |
| `chaprola_check_username` | Check username availability |
| `chaprola_delete_account` | Delete account + all data |
| `chaprola_sign_baa` | Sign Business Associate Agreement (PHI only) |
| `chaprola_baa_status` | Check BAA status |
| `chaprola_baa_text` | Get BAA text |
| `chaprola_import` | Import JSON to Chaprola format |
| `chaprola_import_url` | Get presigned upload URL |
| `chaprola_import_process` | Process uploaded file |
| `chaprola_import_download` | Import from URL (CSV/Excel/JSON/Parquet) |
| `chaprola_export` | Export to JSON |
| `chaprola_list` | List files |
| `chaprola_compile` | Compile .CS source to .PR bytecode |
| `chaprola_run` | Execute .PR program |
| `chaprola_run_status` | Check async job status |
| `chaprola_publish` | Publish program for public access |
| `chaprola_unpublish` | Remove public access |
| `chaprola_report` | Run published program (no auth) |
| `chaprola_export_report` | Run program and save output |
| `chaprola_download` | Get presigned download URL |
| `chaprola_query` | Filter, aggregate, join data |
| `chaprola_sort` | Sort data file |
| `chaprola_index` | Build index on field |
| `chaprola_merge` | Merge two sorted files |
| `chaprola_optimize` | HULDRA nonlinear optimization |
| `chaprola_optimize_status` | Check optimization status |
| `chaprola_email_inbox` | List emails |
| `chaprola_email_read` | Read email |
| `chaprola_email_send` | Send email |
| `chaprola_email_delete` | Delete email |
| `chaprola_search` | Web search via Brave API |
| `chaprola_fetch` | Fetch URL content as markdown/text/JSON |
| `chaprola_schedule` | Create scheduled recurring job |
| `chaprola_schedule_list` | List scheduled jobs |
| `chaprola_schedule_delete` | Delete scheduled job |

## Resources

The server exposes reference documentation as MCP resources:

- `chaprola://cookbook` — Language cookbook with complete examples
- `chaprola://endpoints` — All 40 API endpoints
- `chaprola://auth` — Authentication reference
- `chaprola://gotchas` — Common mistakes to avoid

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CHAPROLA_USERNAME` | Yes | Your registered username |
| `CHAPROLA_API_KEY` | Yes | Your API key (format: `chp_` + 64 hex chars) |

## HIPAA / BAA

Non-PHI data works without a signed BAA. If handling Protected Health Information (PHI), a human must review and sign the BAA first. The server includes guardrails that warn agents when the BAA is not signed.

## Links

- Website: [chaprola.org](https://chaprola.org)
- API: [api.chaprola.org](https://api.chaprola.org/hello)
- Status: [UptimeRobot](https://stats.uptimerobot.com/1gkN4Tx0RX)
