# Claude Edu Plugins

Claude Code plugins for education tools — **Moodle** course management and **Kahoot** quiz creation.

## Installation

```bash
# Add marketplace
/plugin marketplace add rudini/claude-edu-plugins

# Install Moodle skill
/plugin install moodle-skill@claude-edu-plugins

# Install Kahoot skill (optional)
/plugin install kahoot-skill@claude-edu-plugins
```

## Moodle Skill

Manage any Moodle course: create/update/delete activities, sections, quizzes, import GIFT questions, and AI-assisted essay grading.

### Setup

Create a `.env` file in your project root:

```env
MOODLE_URL=https://your-moodle-instance.example.com
MOODLE_SESSION=
COURSE_ID=1234
```

Then authenticate (browser opens and closes automatically after login):

```
/moodle-skill:moodle login
```

Use `--browser msedge` or `--browser chrome` if your org requires a specific browser for SSO.

### Quick Start

```
/moodle-skill:moodle structure              # Show course structure
/moodle-skill:moodle list-activities 123     # List activities in section 123
/moodle-skill:moodle create-url 5 "Docs" "https://example.com"  # Create URL
/moodle-skill:moodle grade-essay scrape 456 --gift quiz.gift --output grading.json
```

### Commands

| Group | Command | Description |
|-------|---------|-------------|
| Setup | `login [--browser msedge\|chrome]` | Browser login, save cookie (auto-closes) |
| Read | `structure`, `list-activities`, `show-label`, `show-page` | Inspect course |
| Update | `update-label`, `update-page`, `update-summary` | Modify content |
| CRUD | `create-url`, `create-page`, `create-resource`, `create-assign`, `create-forum`, `create-quiz` | Create activities |
| Manage | `delete-activity`, `hide-activity`, `indent-activity`, `move-activity` | Manage activities |
| Sections | `add-section`, `delete-section`, `duplicate-section`, `move-section`, `rename-section` | Manage sections |
| Quiz | `import-gift`, `add-questions-to-quiz`, `delete-quiz-questions` | Quiz management |
| Grading | `grade-essay scrape`, `grade-essay submit` | AI essay grading |
| Diagnostic | `dump-form`, `dump-grading` | Debug tools |

### Course Round-Trip (download → edit → re-upload)

In addition to the per-command CLI, the plugin ships standalone scripts to mirror a whole course locally and append it to another course:

```bash
# 1. Download the source course (uses MOODLE_URL / COURSE_ID from .env) into ./kurs
node plugins/moodle-skill/scripts/download-course.js ./kurs

# 2. Preview what would be uploaded to the target course (.env again)
node plugins/moodle-skill/scripts/upload-course.js ./kurs

# 3. Append each section as a NEW section to the target course
node plugins/moodle-skill/scripts/execute-upload.js ./kurs --live
```

`execute-upload.js` is append-only — existing sections in the target course are never touched. Use `--section <NN>` to upload a single source section. See [SKILL.md](plugins/moodle-skill/skills/moodle/SKILL.md#course-round-trip-workflow-download--edit--re-upload) for the full layout.

## Kahoot Skill

Create and manage Kahoot quizzes from JSON definitions.

### Setup

```
/kahoot-skill:kahoot login
```

Use `--browser msedge` or `--browser chrome` for SSO. Or create `.env` manually with `KAHOOT_TOKEN=...`

### Quick Start

```
/kahoot-skill:kahoot preview quiz.json    # Validate quiz
/kahoot-skill:kahoot create quiz.json     # Dry-run
/kahoot-skill:kahoot list                 # List all quizzes
```

### Quiz JSON Format

```json
{
  "title": "My Quiz",
  "questions": [
    {
      "question": "What is 2 + 2?",
      "choices": [
        { "answer": "4", "correct": true },
        { "answer": "5", "correct": false }
      ]
    }
  ]
}
```

## Environment Variables

### Moodle

| Variable | Required | Description |
|----------|----------|-------------|
| `MOODLE_URL` | Yes | Your Moodle instance URL |
| `MOODLE_SESSION` | Yes | Session cookie (set via `login` command) |
| `COURSE_ID` | Yes | Course ID from course URL (`?id=XXXX`) |
| `MOODLE_TZ` | No | Timezone (default: `Europe/Zurich`) |

### Kahoot

| Variable | Required | Description |
|----------|----------|-------------|
| `KAHOOT_TOKEN` | Yes | Bearer token (set via `login` command) |

## Using with Other AI Tools

Not using Claude Code? This project includes a ready-to-use **MCP server** that works with any MCP-compatible agent — GitHub Copilot, OpenAI Codex, Cursor, Windsurf, Gemini CLI, and more.

```bash
# Install the MCP server
cd plugins/mcp-server && npm install
```

Then add it to your tool's MCP config (e.g. `.vscode/mcp.json`, `.codex/mcp.json`, `~/.gemini/settings.json`):

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

See **[USAGE_OTHER_TOOLS.md](USAGE_OTHER_TOOLS.md)** for per-tool configuration, instruction file alternatives, and the full list of 31 MCP tools.

## Support This Project

If these plugins save you time, consider sponsoring to support ongoing development:

[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-pink?style=for-the-badge&logo=github-sponsors)](https://github.com/sponsors/rudini)

Even a small contribution helps keep this project maintained and improved. Thank you!

## License

MIT
