#!/usr/bin/env node

/**
 * MCP server for Claude Edu Plugins.
 *
 * Wraps all Moodle and Kahoot CLI commands as structured MCP tools so any
 * MCP-compatible agent (Claude Code, Copilot, Codex, Cursor, Windsurf,
 * Gemini CLI, etc.) can call them directly.
 *
 * Usage:
 *   node mcp-edu-server.js
 *
 * The server communicates over stdio (stdin/stdout) using the MCP protocol.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOODLE_SCRIPT = resolve(__dirname, "../moodle-skill/scripts/moodle-updater.js");
const KAHOOT_SCRIPT = resolve(__dirname, "../kahoot-skill/scripts/kahoot-creator.js");

// ---------------------------------------------------------------------------
// Helper: run a CLI script and return its output
// ---------------------------------------------------------------------------

function run(script, args, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    execFile("node", [script, ...args], { encoding: "utf-8", timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        resolve(`Error (exit ${err.code ?? "?"}): ${stderr || err.message}\n${stdout}`.trim());
      } else {
        resolve((stdout + (stderr ? `\n${stderr}` : "")).trim());
      }
    });
  });
}

function text(promise) {
  return promise.then((output) => ({
    content: [{ type: "text", text: output || "(no output)" }],
  }));
}

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "edu-plugins",
  version: "1.0.0",
});

// ===========================================================================
//  MOODLE TOOLS
// ===========================================================================

// --- Authentication ---

server.tool(
  "moodle_login",
  "Open browser to log in to Moodle and save session cookie to .env",
  { browser: z.enum(["msedge", "chrome"]).optional().describe("Browser to use for SSO login") },
  ({ browser }) => text(run(MOODLE_SCRIPT, ["login", ...(browser ? ["--browser", browser] : [])], 120_000))
);

// --- Read operations ---

server.tool(
  "moodle_structure",
  "Show the full Moodle course structure (sections and activities)",
  {},
  () => text(run(MOODLE_SCRIPT, ["structure"]))
);

server.tool(
  "moodle_list_activities",
  "List all activities in a Moodle section",
  { sectionId: z.string().describe("Section ID") },
  ({ sectionId }) => text(run(MOODLE_SCRIPT, ["list-activities", sectionId]))
);

server.tool(
  "moodle_show_label",
  "Show the content of a Moodle label",
  { cmid: z.string().describe("Course module ID of the label") },
  ({ cmid }) => text(run(MOODLE_SCRIPT, ["show-label", cmid]))
);

server.tool(
  "moodle_show_page",
  "Show the content of a Moodle page",
  { cmid: z.string().describe("Course module ID of the page") },
  ({ cmid }) => text(run(MOODLE_SCRIPT, ["show-page", cmid]))
);

// --- Update operations ---

server.tool(
  "moodle_update_label",
  "Update a Moodle label from a Markdown/HTML file (dry-run unless live=true)",
  {
    cmid: z.string().describe("Course module ID of the label"),
    contentFile: z.string().describe("Path to Markdown or HTML file with new content"),
    live: z.boolean().default(false).describe("Set true to apply changes (default: dry-run)"),
  },
  ({ cmid, contentFile, live }) =>
    text(run(MOODLE_SCRIPT, ["update-label", cmid, contentFile, ...(live ? ["--live"] : [])]))
);

server.tool(
  "moodle_update_page",
  "Update a Moodle page from a Markdown/HTML file (dry-run unless live=true)",
  {
    cmid: z.string().describe("Course module ID of the page"),
    contentFile: z.string().describe("Path to Markdown or HTML file with new content"),
    live: z.boolean().default(false).describe("Set true to apply changes (default: dry-run)"),
  },
  ({ cmid, contentFile, live }) =>
    text(run(MOODLE_SCRIPT, ["update-page", cmid, contentFile, ...(live ? ["--live"] : [])]))
);

server.tool(
  "moodle_update_summary",
  "Update a Moodle section summary from a Markdown/HTML file (dry-run unless live=true)",
  {
    sectionId: z.string().describe("Section ID"),
    contentFile: z.string().describe("Path to Markdown or HTML file with new summary"),
    live: z.boolean().default(false).describe("Set true to apply changes (default: dry-run)"),
  },
  ({ sectionId, contentFile, live }) =>
    text(run(MOODLE_SCRIPT, ["update-summary", sectionId, contentFile, ...(live ? ["--live"] : [])]))
);

// --- Create operations ---

server.tool(
  "moodle_create_url",
  "Create a URL activity in a Moodle section (dry-run unless live=true)",
  {
    sectionNum: z.string().describe("Section number"),
    name: z.string().describe("Display name"),
    url: z.string().describe("URL"),
    live: z.boolean().default(false).describe("Set true to apply changes (default: dry-run)"),
  },
  ({ sectionNum, name, url, live }) =>
    text(run(MOODLE_SCRIPT, ["create-url", sectionNum, name, url, ...(live ? ["--live"] : [])]))
);

server.tool(
  "moodle_create_page",
  "Create a new Moodle page from a Markdown/HTML file (dry-run unless live=true)",
  {
    sectionNum: z.string().describe("Section number"),
    name: z.string().describe("Page name"),
    contentFile: z.string().describe("Path to Markdown or HTML file"),
    live: z.boolean().default(false).describe("Set true to apply changes (default: dry-run)"),
  },
  ({ sectionNum, name, contentFile, live }) =>
    text(run(MOODLE_SCRIPT, ["create-page", sectionNum, name, contentFile, ...(live ? ["--live"] : [])]))
);

server.tool(
  "moodle_create_resource",
  "Upload a file resource to a Moodle section (dry-run unless live=true)",
  {
    sectionNum: z.string().describe("Section number"),
    name: z.string().describe("Resource name"),
    filePath: z.string().describe("Path to the file to upload"),
    live: z.boolean().default(false).describe("Set true to apply changes (default: dry-run)"),
  },
  ({ sectionNum, name, filePath, live }) =>
    text(run(MOODLE_SCRIPT, ["create-resource", sectionNum, name, filePath, ...(live ? ["--live"] : [])], 180_000))
);

server.tool(
  "moodle_create_assign",
  "Create an assignment in Moodle (dry-run unless live=true)",
  {
    sectionNum: z.string().describe("Section number"),
    name: z.string().describe("Assignment name"),
    contentFile: z.string().describe("Path to HTML file with assignment description"),
    live: z.boolean().default(false).describe("Set true to apply changes (default: dry-run)"),
    open: z.string().optional().describe("Open date as Unix timestamp"),
    due: z.string().optional().describe("Due date as Unix timestamp"),
  },
  ({ sectionNum, name, contentFile, live, open, due }) =>
    text(run(MOODLE_SCRIPT, [
      "create-assign", sectionNum, name, contentFile,
      ...(live ? ["--live"] : []),
      ...(open ? ["--open", open] : []),
      ...(due ? ["--due", due] : []),
    ]))
);

server.tool(
  "moodle_create_forum",
  "Create a forum in Moodle (dry-run unless live=true)",
  {
    sectionNum: z.string().describe("Section number"),
    name: z.string().describe("Forum name"),
    contentFile: z.string().describe("Path to HTML file with forum intro"),
    live: z.boolean().default(false).describe("Set true to apply changes (default: dry-run)"),
  },
  ({ sectionNum, name, contentFile, live }) =>
    text(run(MOODLE_SCRIPT, ["create-forum", sectionNum, name, contentFile, ...(live ? ["--live"] : [])]))
);

server.tool(
  "moodle_create_quiz",
  "Create a quiz in Moodle from a JSON config (dry-run unless live=true)",
  {
    sectionNum: z.string().describe("Section number"),
    configFile: z.string().describe("Path to quiz config JSON file"),
    live: z.boolean().default(false).describe("Set true to apply changes (default: dry-run)"),
  },
  ({ sectionNum, configFile, live }) =>
    text(run(MOODLE_SCRIPT, ["create-quiz", sectionNum, configFile, ...(live ? ["--live"] : [])]))
);

// --- Section operations ---

server.tool(
  "moodle_duplicate_section",
  "Duplicate the last Moodle section (dry-run unless live=true)",
  { live: z.boolean().default(false).describe("Set true to apply changes (default: dry-run)") },
  ({ live }) => text(run(MOODLE_SCRIPT, ["duplicate-section", ...(live ? ["--live"] : [])]))
);

server.tool(
  "moodle_rename_section",
  "Rename a Moodle section (dry-run unless live=true)",
  {
    sectionId: z.string().describe("Section ID"),
    name: z.string().describe("New section name"),
    live: z.boolean().default(false).describe("Set true to apply changes (default: dry-run)"),
  },
  ({ sectionId, name, live }) =>
    text(run(MOODLE_SCRIPT, ["rename-section", sectionId, name, ...(live ? ["--live"] : [])]))
);

server.tool(
  "moodle_move_section",
  "Move a Moodle section before another section (dry-run unless live=true)",
  {
    sectionId: z.string().describe("Section ID to move"),
    targetSectionId: z.string().describe("Target section ID (move before this)"),
    live: z.boolean().default(false).describe("Set true to apply changes (default: dry-run)"),
  },
  ({ sectionId, targetSectionId, live }) =>
    text(run(MOODLE_SCRIPT, ["move-section", sectionId, targetSectionId, ...(live ? ["--live"] : [])]))
);

server.tool(
  "moodle_delete_section",
  "Delete a Moodle section (dry-run unless live=true)",
  {
    sectionId: z.string().describe("Section ID to delete"),
    live: z.boolean().default(false).describe("Set true to apply changes (default: dry-run)"),
  },
  ({ sectionId, live }) =>
    text(run(MOODLE_SCRIPT, ["delete-section", sectionId, ...(live ? ["--live"] : [])]))
);

// --- Activity operations ---

server.tool(
  "moodle_delete_activity",
  "Delete a Moodle activity (dry-run unless live=true)",
  {
    cmid: z.string().describe("Course module ID"),
    live: z.boolean().default(false).describe("Set true to apply changes (default: dry-run)"),
  },
  ({ cmid, live }) =>
    text(run(MOODLE_SCRIPT, ["delete-activity", cmid, ...(live ? ["--live"] : [])]))
);

server.tool(
  "moodle_indent_activity",
  "Indent a Moodle activity (dry-run unless live=true)",
  {
    cmid: z.string().describe("Course module ID"),
    live: z.boolean().default(false).describe("Set true to apply changes (default: dry-run)"),
  },
  ({ cmid, live }) =>
    text(run(MOODLE_SCRIPT, ["indent-activity", cmid, ...(live ? ["--live"] : [])]))
);

server.tool(
  "moodle_hide_activity",
  "Hide a Moodle activity (dry-run unless live=true)",
  {
    cmid: z.string().describe("Course module ID"),
    live: z.boolean().default(false).describe("Set true to apply changes (default: dry-run)"),
  },
  ({ cmid, live }) =>
    text(run(MOODLE_SCRIPT, ["hide-activity", cmid, ...(live ? ["--live"] : [])]))
);

server.tool(
  "moodle_move_activity",
  "Move a Moodle activity to a different section (dry-run unless live=true)",
  {
    cmid: z.string().describe("Course module ID to move"),
    targetSectionId: z.string().describe("Target section ID"),
    live: z.boolean().default(false).describe("Set true to apply changes (default: dry-run)"),
  },
  ({ cmid, targetSectionId, live }) =>
    text(run(MOODLE_SCRIPT, ["move-activity", cmid, targetSectionId, ...(live ? ["--live"] : [])]))
);

// --- Quiz operations ---

server.tool(
  "moodle_import_gift",
  "Import GIFT-format questions into a Moodle quiz",
  {
    cmid: z.string().describe("Course module ID of the quiz"),
    giftFile: z.string().describe("Path to GIFT file"),
  },
  ({ cmid, giftFile }) => text(run(MOODLE_SCRIPT, ["import-gift", cmid, giftFile], 120_000))
);

server.tool(
  "moodle_delete_quiz_questions",
  "Delete all questions from a Moodle quiz category",
  {
    cmid: z.string().describe("Course module ID of the quiz"),
    categoryName: z.string().optional().describe("Category name (default: quiz's default category)"),
  },
  ({ cmid, categoryName }) =>
    text(run(MOODLE_SCRIPT, ["delete-quiz-questions", cmid, ...(categoryName ? [categoryName] : [])]))
);

server.tool(
  "moodle_add_questions_to_quiz",
  "Add questions from a category to a Moodle quiz",
  {
    cmid: z.string().describe("Course module ID of the quiz"),
    categoryName: z.string().optional().describe("Category name"),
  },
  ({ cmid, categoryName }) =>
    text(run(MOODLE_SCRIPT, ["add-questions-to-quiz", cmid, ...(categoryName ? [categoryName] : [])]))
);

// --- AI Grading ---

server.tool(
  "moodle_grade_essay",
  "AI-assisted essay grading: scrape submissions, grade with AI, and submit grades",
  {
    cmid: z.string().describe("Course module ID of the assignment"),
    giftFile: z.string().optional().describe("Path to GIFT file with expected answers"),
    slot: z.string().optional().describe("Slot number to grade"),
    model: z.string().optional().describe("AI model name for grading"),
    report: z.string().optional().describe("Path to save grading report"),
    regrade: z.boolean().optional().describe("Re-grade already graded submissions"),
    live: z.boolean().default(false).describe("Set true to submit grades (default: dry-run)"),
  },
  ({ cmid, giftFile, slot, model, report, regrade, live }) =>
    text(run(MOODLE_SCRIPT, [
      "grade-essay", cmid,
      ...(giftFile ? ["--gift", giftFile] : []),
      ...(slot ? ["--slot", slot] : []),
      ...(model ? ["--model", model] : []),
      ...(report ? ["--report", report] : []),
      ...(regrade ? ["--regrade"] : []),
      ...(live ? ["--live"] : []),
    ], 300_000))
);

// ===========================================================================
//  KAHOOT TOOLS
// ===========================================================================

server.tool(
  "kahoot_login",
  "Open browser to log in to Kahoot and save token to .env",
  { browser: z.enum(["msedge", "chrome"]).optional().describe("Browser to use for SSO login") },
  ({ browser }) => text(run(KAHOOT_SCRIPT, ["login", ...(browser ? ["--browser", browser] : [])], 120_000))
);

server.tool(
  "kahoot_list",
  "List all Kahoot quizzes",
  {},
  () => text(run(KAHOOT_SCRIPT, ["list"]))
);

server.tool(
  "kahoot_preview",
  "Validate and preview a Kahoot quiz JSON definition",
  { quizFile: z.string().describe("Path to quiz JSON file") },
  ({ quizFile }) => text(run(KAHOOT_SCRIPT, ["preview", quizFile]))
);

server.tool(
  "kahoot_create",
  "Create a Kahoot quiz from JSON (dry-run unless live=true)",
  {
    quizFile: z.string().describe("Path to quiz JSON file"),
    live: z.boolean().default(false).describe("Set true to create the quiz (default: dry-run)"),
  },
  ({ quizFile, live }) =>
    text(run(KAHOOT_SCRIPT, ["create", quizFile, ...(live ? ["--live"] : [])]))
);

server.tool(
  "kahoot_host",
  "Open a Kahoot game lobby in the browser for hosting",
  { identifier: z.string().describe("Quiz UUID, URL, or path to quiz.json") },
  ({ identifier }) => text(run(KAHOOT_SCRIPT, ["host", identifier], 120_000))
);

// ===========================================================================
//  Start server
// ===========================================================================

const transport = new StdioServerTransport();
await server.connect(transport);
