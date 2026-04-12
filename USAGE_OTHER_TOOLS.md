# Using Edu Plugins with Other AI Coding Tools

The Claude Edu Plugins ship as **Claude Code plugins**, but also include a ready-to-use **MCP server** that works with any MCP-compatible AI agent CLI. This guide covers setup for each tool.

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│  AI Agent (Claude Code, Copilot, Codex, Cursor,           │
│           Windsurf, Gemini CLI, ...)                       │
│                                                            │
│                    │ MCP (stdio)                            │
│                    ▼                                        │
│  ┌────────────────────────────────────────────────────┐    │
│  │  MCP Server (mcp-edu-server.js)                    │    │
│  │  31 structured tools — all Moodle & Kahoot commands │    │
│  └──────────────────┬─────────────────────────────────┘    │
│                     │ spawns                                │
│  ┌──────────────────▼─────────────────────────────────┐    │
│  │  CLI Scripts (Node.js)                              │    │
│  │  • moodle-updater.js  • kahoot-creator.js           │    │
│  │  • grade-essay.js                                   │    │
│  └──────────────────┬─────────────────────────────────┘    │
│                     │ HTTP                                  │
│  ┌──────────────────▼─────────────────────────────────┐    │
│  │  Moodle / Kahoot APIs                               │    │
│  └────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────┘
```

The **MCP server** wraps all CLI commands as structured tools. Any AI agent that supports MCP can call them directly — no instruction files needed.

## Step 1: Install Dependencies

Clone the repository and install the MCP server:

```bash
git clone https://github.com/rudini/claude-edu-plugins.git
cd claude-edu-plugins

# Install MCP server (recommended — works with all tools)
cd plugins/mcp-server && npm install && cd ../..

# Install CLI dependencies
cd plugins/moodle-skill && npm install && cd ../..
cd plugins/kahoot-skill && npm install && cd ../..
```

## Step 2: Configure Environment

Create a `.env` file in your project root:

```env
# Moodle
MOODLE_URL=https://your-moodle-instance.example.com
MOODLE_SESSION=
COURSE_ID=1234

# Kahoot
KAHOOT_TOKEN=
```

Authenticate by running the login commands directly. The browser opens, you log in, and it closes automatically once login is detected:

```bash
# Moodle — opens browser, saves session cookie to .env
node path/to/claude-edu-plugins/plugins/moodle-skill/scripts/moodle-updater.js login

# Kahoot — opens browser, saves token to .env
node path/to/claude-edu-plugins/plugins/kahoot-skill/scripts/kahoot-creator.js login

# Use --browser flag for SSO (Edge or Chrome)
node path/to/moodle-updater.js login --browser msedge
node path/to/kahoot-creator.js login --browser chrome
```

## Step 3: Verify CLI Works Standalone

Before integrating with any AI tool, confirm the scripts work on their own:

```bash
# Moodle: show course structure
node path/to/moodle-updater.js structure

