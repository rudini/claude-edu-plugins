#!/usr/bin/env node

/**
 * kahoot-creator.js
 *
 * Creates Kahoot quizzes from JSON definitions via the Kahoot API.
 *
 * Usage:
 *   node kahoot-creator.js preview <quiz.json>
 *   node kahoot-creator.js create <quiz.json> --live
 *   node kahoot-creator.js list
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Fisher-Yates shuffle — randomizes choice order */
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const KAHOOT_API = 'https://create.kahoot.it/rest/kahoots';
const FETCH_TIMEOUT_MS = 15000;

// --- Env Loading ---

function loadEnvFile() {
  const paths = [
    resolve(process.cwd(), '.env'),
    process.env.PLUGIN_DATA_DIR ? resolve(process.env.PLUGIN_DATA_DIR, '.env') : null,
  ].filter(Boolean);

  for (const envPath of paths) {
    if (existsSync(envPath)) {
      const env = readFileSync(envPath, 'utf-8');
      const vars = {};
      for (const line of env.split('\n')) {
        const match = line.match(/^([A-Z_]+)=(.+)$/);
        if (match) vars[match[1]] = match[2].trim();
      }
      return vars;
    }
  }
  return {};
}

function getToken() {
  const envFile = loadEnvFile();
  const token = process.env.KAHOOT_TOKEN || envFile.KAHOOT_TOKEN;
  if (!token || token === 'paste-from-browser-devtools') {
    throw new Error(
      'KAHOOT_TOKEN not set.\n' +
      'Setup: cp .env.example .env && paste token from browser DevTools.\n' +
      '(create.kahoot.it > DevTools > Network > Authorization header)'
    );
  }
  return token;
}

// --- Fetch with Retry ---

async function kahootFetch(url, options = {}) {
  const token = getToken();
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const resp = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (resp.status === 401) {
        throw new Error('401 Unauthorized — KAHOOT_TOKEN has expired. Copy a new token from browser DevTools.');
      }
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status} at ${url}: ${body.substring(0, 200)}`);
      }
      return resp;
    } catch (err) {
      clearTimeout(timer);
      const isNetworkError = err.name === 'AbortError'
        || err.cause?.code === 'ECONNRESET'
        || err.cause?.code === 'ECONNREFUSED'
        || err.message === 'fetch failed';

      if (!isNetworkError || attempt === maxRetries) throw err;

      const delay = 1000 * Math.pow(2, attempt);
      console.log(`  Retry ${attempt + 1}/${maxRetries}: ${err.message} (waiting ${delay}ms...)`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// --- Quiz JSON Loading & Validation ---

function resolveQuizJson(inputPath) {
  const resolved = resolve(inputPath);
  if (!existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  if (!resolved.endsWith('.json')) throw new Error(`Expected a .json file: ${resolved}`);
  return resolved;
}

function loadAndValidateQuiz(jsonPath) {
  const raw = readFileSync(jsonPath, 'utf-8');
  const quiz = JSON.parse(raw);

  // Validate required fields
  if (!quiz.title) throw new Error('Quiz JSON: "title" is missing');
  if (!Array.isArray(quiz.questions) || quiz.questions.length === 0) {
    throw new Error('Quiz JSON: "questions" is missing or empty');
  }

  for (let i = 0; i < quiz.questions.length; i++) {
    const q = quiz.questions[i];
    const prefix = `Question ${i + 1}`;

    if (!q.question?.trim()) throw new Error(`${prefix}: "question" is missing or empty`);
    if (!Array.isArray(q.choices) || q.choices.length < 2) {
      throw new Error(`${prefix}: At least 2 choices required (has ${q.choices?.length || 0})`);
    }
    if (q.choices.length > 4) {
      throw new Error(`${prefix}: Maximum 4 choices allowed (has ${q.choices.length})`);
    }

    const hasCorrect = q.choices.some(c => c.correct === true);
    if (!hasCorrect) throw new Error(`${prefix}: No correct answer marked`);

    for (let j = 0; j < q.choices.length; j++) {
      if (!q.choices[j].answer?.trim()) {
        throw new Error(`${prefix}, Choice ${j + 1}: "answer" is missing or empty`);
      }
    }
  }

  return quiz;
}

// --- Kahoot API Payload ---

function buildPayload(quiz) {
  return {
    title: quiz.title,
    description: quiz.description || '',
    quizType: 'quiz',
    language: quiz.language || 'de',
    audience: 'school',
    questions: quiz.questions.map(q => ({
      type: 'quiz',
      question: q.question,
      time: q.time || (quiz.timeLimit || 20) * 1000,
      points: true,
      choices: shuffleArray(q.choices.map(c => ({
        answer: c.answer,
        correct: c.correct === true,
      }))),
    })),
  };
}

// --- Commands ---

function cmdPreview(jsonPath) {
  const resolved = resolveQuizJson(jsonPath);
  console.log(`Quiz file: ${resolved}\n`);

  const quiz = loadAndValidateQuiz(resolved);
  const payload = buildPayload(quiz);

  console.log(`Title: ${quiz.title}`);
  console.log(`Description: ${quiz.description || '(none)'}`);
  console.log(`Language: ${quiz.language || 'de'}`);
  console.log(`Questions: ${quiz.questions.length}\n`);

  console.log('='.repeat(60));
  for (let i = 0; i < quiz.questions.length; i++) {
    const q = quiz.questions[i];
    const timeSeconds = (q.time || (quiz.timeLimit || 20) * 1000) / 1000;
    console.log(`\n  ${i + 1}. ${q.question} (${timeSeconds}s)`);
    for (const c of q.choices) {
      console.log(`     ${c.correct ? '✓' : '✗'} ${c.answer}`);
    }
  }
  console.log('\n' + '='.repeat(60));
  console.log(`\nValidation OK. ${quiz.questions.length} questions ready.`);

  console.log('\nAPI payload (preview):');
  console.log(JSON.stringify(payload, null, 2));
}

async function cmdCreate(jsonPath, live) {
  const resolved = resolveQuizJson(jsonPath);

  console.log(`Quiz file: ${resolved}\n`);

  const quiz = loadAndValidateQuiz(resolved);
  const payload = buildPayload(quiz);

  console.log(`Quiz: "${quiz.title}" (${quiz.questions.length} questions)`);

  if (!live) {
    console.log('\nDRY RUN — nothing changed. Use --live to create the quiz.');
    console.log('\nAPI payload:');
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  // Create quiz via API
  console.log('\nCreating quiz via Kahoot API...');
  const resp = await kahootFetch(KAHOOT_API, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  const result = await resp.json();
  const uuid = result.uuid;

  if (!uuid) {
    throw new Error('No UUID in API response: ' + JSON.stringify(result).substring(0, 300));
  }

  const kahootUrl = `https://create.kahoot.it/details/${uuid}`;
  console.log(`\nQuiz created: ${kahootUrl}`);
}

