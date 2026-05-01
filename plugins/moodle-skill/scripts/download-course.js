#!/usr/bin/env node

/**
 * download-course.js
 *
 * Downloads a Moodle course into a round-trip-friendly structure:
 *
 *   <outDir>/
 *     course.json                          # courseId, moodleUrl, downloadedAt
 *     README.md                            # human overview
 *     state.json                           # raw Moodle course state
 *     <NN>-<section-slug>/
 *       section.json                       # { id, number, title, hasSummary }
 *       summary.md                         # section summary (if present)
 *       <MM>-<type>-<slug>/                # one folder per activity
 *         activity.json                    # full metadata for re-upload
 *         content.md                       # MD body (label, page, assign, quiz, forum, attendance)
 *         files/<originalname>             # for resource modules: actual file
 *
 * Upload mapping (matches existing moodle-updater.js commands):
 *   page    → create-page    <sectionNum> <name> content.md  (run through markdownFileToHtml)
 *   label   → create-label   <sectionNum> content.md          (likewise)
 *   assign  → create-assign  <sectionNum> <name> content.md
 *   forum   → create-forum   <sectionNum> <name> content.md
 *   url     → create-url     <sectionNum> <name> <externalUrl>
 *   resource→ create-resource<sectionNum> <name> files/<file>
 *
 * Usage:  node download-course.js <outDir>
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, createWriteStream } from 'fs';
import { resolve, join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';

// --- Config ---
export function parseEnvFile(text) {
  const vars = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    // strip matching surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    vars[m[1]] = val;
  }
  return vars;
}

function loadEnvFile() {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return {};
  return parseEnvFile(readFileSync(envPath, 'utf-8'));
}

const envFile = loadEnvFile();
const MOODLE_URL = process.env.MOODLE_URL || envFile.MOODLE_URL;
const COURSE_ID_RAW = process.env.COURSE_ID || envFile.COURSE_ID;
const COURSE_ID = COURSE_ID_RAW ? parseInt(COURSE_ID_RAW, 10) : null;
const MOODLE_SESSION = process.env.MOODLE_SESSION || envFile.MOODLE_SESSION;
const CONCURRENCY = parseInt(process.env.MOODLE_CONCURRENCY || '8', 10);

if (!MOODLE_URL || !MOODLE_SESSION) {
  console.error('Missing MOODLE_URL/MOODLE_SESSION in env or .env');
  process.exit(1);
}
if (!COURSE_ID || Number.isNaN(COURSE_ID) || COURSE_ID <= 0) {
  console.error(`Invalid or missing COURSE_ID (got: ${COURSE_ID_RAW}). Must be positive integer.`);
  process.exit(1);
}

// --- Error tracking (printed as summary at the end) ---
const errors = [];
function recordError(scope, message) {
  errors.push({ scope, message });
  console.warn(`  ! ${scope}: ${message}`);
}

// --- Turndown setup: keep code blocks with language hints ---
const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '_',
});
turndown.addRule('fencedCodeWithLang', {
  filter: (node) => node.nodeName === 'PRE' && node.firstChild?.nodeName === 'CODE',
  replacement: (_content, node) => {
    const code = node.firstChild;
    const cls = code.getAttribute('class') || '';
    const lang = (cls.match(/language-([\w-]+)/) || [])[1] || '';
    const text = code.textContent.replace(/\n$/, '');
    return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
  },
});

// --- HTTP with retries ---
async function moodleFetch(url, options = {}, { retries = 3 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const resp = await fetch(url, {
        ...options,
        headers: { Cookie: `MoodleSession=${MOODLE_SESSION}`, 'User-Agent': 'MoodleDownloader/1.0', ...options.headers },
        redirect: 'follow',
        signal: ctrl.signal,
      });
      // Retry only on 5xx or 429
      if (!resp.ok) {
        if ((resp.status >= 500 || resp.status === 429) && attempt < retries) {
          lastErr = new Error(`HTTP ${resp.status} bei ${url}`);
        } else {
          throw new Error(`HTTP ${resp.status} bei ${url}`);
        }
      } else {
        return resp;
      }
    } catch (e) {
      lastErr = e;
      if (attempt >= retries) throw e;
    } finally {
      clearTimeout(t);
    }
    // Backoff: 500ms, 1500ms, ...
    await new Promise(r => setTimeout(r, 500 * (3 ** (attempt - 1))));
  }
  throw lastErr;
}

let _sesskeyPromise = null;
async function getSesskey() {
  if (_sesskeyPromise) return _sesskeyPromise;
  _sesskeyPromise = (async () => {
    const html = await (await moodleFetch(`${MOODLE_URL}/course/view.php?id=${COURSE_ID}`)).text();
    const key = html.match(/"sesskey":"([^"]+)"/)?.[1];
    if (!key) throw new Error('Sesskey nicht gefunden — Session abgelaufen?');
    return key;
  })().catch(e => { _sesskeyPromise = null; throw e; });
  return _sesskeyPromise;
}

async function getCourseState() {
  const sesskey = await getSesskey();
  const resp = await moodleFetch(`${MOODLE_URL}/lib/ajax/service.php?sesskey=${sesskey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ index: 0, methodname: 'core_courseformat_get_state', args: { courseid: COURSE_ID } }]),
  });
  const result = await resp.json();
  if (result[0]?.error) throw new Error(result[0].exception?.message || 'API-Fehler');
  return JSON.parse(result[0].data);
}

let _courseDocPromise = null;
async function getCourseDoc() {
  if (_courseDocPromise) return _courseDocPromise;
  _courseDocPromise = (async () => {
    const html = await (await moodleFetch(`${MOODLE_URL}/course/view.php?id=${COURSE_ID}`)).text();
    if (html.includes('login/index.php')) throw new Error('Session abgelaufen.');
    return new JSDOM(html).window.document;
  })().catch(e => { _courseDocPromise = null; throw e; });
  return _courseDocPromise;
}

// Selectors ranked by specificity. First non-empty match wins.
const PAGE_BODY_SELECTORS = [
  '.box.generalbox.center.clearfix .no-overflow',
  '.generalbox .no-overflow',
  '.activity-description',
  '#intro',
];
const INTRO_SELECTORS = [
  '.activity-description',
  '#intro',
  '.box.generalbox.boxaligncenter .no-overflow',
  '.activity_intro',
  '.generalbox .no-overflow',
  '.generalbox',
];

function firstMatch(doc, selectors) {
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (el && el.textContent.trim().length > 0) return el;
  }
  return null;
}

async function fetchPageContentHtml(moduleId) {
  const url = `${MOODLE_URL}/mod/page/view.php?id=${moduleId}`;
  const html = await (await moodleFetch(url)).text();
  if (html.includes('login/index.php')) throw new Error('Session abgelaufen.');
  const doc = new JSDOM(html).window.document;
  const main = firstMatch(doc, PAGE_BODY_SELECTORS);
  return main ? main.innerHTML.trim() : '';
}

async function fetchLabelContentHtml(moduleId) {
  const doc = await getCourseDoc();
  const li = doc.querySelector(`li#module-${moduleId}`);
  if (!li) return '';
  // .activity-altcontent contains JUST the label body. The previous selector
  // .activity-instance was too broad and captured the bulk-select chrome
  // ("Aktivität X auswählen").
  const alt = li.querySelector('.activity-altcontent');
  if (alt) {
    // Often wrapped in a single .no-overflow — unwrap to avoid double wrap.
    const inner = alt.querySelector('.no-overflow > .no-overflow') || alt.querySelector('.no-overflow') || alt;
    return inner.innerHTML.trim();
  }
  const desc = li.querySelector('.activity-description, .contentafterlink');
  return (desc || li).innerHTML.trim();
}

/**
 * Quiz-Settings parsing. Patterns cover DE + EN Moodle locales. Anything not
 * matched falls into cfg._todo so the human knows to fix it before re-upload.
 */
