---
name: kahoot
description: "Create and manage Kahoot quizzes from JSON definitions. Use /kahoot-skill:kahoot to create, preview, or list quizzes."
argument-hint: "[command] [args...]"
disable-model-invocation: true
---

# Kahoot Skill — Quiz Management

Create and manage Kahoot quizzes from JSON definitions via the `kahoot-creator.js` CLI.

## When This Skill Activates

- Explicit: `/kahoot-skill:kahoot`, `/kahoot-skill:kahoot list`

## Prerequisites

- **`.env`** in your project root with `KAHOOT_TOKEN`
- **Token**: Run `login` to authenticate via browser (saves token automatically)
- **Quiz JSON**: A `.json` file with quiz definition (see format below)

## Workflow

### Phase 1: Parse Command

1. Parse `$ARGUMENTS` — if arguments provided, proceed to Phase 2.
2. If empty, present the Command Reference and ask which command to run.

### Phase 2: Execute

**`login`**: Execute directly — opens browser for authentication.

**Read-only** (`preview`, `list`): Execute directly.

```bash
NODE_PATH="${CLAUDE_PLUGIN_DATA}/node_modules" node "${CLAUDE_PLUGIN_ROOT}/scripts/kahoot-creator.js" <command> <args...>
```

**`create`**: Execute WITHOUT `--live` first (dry-run default). Then ask for confirmation.

```bash
NODE_PATH="${CLAUDE_PLUGIN_DATA}/node_modules" node "${CLAUDE_PLUGIN_ROOT}/scripts/kahoot-creator.js" create <quiz.json> --live
```

## Command Reference

| Command | Arguments | Description |
|---------|-----------|-------------|
| `login` | — | Open browser, login, save token to .env |
| `preview` | `<quiz.json>` | Validate and show quiz structure (no API call) |
| `create` | `<quiz.json> [--live]` | Create quiz via Kahoot API |
| `list` | — | List all own Kahoots |

## Quiz JSON Format

```json
{
  "title": "My Quiz",
  "description": "Optional description",
  "language": "en",
  "timeLimit": 20,
  "questions": [
    {
      "question": "What is 2 + 2?",
      "choices": [
        { "answer": "4", "correct": true },
        { "answer": "5", "correct": false },
        { "answer": "3", "correct": false }
      ]
    }
  ]
}
```

**Required fields:**
- `title` (string)
- `questions` (array, at least 1)
- Per question: `question` (string), `choices` (2-4 items with `answer` + `correct`)

**Optional fields:**
- `description` (string)
- `language` (string, default: `"en"`)
- `timeLimit` (number, default: 20 seconds per question)
- Per question: `time` (number, override in milliseconds)

Choices are automatically shuffled (Fisher-Yates) before API submission.

## Rules

1. **`create` without `--live` = dry-run** — no API call.
2. **Always preview or dry-run first.**
3. **Never run `--live` without explicit user confirmation.**
4. **Do NOT invoke this skill autonomously** — only on explicit `/kahoot-skill:kahoot`.
5. If a command fails with a token error, tell the user to run `login` again.
