# Using Edu Plugins with Other AI Coding Tools

The Claude Edu Plugins ship as **Claude Code plugins**, but the underlying scripts are standalone Node.js CLI tools. This guide explains how to use them with other AI-assisted coding tools.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  AI Coding Tool (Copilot, Codex, Cursor, etc.)      │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │  Instructions (system prompt / custom rules) │    │
│  │  ← equivalent of SKILL.md                    │    │
│  └──────────────┬──────────────────────────────┘    │
│                 │ runs via terminal                  │
│  ┌──────────────▼──────────────────────────────┐    │
│  │  CLI Scripts (Node.js)                       │    │
│  │  • moodle-updater.js                         │    │
│  │  • kahoot-creator.js                         │    │
│  └──────────────┬──────────────────────────────┘    │
│                 │ HTTP                               │
│  ┌──────────────▼──────────────────────────────┐    │
│  │  Moodle / Kahoot APIs                        │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

The **CLI scripts** are the same regardless of which AI tool drives them. What changes is how you give the AI its instructions.

## Step 1: Install Dependencies

Clone the repository and install dependencies for the plugin(s) you need:

```bash
git clone https://github.com/rudini/claude-edu-plugins.git
cd claude-edu-plugins

# Moodle plugin
cd plugins/moodle-skill && npm install && cd ../..

# Kahoot plugin
cd plugins/kahoot-skill && npm install && cd ../..

# For login commands (both plugins)
npx playwright install chromium
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

Authenticate by running the login commands directly:

```bash
# Moodle — opens browser, saves session cookie to .env
node path/to/claude-edu-plugins/plugins/moodle-skill/scripts/moodle-updater.js login

# Kahoot — opens browser, saves token to .env
node path/to/claude-edu-plugins/plugins/kahoot-skill/scripts/kahoot-creator.js login
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

## GitHub Copilot (VS Code)

### Option A: Custom Instructions (recommended)

Add a `.github/copilot-instructions.md` file to your project:

```markdown
## Moodle Management

To manage the Moodle course, use the CLI tool:

    node /absolute/path/to/moodle-updater.js <command> [args]

Available commands: structure, list-activities <sectionId>, create-url <sectionId> <name> <url>,
create-page <sectionId> <name> <content.md>, create-quiz <sectionId> <name>, import-gift <quizId> <file.gift>,
update-label <cmid> <content.md>, update-page <cmid> <content.md>, delete-activity <cmid> --live,
grade-essay scrape <assignId> --gift <file.gift> --output <grading.json>,
grade-essay submit <assignId> --input <grading.json> --live

Always do a dry-run first (without --live), show the output to the user,
and only add --live after explicit confirmation.

## Kahoot Quiz Creation

    node /absolute/path/to/kahoot-creator.js <command> [args]

Available commands: preview <quiz.json>, create <quiz.json> --live, list, login
```

### Option B: Chat Participant

In Copilot Chat, you can reference the scripts directly:

```
@workspace Use the moodle-updater.js script to show the course structure.
Run: node plugins/moodle-skill/scripts/moodle-updater.js structure
```

---

## OpenAI Codex (CLI)

Codex can run shell commands. Provide instructions via the `AGENTS.md` file or system prompt:

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
- `create-quiz <sectionId> <name>` — create an empty quiz
- `import-gift <quizId> <file.gift>` — import GIFT-format questions
- `delete-activity <cmid> --live` — delete (requires --live flag)
- `grade-essay scrape <assignId> --gift <file> --output <file>` — scrape submissions
- `grade-essay submit <assignId> --input <file> --live` — submit grades

## Kahoot CLI
Location: `plugins/kahoot-skill/scripts/kahoot-creator.js`

Commands:
- `preview <quiz.json>` — validate quiz definition
- `create <quiz.json>` — dry-run, shows what would be created
- `create <quiz.json> --live` — actually create the quiz
- `list` — list existing quizzes

## Safety Rules
- All destructive operations (delete, create --live, submit --live) need the `--live` flag
- Always run without `--live` first and show the user the dry-run output
- Only proceed with `--live` after the user explicitly confirms
```

---

## Cursor

### Custom Rules

Add a `.cursor/rules` file or go to **Settings > Rules for AI**:

```
When I ask about Moodle, use the CLI at plugins/moodle-skill/scripts/moodle-updater.js.
When I ask about Kahoot, use the CLI at plugins/kahoot-skill/scripts/kahoot-creator.js.
Always run destructive commands without --live first, show me the output, and wait for my confirmation before adding --live.
```

### MCP Server (advanced)

If you wrap the CLI scripts as an MCP server, Cursor can consume them natively. See the [Wrapping as MCP Server](#wrapping-as-an-mcp-server) section below.

---

## Windsurf

Add rules via **Settings > AI Rules** or a `.windsurfrules` file:

```
For Moodle course management, execute:
  node plugins/moodle-skill/scripts/moodle-updater.js <command>