# Kahoot: list quizzes
node path/to/kahoot-creator.js list
```

If these work, any AI tool that can execute shell commands can use them.

---

## MCP Server (recommended for all tools)

This repository includes a ready-to-use MCP server at `plugins/mcp-server/mcp-edu-server.js` that exposes **all** Moodle and Kahoot CLI commands as structured MCP tools. This is the recommended approach for all tools that support MCP.

### Configuration per Tool

**Claude Code** (`.claude/settings.json` or `claude mcp add`):
```json
{
  "mcpServers": {
    "edu-plugins": {
      "command": "node",
      "args": ["/path/to/claude-edu-plugins/plugins/mcp-server/mcp-edu-server.js"]
    }
  }
}
```

**VS Code / Copilot** (`.vscode/mcp.json`):
```json
{
  "servers": {
    "edu-plugins": {
      "command": "node",
      "args": ["/path/to/claude-edu-plugins/plugins/mcp-server/mcp-edu-server.js"]
    }
  }
}
```

**OpenAI Codex** (`.codex/mcp.json`):
```json
{
  "servers": {
    "edu-plugins": {
      "command": "node",
      "args": ["/path/to/claude-edu-plugins/plugins/mcp-server/mcp-edu-server.js"]
    }
  }
}
```

**Cursor** (Settings > MCP):
```json
{
  "mcpServers": {
    "edu-plugins": {
      "command": "node",
      "args": ["/path/to/claude-edu-plugins/plugins/mcp-server/mcp-edu-server.js"]
    }
  }
}
```

**Windsurf** (Settings > MCP):
```json
{
  "mcpServers": {
    "edu-plugins": {
      "command": "node",
      "args": ["/path/to/claude-edu-plugins/plugins/mcp-server/mcp-edu-server.js"]
    }
  }
}
```

**Gemini CLI** (`~/.gemini/settings.json`):
```json
{
  "mcpServers": {
    "edu-plugins": {
      "command": "node",
      "args": ["/path/to/claude-edu-plugins/plugins/mcp-server/mcp-edu-server.js"]
    }
  }
}
```

### Available MCP Tools

The server exposes 31 tools:

| Tool | Description |
|------|-------------|
| `moodle_login` | Browser login to Moodle |
| `moodle_structure` | Show course structure |
| `moodle_list_activities` | List section activities |
| `moodle_show_label` | Show label content |
| `moodle_show_page` | Show page content |
| `moodle_update_label` | Update label from file |
| `moodle_update_page` | Update page from file |
| `moodle_update_summary` | Update section summary |
| `moodle_create_url` | Create URL activity |
| `moodle_create_page` | Create page from Markdown |
| `moodle_create_resource` | Upload file resource |
| `moodle_create_assign` | Create assignment |
| `moodle_create_forum` | Create forum |
| `moodle_create_quiz` | Create quiz from config |
| `moodle_duplicate_section` | Duplicate last section |
| `moodle_rename_section` | Rename a section |
| `moodle_move_section` | Move a section |
| `moodle_delete_section` | Delete a section |
| `moodle_delete_activity` | Delete an activity |
| `moodle_indent_activity` | Indent an activity |
| `moodle_hide_activity` | Hide an activity |
| `moodle_move_activity` | Move activity to section |
| `moodle_import_gift` | Import GIFT questions |
| `moodle_delete_quiz_questions` | Delete quiz questions |
| `moodle_add_questions_to_quiz` | Add questions to quiz |
| `moodle_grade_essay` | AI-assisted essay grading |
| `kahoot_login` | Browser login to Kahoot |
| `kahoot_list` | List quizzes |
| `kahoot_preview` | Validate quiz JSON |
| `kahoot_create` | Create quiz from JSON |
| `kahoot_host` | Open game lobby |

All destructive tools enforce dry-run by default (`live: false`).

---

## Alternative: Instruction Files

If you prefer instruction files over MCP, each tool has its own format:

### GitHub Copilot (VS Code)

Add a `.github/copilot-instructions.md` file to your project:

```markdown
## Moodle Management

To manage the Moodle course, use the CLI tool:

    node /absolute/path/to/moodle-updater.js <command> [args]

Available commands: structure, list-activities <sectionId>, create-url <sectionId> <name> <url>,
create-page <sectionId> <name> <content.md>, create-quiz <sectionId> <name>, import-gift <quizId> <file.gift>,
update-label <cmid> <content.md>, update-page <cmid> <content.md>, delete-activity <cmid> --live,
grade-essay <cmid> [--gift <path>] [--slot <num>] [--model <name>] [--live]

Always do a dry-run first (without --live), show the output to the user,
and only add --live after explicit confirmation.

## Kahoot Quiz Creation

    node /absolute/path/to/kahoot-creator.js <command> [args]

Available commands: preview <quiz.json>, create <quiz.json> --live, list, host <uuid|url|quiz.json>, login
```

### OpenAI Codex (CLI)

Create an `AGENTS.md` in your project root:

```markdown
# Moodle & Kahoot Tools

## Moodle CLI
Location: `plugins/moodle-skill/scripts/moodle-updater.js`

Run all commands with: `node plugins/moodle-skill/scripts/moodle-updater.js <command>`

Commands:
- `structure` — show course sections and activities
- `list-activities <sectionId>` — list all activities in a section
- `create-url <sectionId> <name> <url>` — add a URL resource
- `create-page <sectionId> <name> <content.md>` — create page from Markdown
- `create-quiz <sectionId> <configJson>` — create quiz from config
- `import-gift <cmid> <file.gift>` — import GIFT-format questions
- `delete-activity <cmid> --live` — delete (requires --live flag)
- `grade-essay <cmid> [--gift <path>] [--slot <num>] [--live]` — AI grading

