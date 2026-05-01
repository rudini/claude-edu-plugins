#!/usr/bin/env node

/**
 * upload-course.js — DRY RUN
 *
 * Walks a downloaded course tree (produced by download-course.js) and prints
 * the moodle-updater.js commands that would re-create the course. No HTTP
 * calls, no writes — purely a plan.
 *
 * Reads MOODLE_URL / COURSE_ID from .env (target course). Add --live to the
 * generated commands manually after reviewing.
 *
 * Usage:  node upload-course.js <kursDir>
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve, join, relative } from 'path';

function loadEnvFile() {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return {};
  const env = readFileSync(envPath, 'utf-8');
  const vars = {};
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m) vars[m[1]] = m[2].trim();
  }
  return vars;
}
const envFile = loadEnvFile();
const TARGET_URL = process.env.MOODLE_URL || envFile.MOODLE_URL || '<MOODLE_URL>';
const TARGET_COURSE = process.env.COURSE_ID || envFile.COURSE_ID || '<COURSE_ID>';

function shellQuote(s) {
  if (s === undefined || s === null) return "''";
  const str = String(s);
  if (/^[A-Za-z0-9_./:-]+$/.test(str)) return str;
  return `'${str.replace(/'/g, `'\\''`)}'`;
}

function listDirs(dir) {
  return readdirSync(dir)
    .filter(name => statSync(join(dir, name)).isDirectory())
    .sort();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

const UPLOAD_PREFIX = 'NODE_PATH="${CLAUDE_PLUGIN_DATA}/node_modules" node "${CLAUDE_PLUGIN_ROOT}/scripts/moodle-updater.js"';

function planActivity(act, contentPath, filePath, sectionNum) {
  const t = act.type;
  const name = shellQuote(act.name);
  const sec = String(sectionNum);

  if (t === 'page') {
    if (!contentPath) return { skip: 'no content.md' };
    return { cmd: `create-page ${sec} ${name} ${shellQuote(contentPath)}` };
  }
  if (t === 'label') {
    if (!contentPath) return { skip: 'no content.md' };
    return { cmd: `create-label ${sec} ${shellQuote(contentPath)}` };
  }
  if (t === 'assign') {
    if (!contentPath) return { skip: 'no content.md' };
    return { cmd: `create-assign ${sec} ${name} ${shellQuote(contentPath)}` };
  }
  if (t === 'forum') {
    if (!contentPath) return { skip: 'no content.md' };
    return { cmd: `create-forum ${sec} ${name} ${shellQuote(contentPath)}` };
  }
  if (t === 'url') {
    if (!act.externalUrl) return { skip: 'no externalUrl' };
    return { cmd: `create-url ${sec} ${name} ${shellQuote(act.externalUrl)}` };
  }
  if (t === 'resource') {
    if (!filePath) return { skip: 'no file' };
    return { cmd: `create-resource ${sec} ${name} ${shellQuote(filePath)}` };
  }
  if (t === 'quiz') {
    if (!act.quizConfig) return { skip: 'no quiz-config.json' };
    const cfgPath = shellQuote(join(relative(process.cwd(), act._dir), act.quizConfig));
    const giftPath = act.questionsFile
      ? shellQuote(join(relative(process.cwd(), act._dir), act.questionsFile)) : null;
    const lines = [`create-quiz ${sec} ${cfgPath}`];
    if (giftPath) {
      lines.push(`# Nach create-quiz: cmid des neuen Quiz ermitteln (z.B. structure), dann:`);
      lines.push(`# import-gift <cmid> ${giftPath}`);
      lines.push(`# add-questions-to-quiz <cmid>`);
    }
    return { cmd: lines.join('\n'),
             warn: 'quiz: configJson nur teilweise befüllt (timeopen/timeclose/review fehlen). Fragen sind Platzhalter — von Lehrperson via Question Bank exportieren.' };
  }
  return { skip: `unsupported type: ${t}` };
}

function main() {
  const kursDir = resolve(process.argv[2] || './kurs');
  if (!existsSync(join(kursDir, 'course.json'))) {
    console.error(`Kein course.json in ${kursDir} — ist das ein download-course.js Output?`);
    process.exit(1);
  }
  const course = readJson(join(kursDir, 'course.json'));

  console.log('# Moodle Upload Plan (DRY RUN)');
  console.log('# ----------------------------');
  console.log(`# Quelle: ${course.moodleUrl} (Kurs ${course.courseId})`);
  console.log(`# Heruntergeladen: ${course.downloadedAt}`);
  console.log(`# Ziel:    ${TARGET_URL} (Kurs ${TARGET_COURSE})`);
  console.log('#');
  console.log('# Diese Befehle werden NICHT ausgeführt. Zum tatsächlichen Upload:');
  console.log('#   1. .env auf den Ziel-Kurs umstellen (MOODLE_URL + COURSE_ID)');
  console.log('#   2. Jeden Befehl ohne --live prüfen (Dry-Run der Skill-CLI)');
  console.log('#   3. Mit --live wiederholen, nach Bestätigung pro Section');
  console.log('#');

  const sections = listDirs(kursDir).filter(d => /^\d{2}-/.test(d));
  const stats = { sections: 0, total: 0, planned: 0, skipped: 0, warnings: 0 };
  const byType = {};

  for (const sd of sections) {
    const sDir = join(kursDir, sd);
    const sec = readJson(join(sDir, 'section.json'));
    stats.sections++;

    console.log(`\n# ===== Section ${String(sec.number).padStart(2)}: ${sec.title} (${sec.activityCount} Aktivitäten) =====`);
    if (existsSync(join(sDir, 'summary.md'))) {
      const rel = relative(process.cwd(), join(sDir, 'summary.md'));
      console.log(`# Section-Summary: ${UPLOAD_PREFIX} update-summary ${sec.id} ${shellQuote(rel)}`);
    }

    const activityDirs = listDirs(sDir).filter(d => /^\d{2}-/.test(d));
    for (const ad of activityDirs) {
      const aDir = join(sDir, ad);
      const actPath = join(aDir, 'activity.json');
      if (!existsSync(actPath)) continue;
      const act = readJson(actPath);
      act._dir = aDir;
      stats.total++;
      byType[act.type] = (byType[act.type] || 0) + 1;

      const contentMd = existsSync(join(aDir, 'content.md'))
        ? relative(process.cwd(), join(aDir, 'content.md')) : null;
      const filePath = act.file
        ? relative(process.cwd(), join(aDir, act.file)) : null;

      const plan = planActivity(act, contentMd, filePath, sec.number);
      const tag = `[${act.type} #${act.id} ord ${act.order}]`;
      if (plan.skip) {
        stats.skipped++;
        console.log(`# SKIP ${tag} ${act.name} — ${plan.skip}`);
      } else {
        stats.planned++;
        if (plan.warn) { stats.warnings++; console.log(`# WARN ${tag} ${plan.warn}`); }
        console.log(`${UPLOAD_PREFIX} ${plan.cmd}    # ${tag} ${act.name}`);
      }
    }
  }

  console.log('\n# ===== Zusammenfassung =====');
  console.log(`# Sections:  ${stats.sections}`);
  console.log(`# Aktivitäten gesamt: ${stats.total}`);
  console.log(`# → planbar: ${stats.planned}`);
  console.log(`# → skipped: ${stats.skipped}`);
  console.log(`# → mit Warnung: ${stats.warnings}`);
  console.log(`# Nach Typ: ${Object.entries(byType).map(([k,v]) => `${k}=${v}`).join(', ')}`);
  console.log('# DRY RUN — keine HTTP-Calls, keine Änderungen am Moodle.');
}

main();