function getUserIdFromToken() {
  const token = getToken();
  try {
    const payload = JSON.parse(
      Buffer.from(
        token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'),
        'base64'
      ).toString()
    );
    return payload.sub;
  } catch {
    throw new Error('Could not extract user ID from token. Token invalid?');
  }
}

async function cmdList() {
  console.log('Loading Kahoots...\n');

  const userId = getUserIdFromToken();
  const resp = await kahootFetch(`https://create.kahoot.it/rest/folders/${userId}`);
  const data = await resp.json();

  const entities = data.kahoots?.entities || [];
  if (entities.length === 0) {
    console.log('No Kahoots found.');
    return;
  }

  console.log(`${entities.length} Kahoots:\n`);
  for (const e of entities) {
    const k = e.card;
    const date = k.created ? new Date(k.created).toLocaleDateString('en-US') : '?';
    const questions = k.number_of_questions || '?';
    console.log(`  ${k.title} (${questions} questions, ${date})`);
    console.log(`  → https://create.kahoot.it/details/${k.uuid}\n`);
  }
}

// --- Env Update ---

function updateEnvFile(key, value) {
  const paths = [
    resolve(process.cwd(), '.env'),
    process.env.PLUGIN_DATA_DIR ? resolve(process.env.PLUGIN_DATA_DIR, '.env') : null,
  ].filter(Boolean);

  // Write to the first existing .env, or create in CWD
  const envPath = paths.find(p => existsSync(p)) || paths[0];
  let content = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content = content.trimEnd() + `\n${key}=${value}\n`;
  }
  writeFileSync(envPath, content, 'utf-8');
  return envPath;
}

// --- Login ---

async function ensureDependencies() {
  const { execSync } = await import('child_process');
  const dataDir = process.env.CLAUDE_PLUGIN_DATA;
  if (!dataDir) return; // not running as plugin

  const targetPkg = resolve(dataDir, 'package.json');
  if (!existsSync(resolve(dataDir, 'node_modules', 'playwright'))) {
    console.log('Dependencies not found — installing automatically (one-time)...\n');
    const srcPkg = resolve(__dirname, '..', 'package.json');
    execSync(`cp "${srcPkg}" "${targetPkg}" && cd "${dataDir}" && npm install --ignore-scripts`, { stdio: 'inherit' });
  }
}