export function parseQuizConfig(html, name, moodleUrl) {
  const doc = new JSDOM(html).window.document;
  const info = doc.querySelector('.box.quizinfo')?.textContent || '';
  const body = doc.body?.textContent || '';

  const cfg = {
    name,
    timeLimit: null,
    attempts: null,
    shuffle: true,
    seb: false,
    sebUrls: [],
    review: 'exam',
  };

  // Attempts: DE "Versuche", EN "Attempts allowed"
  const attemptsMatch = info.match(/(?:Versuche|Attempts allowed):\s*(\d+)/i);
  if (attemptsMatch) cfg.attempts = parseInt(attemptsMatch[1], 10);

  // Time limit: DE "Zeitbegrenzung", EN "Time limit"
  const tlMatch = info.match(/(?:Zeitbegrenzung|Time limit):\s*(\d+)\s*(Minute|Stunde|Sekunde|min|hour|sec)/i);
  if (tlMatch) {
    const n = parseInt(tlMatch[1], 10);
    const unit = tlMatch[2].toLowerCase();
    if (unit.startsWith('stunde') || unit.startsWith('hour')) cfg.timeLimit = n * 3600;
    else if (unit.startsWith('sekunde') || unit.startsWith('sec')) cfg.timeLimit = n;
    else cfg.timeLimit = n * 60;
  }

  if (/Safe Exam Browser/i.test(info) || /quizaccess_seb/.test(html)) {
    cfg.seb = true;
    cfg.sebUrls = [moodleUrl, 'https://login.microsoftonline.com'];
  }

  const openMatch = body.match(/(?:Quiz\s*öffnet|Test\s*öffnet|Geöffnet ab|Opens|Opened):\s*([^\n]{8,40})/i);
  const closeMatch = body.match(/(?:Quiz\s*schließt|Test\s*schließt|Schließt am|Closes|Closed):\s*([^\n]{8,40})/i);
  const todoFields = [];
  if (openMatch) cfg._openDateRaw = openMatch[1].trim();
  else todoFields.push('timeopen');
  if (closeMatch) cfg._closeDateRaw = closeMatch[1].trim();
  else todoFields.push('timeclose');
  if (cfg.attempts === null) todoFields.push('attempts');
  if (cfg.timeLimit === null) todoFields.push('timeLimit');
  todoFields.push('review (preset oder einzelne Felder)');
  cfg._todo = todoFields;

  return cfg;
}

