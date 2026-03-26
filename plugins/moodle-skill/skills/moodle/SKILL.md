---
name: moodle
description: "Manage Moodle courses via CLI — create/update/delete activities, sections, quizzes, import GIFT questions, and AI-assisted essay grading. Use /moodle-skill:moodle to interact with any Moodle instance."
argument-hint: "[command] [args...]"
disable-model-invocation: true
---

# Moodle Skill — Generic Moodle Course Management

Manage any Moodle course via the `moodle-updater.js` CLI. All destructive operations require a dry-run first, then explicit user confirmation before `--live`.

## When This Skill Activates

- Explicit: `/moodle-skill:moodle`, `/moodle-skill:moodle structure`

## Prerequisites

- **`.env`** in your project root with `MOODLE_URL`, `MOODLE_SESSION`, and `COURSE_ID`
- **Dependencies**: Auto-installed on first session via hooks (jsdom, marked, playwright)
- **Playwright browser**: Run `npx playwright install chromium` once for the `login` command

## Workflow

### Phase 1: Parse Command

1. Parse `$ARGUMENTS` — if arguments provided, use as command + args and proceed to Phase 2.
2. If `$ARGUMENTS` is empty, present the Command Reference Table below and ask which command to run.

### Phase 2: Dry-Run

**`login` command**: Execute directly — opens a browser for interactive authentication.

**Read-only commands** (`structure`, `list-activities`, `show-label`, `show-page`, `dump-form`, `dump-grading`): Execute directly.

```bash
NODE_PATH="${CLAUDE_PLUGIN_DATA}/node_modules" node "${CLAUDE_PLUGIN_ROOT}/scripts/moodle-updater.js" <command> <args...>
```

**All other commands**: Execute WITHOUT `--live` first (dry-run is the default).

### Phase 3: Live Execution

After showing the dry-run output, ask the user for confirmation before running with `--live`.

```bash
NODE_PATH="${CLAUDE_PLUGIN_DATA}/node_modules" node "${CLAUDE_PLUGIN_ROOT}/scripts/moodle-updater.js" <command> <args...> --live
```

## Command Reference

| Group | Command | Arguments | Description |
|-------|---------|-----------|-------------|
| **Setup** | `login` | — | Open browser, login, save cookie to .env |
| **Read** | `structure` | — | Show course structure |
| **Read** | `list-activities` | `<sectionId>` | List activities in a section |
| **Read** | `show-label` | `<moduleId>` | Show label HTML |
| **Read** | `show-page` | `<moduleId>` | Show page HTML |
| **Update** | `update-label` | `<moduleId> <htmlFile>` | Replace label content |
| **Update** | `update-page` | `<moduleId> <htmlFile>` | Replace page content |
| **Update** | `update-summary` | `<sectionId> <htmlFile>` | Replace section summary |
| **CRUD** | `create-url` | `<sectionNum> <name> <url>` | Create URL activity |
| **CRUD** | `create-page` | `<sectionNum> <name> <htmlFile>` | Create text page |
| **CRUD** | `create-resource` | `<sectionNum> <name> <file>` | Upload file resource |
| **CRUD** | `create-assign` | `<sectionNum> <name> <htmlFile> [--open ts] [--due ts]` | Create assignment |
| **CRUD** | `create-forum` | `<sectionNum> <name> <htmlFile>` | Create forum |
| **CRUD** | `create-quiz` | `<sectionNum> <configJson>` | Create quiz (SEB, time limit) |
| **Manage** | `delete-activity` | `<moduleId>` | Delete activity |
| **Manage** | `hide-activity` | `<moduleId>` | Hide activity |
| **Manage** | `indent-activity` | `<moduleId>` | Indent activity |
| **Manage** | `move-activity` | `<moduleId> <afterModuleId>` | Move activity |
| **Sections** | `delete-section` | `<sectionId>` | Delete section |
| **Sections** | `duplicate-section` | — | Duplicate last section |
| **Sections** | `move-section` | `<sectionId> <targetSectionId>` | Move section before target |
| **Sections** | `rename-section` | `<sectionId> <title>` | Rename section |
| **Quiz** | `import-gift` | `<cmid> <giftFile>` | Import GIFT questions |
| **Quiz** | `add-questions-to-quiz` | `<cmid> [categoryName]` | Assign questions to quiz |
| **Quiz** | `delete-quiz-questions` | `<cmid> [categoryName]` | Delete questions in category |
| **Grading** | `grade-essay scrape` | `<cmid> --gift <path> [--slot N] --output <file>` | Export student responses as JSON |
| **Grading** | `grade-essay submit` | `<cmid> --grades <file> [--live]` | Submit grades to Moodle |
| **Diagnostic** | `dump-form` | `<type> <sectionNum>` | Inspect form fields |
| **Diagnostic** | `dump-grading` | `<cmid> [--slot N]` | Inspect grading page |

## grade-essay Workflow

The AI grading workflow is split into scrape → grade → submit:

### Step 1: Scrape student responses

```bash
NODE_PATH="${CLAUDE_PLUGIN_DATA}/node_modules" node "${CLAUDE_PLUGIN_ROOT}/scripts/moodle-updater.js" grade-essay scrape <cmid> --gift <path> --output grading.json
```

This produces a JSON file with questions (criteria, model answers) and student responses.

### Step 2: Grade (done by Claude in this conversation)

Read the JSON file, grade each student response against the criteria, and produce a grades JSON file.

### Step 3: Submit grades

```bash
NODE_PATH="${CLAUDE_PLUGIN_DATA}/node_modules" node "${CLAUDE_PLUGIN_ROOT}/scripts/moodle-updater.js" grade-essay submit <cmid> --grades grades-result.json --live
```

## Session Handling

- **Primary method**: `login` opens a browser, user logs in, cookie is saved to `.env`.
- The `MoodleSession` cookie expires after inactivity. If a command fails with a session error, run `login` again.
- Use `structure` as a quick connection test.

## Rules

1. **Never run `--live` without a dry-run first** (except read-only commands).
2. **Never run `--live` without explicit user confirmation.**
3. **Do NOT invoke this skill autonomously** — only on explicit `/moodle-skill:moodle`.
4. If a command fails with a session error, tell the user to run `login` again.