async function ensurePlaywrightBrowser() {
  const { execSync } = await import('child_process');
  await ensureDependencies();
  try {
    // Quick check: can Playwright resolve a Chromium executable?
    const { chromium } = await import('playwright');
    chromium.executablePath();
  } catch {
    console.log('Chromium not found — installing automatically (one-time)...\n');
    execSync('npx playwright install chromium', { stdio: 'inherit' });
  }
}

async function cmdLogin() {
  if (!process.stdin.isTTY) {
    console.error('Error: login requires an interactive terminal.');
    process.exit(1);
  }
  await ensurePlaywrightBrowser();
  console.log('Opening browser for Kahoot login...\n');
  const { chromium } = await import('playwright');
  const profileDir = resolve(__dirname, '.browser-profile');
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: ['--no-first-run'],
  });
  const page = context.pages()[0] || await context.newPage();

  let capturedToken = null;
  const tokenListener = request => {
    const url = request.url();
    if (url.includes('/rest/') || url.includes('/api/')) {
      const auth = request.headers()['authorization'];
      if (auth && auth.startsWith('Bearer ')) {
        capturedToken = auth.replace('Bearer ', '');
      }
    }
  };
  context.on('request', tokenListener);

  await page.goto('https://create.kahoot.it/auth/login');

  const rl = await import('readline');
  const iface = rl.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => iface.question(
    'Log in via the browser, then press ENTER here... ',
    () => { iface.close(); resolve(); }
  ));

  context.off('request', tokenListener);

  if (!capturedToken) {
    console.log('No token captured from requests, navigating to dashboard...');
    const tokenPromise = new Promise(resolve => {
      const handler = request => {
        const auth = request.headers()['authorization'];
        if (auth && auth.startsWith('Bearer ')) {
          capturedToken = auth.replace('Bearer ', '');
          context.off('request', handler);
          resolve();
        }
      };
      context.on('request', handler);
      setTimeout(() => resolve(), 10000);
    });
    await page.goto('https://create.kahoot.it/kahoots/authored');
    await tokenPromise;
  }

  if (!capturedToken) {
    console.error('Error: Could not capture Bearer token. Are you logged in?');
    await context.close();
    process.exit(1);
  }

  const envPath = updateEnvFile('KAHOOT_TOKEN', capturedToken);
  console.log(`\nKAHOOT_TOKEN saved to ${envPath}`);
  await context.close();
}

// --- Help ---

function showHelp() {
  console.log(`Kahoot Quiz Creator — Create Kahoot quizzes from JSON definitions

Setup:
  login                      Open browser, log in, token is saved automatically
  -- or manually: --
  1. Create a .env file with KAHOOT_TOKEN=<your-token>
  2. Get token from: create.kahoot.it > DevTools > Network > Authorization header

Commands:
  preview <quiz.json>        Validate and preview quiz structure (no API call)
  create <quiz.json>         Create quiz via Kahoot API (dry run by default)
  create <quiz.json> --live  Create quiz for real
  list                       List existing Kahoots for the authenticated user

Flags:
  --live       Actually execute changes (default: dry run)
  --help, -h   Show this help

Examples:
  node kahoot-creator.js login
  node kahoot-creator.js preview ./quizzes/my-quiz.json
  node kahoot-creator.js create ./quizzes/my-quiz.json
  node kahoot-creator.js create ./quizzes/my-quiz.json --live
  node kahoot-creator.js list

Quiz JSON format:
  {
    "title": "My Quiz",
    "description": "Optional description",
    "language": "en",
    "timeLimit": 20,
    "questions": [
      {
        "question": "What is 2+2?",
        "choices": [
          { "answer": "4", "correct": true },
          { "answer": "5", "correct": false }
        ]
      }
    ]
  }`);
}

// --- Main ---

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h') || args.length === 0) {
  showHelp();
  process.exit(0);
}

const live = args.includes('--live');
const cleanArgs = args.filter(a => !a.startsWith('--'));
const command = cleanArgs[0];

try {
  switch (command) {
    case 'login':
      await cmdLogin();
      break;

    case 'preview':
      if (!cleanArgs[1]) throw new Error('Usage: preview <quiz.json>');
      cmdPreview(cleanArgs[1]);
      break;

    case 'create':
      if (!cleanArgs[1]) throw new Error('Usage: create <quiz.json>');
      await cmdCreate(cleanArgs[1], live);
      break;

    case 'list':
      await cmdList();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Show help: node kahoot-creator.js --help');
      process.exit(1);
  }
} catch (err) {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
}