async function fetchModuleViewHtml(moduleType, moduleId) {
  const url = `${MOODLE_URL}/mod/${moduleType}/view.php?id=${moduleId}`;
  let html;
  try { html = await (await moodleFetch(url)).text(); } catch { return null; }
  if (!html || html.includes('login/index.php')) return null;
  return html;
}

async function fetchModuleIntroHtml(moduleType, moduleId) {
  const html = await fetchModuleViewHtml(moduleType, moduleId);
  if (!html) return '';
  const doc = new JSDOM(html).window.document;
  const el = firstMatch(doc, INTRO_SELECTORS);
  return el ? el.innerHTML.trim() : '';
}

/**
 * Fetches the quiz page once and extracts both intro HTML and config from the
 * same parse — saves one HTTP round trip per quiz module compared to calling
 * fetchModuleIntroHtml + fetchQuizConfig separately.
 */
async function fetchQuizModule(moduleId, name) {
  const html = await fetchModuleViewHtml('quiz', moduleId);
  if (!html) return { bodyHtml: '', quizConfig: null };
  const doc = new JSDOM(html).window.document;
  const intro = firstMatch(doc, INTRO_SELECTORS);
  const bodyHtml = intro ? intro.innerHTML.trim() : '';
  const quizConfig = parseQuizConfig(html, name, MOODLE_URL);
  return { bodyHtml, quizConfig };
}

async function fetchResourceFileUrl(moduleId) {
  const url = `${MOODLE_URL}/mod/resource/view.php?id=${moduleId}&redirect=0`;
  try {
    const html = await (await moodleFetch(url)).text();
    if (html.includes('login/index.php')) return '';
    const m = html.match(/href="(https:\/\/[^"]*\/pluginfile\.php\/[^"]*mod_resource[^"]*)"/);
    return m ? m[1].replace(/&amp;/g, '&') : '';
  } catch { return ''; }
}

async function fetchUrlExternal(moduleId) {
  const url = `${MOODLE_URL}/mod/url/view.php?id=${moduleId}&redirect=0`;
  try {
    const html = await (await moodleFetch(url)).text();
    if (html.includes('login/index.php')) return '';
    const doc = new JSDOM(html).window.document;
    const link = doc.querySelector('.urlworkaround a[href], a.urlredirect[href], .activity-description a[href]');
    return link?.getAttribute('href') || '';
  } catch { return ''; }
}

async function fetchSectionSummaryHtml(sectionId) {
  const doc = await getCourseDoc();
  const sec = doc.querySelector(`li#section-${sectionId}, [data-id="${sectionId}"]`);
  if (!sec) return '';
  const summary = sec.querySelector('.summary, .summarytext');
  return summary ? summary.innerHTML.trim() : '';
}

async function downloadFile(fileUrl, targetPath) {
  const resp = await moodleFetch(fileUrl);
  await pipeline(Readable.fromWeb(resp.body), createWriteStream(targetPath));
}

// --- Helpers (pure, exported for tests) ---
export function htmlToMd(html) {
  if (!html) return '';
  return turndown.turndown(html).trim();
}