## Kahoot CLI
Location: `plugins/kahoot-skill/scripts/kahoot-creator.js`

Commands:
- `preview <quiz.json>` — validate quiz definition
- `create <quiz.json>` — dry-run, shows what would be created
- `create <quiz.json> --live` — actually create the quiz
- `list` — list existing quizzes
- `host <uuid|url|quiz.json>` — open game lobby

## Safety Rules
- All destructive operations (delete, create --live, submit --live) need the `--live` flag
- Always run without `--live` first and show the user the dry-run output
- Only proceed with `--live` after the user explicitly confirms
```

### Cursor

Add a `.cursor/rules` file or go to **Settings > Rules for AI**:

```
When I ask about Moodle, use the CLI at plugins/moodle-skill/scripts/moodle-updater.js.
When I ask about Kahoot, use the CLI at plugins/kahoot-skill/scripts/kahoot-creator.js.
Always run destructive commands without --live first, show me the output, and wait for my confirmation before adding --live.
```

### Windsurf

Add rules via **Settings > AI Rules** or a `.windsurfrules` file:

```
For Moodle course management, execute:
  node plugins/moodle-skill/scripts/moodle-updater.js <command>

For Kahoot quiz management, execute:
  node plugins/kahoot-skill/scripts/kahoot-creator.js <command>

Always perform a dry-run first. Only add --live after user confirms.
```

### Gemini CLI

Create a `GEMINI.md` file in your project root:

```markdown
# Moodle & Kahoot Tools

## Moodle CLI
Location: `plugins/moodle-skill/scripts/moodle-updater.js`

Run all commands with: `node plugins/moodle-skill/scripts/moodle-updater.js <command>`

Commands:
- `structure` — show course sections and activities
- `list-activities <sectionId>` — list all activities in a section
- `create-url <sectionId> <name> <url>` — add a URL resource
- `create-page <sectionId> <name> <content.md>` — create page from Markdown
- `create-quiz <sectionId> <configJson>` — create quiz from config
- `import-gift <cmid> <file.gift>` — import GIFT questions
- `grade-essay <cmid> [--gift <path>] [--slot <num>] [--model <name>] [--live]` — AI grading

## Kahoot CLI
Location: `plugins/kahoot-skill/scripts/kahoot-creator.js`

Commands:
- `preview <quiz.json>` — validate quiz definition
- `create <quiz.json> --live` — create the quiz
- `list` — list existing quizzes
- `host <uuid|url|quiz.json>` — open game lobby

## Safety Rules
- All destructive operations need the `--live` flag
- Always run without `--live` first and show the dry-run output
- Only proceed with `--live` after explicit confirmation
```

---

## Quick Comparison

| Feature | Claude Code | Copilot | Codex | Cursor | Windsurf | Gemini CLI |
|---------|------------|---------|-------|--------|----------|------------|
| Plugin install | `/plugin install` | — | — | — | — | — |
| Instructions file | `SKILL.md` (auto) | `.github/copilot-instructions.md` | `AGENTS.md` | `.cursor/rules` | `.windsurfrules` | `GEMINI.md` |
| Runs CLI scripts | Yes | Yes (terminal) | Yes (sandbox) | Yes (terminal) | Yes (terminal) | Yes (terminal) |
| MCP server support | Yes | Yes | Yes | Yes | Yes | Yes |
| Auto-dependency install | Hooks | Manual | Manual | Manual | Manual | Manual |
| Dry-run enforcement | SKILL.md rules | Instructions file | AGENTS.md rules | Rules | Rules | GEMINI.md rules |

## Tips

- **Path management**: Use absolute paths to the CLI scripts, or add the plugin directories to your `PATH`.
- **Session expiry**: The Moodle session cookie expires. Re-run the `login` command when you get authentication errors. The browser auto-closes after login.
- **SSO / browser choice**: Both `login` commands support `--browser msedge` or `--browser chrome` for organizations that require a specific browser for single sign-on.
- **Dry-run safety**: All tools enforce a dry-run → confirm → `--live` pattern. Make sure your instructions to the AI emphasize this workflow regardless of which tool you use.
- **GIFT format**: The quiz import uses standard [GIFT format](https://docs.moodle.org/en/GIFT_format). All AI tools can generate GIFT syntax if you describe the question format.