For Kahoot quiz management, execute:
  node plugins/kahoot-skill/scripts/kahoot-creator.js <command>

Always perform a dry-run first. Only add --live after user confirms.
```

---

## Wrapping as an MCP Server

For tools that natively support the [Model Context Protocol](https://modelcontextprotocol.io), you can wrap the CLI scripts as an MCP server. This gives the AI tool structured tool definitions instead of freeform instructions.

Below is a minimal example using the MCP SDK:

```javascript
// mcp-edu-server.js
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFileSync } from "child_process";

const MOODLE_SCRIPT = "/absolute/path/to/moodle-updater.js";
const KAHOOT_SCRIPT = "/absolute/path/to/kahoot-creator.js";

function run(script, args) {
  try {
    return execFileSync("node", [script, ...args], {
      encoding: "utf-8",
      timeout: 30000,
    });
  } catch (e) {
    return `Error: ${e.stderr || e.message}`;
  }
}

const server = new McpServer({
  name: "edu-plugins",
  version: "1.0.0",
});

// Moodle tools
server.tool("moodle_structure", "Show Moodle course structure", {}, () => ({
  content: [{ type: "text", text: run(MOODLE_SCRIPT, ["structure"]) }],
}));

server.tool(
  "moodle_list_activities",
  "List activities in a Moodle section",
  { sectionId: z.string().describe("Section ID") },
  ({ sectionId }) => ({
    content: [{ type: "text", text: run(MOODLE_SCRIPT, ["list-activities", sectionId]) }],
  })
);

server.tool(
  "moodle_create_url",
  "Create a URL activity in Moodle (dry-run unless live=true)",
  {
    sectionId: z.string(),
    name: z.string(),
    url: z.string(),
    live: z.boolean().default(false),
  },
  ({ sectionId, name, url, live }) => ({
    content: [{
      type: "text",
      text: run(MOODLE_SCRIPT, ["create-url", sectionId, name, url, ...(live ? ["--live"] : [])]),
    }],
  })
);

// Kahoot tools
server.tool("kahoot_list", "List all Kahoot quizzes", {}, () => ({
  content: [{ type: "text", text: run(KAHOOT_SCRIPT, ["list"]) }],
}));

server.tool(
  "kahoot_create",
  "Create a Kahoot quiz from JSON (dry-run unless live=true)",
  {
    quizFile: z.string().describe("Path to quiz JSON file"),
    live: z.boolean().default(false),
  },
  ({ quizFile, live }) => ({
    content: [{
      type: "text",
      text: run(KAHOOT_SCRIPT, ["create", quizFile, ...(live ? ["--live"] : [])]),
    }],
  })
);

// Add more tools as needed following the same pattern...

const transport = new StdioServerTransport();
await server.connect(transport);
```

Then configure it in your AI tool:

**VS Code / Copilot** (`.vscode/mcp.json`):
```json
{
  "servers": {
    "edu-plugins": {
      "command": "node",
      "args": ["/path/to/mcp-edu-server.js"]
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
      "args": ["/path/to/mcp-edu-server.js"]
    }
  }
}
```

---

## Quick Comparison

| Feature | Claude Code | Copilot | Codex | Cursor | Windsurf |
|---------|------------|---------|-------|--------|----------|
| Plugin install | `/plugin install` | — | — | — | — |
| Instructions file | `SKILL.md` (auto) | `.github/copilot-instructions.md` | `AGENTS.md` | `.cursor/rules` | `.windsurfrules` |
| Runs CLI scripts | Yes | Yes (terminal) | Yes (sandbox) | Yes (terminal) | Yes (terminal) |
| MCP server support | Built-in | Yes | No | Yes | Yes |
| Auto-dependency install | Hooks | Manual | Manual | Manual | Manual |
| Dry-run enforcement | SKILL.md rules | Instructions file | AGENTS.md rules | Rules | Rules |

## Tips

- **Path management**: Use absolute paths to the CLI scripts, or add the plugin directories to your `PATH`.
- **Session expiry**: The Moodle session cookie expires. Re-run the `login` command when you get authentication errors.
- **Dry-run safety**: All tools enforce a dry-run → confirm → `--live` pattern. Make sure your instructions to the AI emphasize this workflow regardless of which tool you use.
- **GIFT format**: The quiz import uses standard [GIFT format](https://docs.moodle.org/en/GIFT_format). All AI tools can generate GIFT syntax if you describe the question format.