export function slugify(s) {
  return (s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'untitled';
}

export function pad(n, w) { return String(n).padStart(w, '0'); }

/**
 * Make a filename safe across platforms while preserving ASCII letters/digits.
 * Non-ASCII is transliterated via slugify (keeps Müller distinguishable from
 * Mueller in the sense that both map deterministically; for true uniqueness
 * the caller must add an id suffix when collisions matter).
 */
export function safeName(s, fallbackId = '') {
  if (!s) return fallbackId ? `file-${fallbackId}` : 'file';
  // Split extension so slugify doesn't eat the dot.
  const dot = s.lastIndexOf('.');
  const stem = dot > 0 ? s.slice(0, dot) : s;
  const ext = dot > 0 ? s.slice(dot + 1) : '';
  let safeStem = slugify(stem);
  // slugify returns 'untitled' for empty/symbol-only input — replace with id-based fallback when we have one.
  if (safeStem === 'untitled' && fallbackId) safeStem = `file-${fallbackId}`;
  const safeExt = ext.replace(/[^A-Za-z0-9]/g, '');
  return safeExt ? `${safeStem}.${safeExt}` : safeStem;
}

export function safeDecodeURIComponent(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

function writeJson(path, obj) {
  try {
    writeFileSync(path, JSON.stringify(obj, null, 2) + '\n');
  } catch (e) {
    throw new Error(`writeJson(${path}) failed: ${e.message}`);
  }
}

// Tiny concurrency limiter — avoids pulling in p-limit as a dep.
export async function pMapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// --- Module handlers ---
const moduleHandlers = {
  page: async (cm) => ({ bodyHtml: await fetchPageContentHtml(cm.id) }),
  label: async (cm) => ({ bodyHtml: await fetchLabelContentHtml(cm.id) }),
  assign: async (cm) => ({ bodyHtml: await fetchModuleIntroHtml('assign', cm.id) }),
  forum: async (cm) => ({ bodyHtml: await fetchModuleIntroHtml('forum', cm.id) }),
  attendance: async (cm) => ({ bodyHtml: await fetchModuleIntroHtml('attendance', cm.id) }),
  quiz: async (cm) => fetchQuizModule(cm.id, cm.name),
  url: async (cm) => ({ externalUrl: await fetchUrlExternal(cm.id) }),
  resource: async (cm) => ({ fileUrl: await fetchResourceFileUrl(cm.id) }),
};

// --- Per-module processing ---
async function processModule(cm, section, idx, secDir) {
  const actSlug = slugify(cm.name);
  const actDir = join(secDir, `${pad(idx, 2)}-${cm.module}-${actSlug}`);
  mkdirSync(actDir, { recursive: true });

  const meta = {
    id: cm.id,
    name: cm.name,
    type: cm.module,
    sectionNumber: section.number,
    order: idx,
    visible: cm.visible ?? true,
    indent: cm.indent || 0,
    moodleUrl: cm.url || `${MOODLE_URL}/mod/${cm.module}/view.php?id=${cm.id}`,
  };

  const handler = moduleHandlers[cm.module];
  let result = {};
  if (handler) {
    try {
      result = await handler(cm);
    } catch (e) {
      meta.fetchError = e.message;
      recordError(`module ${cm.module}#${cm.id} (${cm.name})`, e.message);
    }
  }

  if (result.bodyHtml) {
    try {
      // Raw HTML for verlustfreien Round-Trip; Markdown für Edits.
      writeFileSync(join(actDir, 'content.html'), result.bodyHtml);
      const md = htmlToMd(result.bodyHtml);
      if (md) writeFileSync(join(actDir, 'content.md'), md + '\n');
    } catch (e) {
      meta.writeError = e.message;
      recordError(`write ${actDir}`, e.message);
    }
  }

  if (cm.module === 'quiz' && result.quizConfig) {
    writeJson(join(actDir, 'quiz-config.json'), result.quizConfig);
    const gift = [
      '// GIFT-Fragen für Quiz: ' + cm.name,
      '// Quelle: ' + meta.moodleUrl,
      '//',
      '// HINWEIS: Fragen konnten nicht heruntergeladen werden — als',
      '// Student/in besteht kein Zugriff auf die Fragensammlung.',
      '// Lass diese Datei von einer Lehrperson über Question Bank',
      '// → Export → GIFT-Format füllen, dann mit',
      '//   moodle-updater.js import-gift <cmid> questions.gift',
      '// + add-questions-to-quiz <cmid> hochladen.',
      '',
    ].join('\n');
    writeFileSync(join(actDir, 'questions.gift'), gift);
    meta.quizConfig = 'quiz-config.json';
    meta.questionsFile = 'questions.gift';
  } else if (cm.module === 'url' && result.externalUrl) {
    meta.externalUrl = result.externalUrl;
  } else if (cm.module === 'resource' && result.fileUrl) {
    const filesDir = join(actDir, 'files');
    mkdirSync(filesDir, { recursive: true });
    const rawName = safeDecodeURIComponent(result.fileUrl.split('/').pop().split('?')[0]) || `resource-${cm.id}`;
    const fname = safeName(rawName, cm.id);
    try {
      await downloadFile(result.fileUrl, join(filesDir, fname));
      meta.file = `files/${fname}`;
      meta.originalFileName = rawName;
    } catch (e) {
      meta.downloadError = e.message;
      recordError(`download ${cm.module}#${cm.id} (${rawName})`, e.message);
    }
  }

  writeJson(join(actDir, 'activity.json'), meta);
  return meta;
}

/**
 * Sync prep: create directory, write section.json + summary, push README line.
 * The course doc is already cached so summary lookup is in-memory.
 * Returns the list of module tasks for the global pool.
 */
async function prepareSection(section, state, outDir, courseLines) {
  const secSlug = slugify(section.title);
  const secDir = join(outDir, `${pad(section.number, 2)}-${secSlug}`);
  mkdirSync(secDir, { recursive: true });

  const summaryHtml = await fetchSectionSummaryHtml(section.id).catch((e) => {
    recordError(`section ${section.id} summary`, e.message);
    return '';
  });
  const summaryMd = htmlToMd(summaryHtml);
  if (summaryMd) writeFileSync(join(secDir, 'summary.md'), summaryMd + '\n');

  writeJson(join(secDir, 'section.json'), {
    id: section.id,
    number: section.number,
    title: section.title,
    hasSummary: !!summaryMd,
    activityCount: section.cmlist.length,
  });

  courseLines.push(`- [${pad(section.number, 2)} — ${section.title}](${pad(section.number, 2)}-${secSlug}/) (${section.cmlist.length})`);

  return section.cmlist
    .map((cmId, i) => ({ cm: state.cm.find(m => m.id === cmId), idx: i + 1, section, secDir }))
    .filter(x => x.cm);
}

// --- Main ---
async function main() {
  const outDir = resolve(process.argv[2] || './kurs');
  console.log(`Downloading course ${COURSE_ID} from ${MOODLE_URL} -> ${outDir} (concurrency=${CONCURRENCY})`);
  mkdirSync(outDir, { recursive: true });

  const state = await getCourseState();
  writeJson(join(outDir, 'state.json'), state);
  writeJson(join(outDir, 'course.json'), {
    courseId: COURSE_ID,
    moodleUrl: MOODLE_URL,
    downloadedAt: new Date().toISOString(),
    sectionCount: state.section.length,
    moduleCount: state.cm.length,
  });
  console.log(`  Sections: ${state.section.length}, Modules: ${state.cm.length}`);

  const courseLines = [
    `# Moodle-Kurs ${COURSE_ID}`,
    '',
    `Quelle: ${MOODLE_URL}/course/view.php?id=${COURSE_ID}`,
    `Heruntergeladen: ${new Date().toISOString()}`,
    `Sections: ${state.section.length}, Modules: ${state.cm.length}`,
    '',
    '## Sections',
    '',
  ];

  // Section prep is cheap (cached course doc) — do it sequentially so courseLines
  // stays in section order, then run ALL modules through one global pool.
  const allTasks = [];
  for (const section of state.section) {
    const tasks = await prepareSection(section, state, outDir, courseLines);
    allTasks.push(...tasks);
  }

  let done = 0;
  await pMapLimit(allTasks, CONCURRENCY, async ({ cm, section, idx, secDir }) => {
    await processModule(cm, section, idx, secDir);
    done++;
    if (done % 25 === 0) console.log(`  ${done}/${allTasks.length} Module verarbeitet...`);
  });
  const modCount = allTasks.length;

  writeFileSync(join(outDir, 'README.md'), courseLines.join('\n') + '\n');
  console.log(`\nFertig. ${state.section.length} Sections, ${modCount} Module nach ${outDir}`);

  if (errors.length) {
    console.log(`\n⚠ ${errors.length} Fehler während des Downloads:`);
    for (const { scope, message } of errors) console.log(`  - ${scope}: ${message}`);
    console.log('\nBetroffene Module haben fetchError/downloadError/writeError in ihrer activity.json.');
  }
}

// Only run main when invoked directly, not when imported by tests.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => { console.error('Error:', err.message); process.exit(1); });
}
