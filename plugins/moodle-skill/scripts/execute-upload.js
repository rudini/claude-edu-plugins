#!/usr/bin/env node

/**
 * execute-upload.js
 *
 * Append-only uploader. Walks a downloaded course tree (download-course.js
 * output) and appends each source section as a NEW section at the end of the
 * target course. Existing sections are NEVER touched.
 *
 * Per source section:
 *   1. duplicate-section --live   → new empty section at end
 *   2. rename-section <id> <title> --live
 *   3. update-summary <id> summary.md --live   (if present)
 *   4. for each activity: create-<type> <newSectionNum> ... --live
 *
 * Without --live: prints the steps it WOULD execute (dry run).
 *
 * Usage:
 *   node execute-upload.js <kursDir> [--section <NN>] [--live]
 *
 *   --section 01   Only upload one source section (folder prefix "<NN>-")
 *   --live         Actually execute. Without it: dry run.
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPDATER = resolve(__dirname, 'moodle-updater.js');
const NODE_PATH_VAL = resolve(__dirname, '..', 'node_modules');

const args = process.argv.slice(2);
const kursDir = resolve(args.find(a => !a.startsWith('--')) || './kurs');
const live = args.includes('--live');
const onlySection = (() => {
  const i = args.indexOf('--section');
  return i >= 0 ? args[i + 1] : null;
})();

if (!existsSync(join(kursDir, 'course.json'))) {
  console.error(`Kein course.json in ${kursDir}`);
  process.exit(1);
}

function listDirs(dir) {
  return readdirSync(dir).filter(n => statSync(join(dir, n)).isDirectory()).sort();
}
function readJson(p) { return JSON.parse(readFileSync(p, 'utf-8')); }

function run(cmdArgs, { capture = false } = {}) {
  const full = `node ${JSON.stringify(UPDATER)} ${cmdArgs}${live ? ' --live' : ''}`;
  console.log(`  $ ${cmdArgs}${live ? ' --live' : '  (DRY)'}`);
  if (!live && !capture) return '';
  try {
    return execSync(full, {
      env: { ...process.env, NODE_PATH: NODE_PATH_VAL },
      stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
      encoding: 'utf-8',
    });
  } catch (err) {
    console.error(`    ✗ Fehler: ${err.message?.split('\n')[0]}`);
    throw err;
  }
}

function structure() {
  return run('structure', { capture: true });
}

function findNewSection(beforeIds, structureOutput) {
  // Sections look like: "Section 20 (ID: 99999): ..."
  const re = /Section\s+(\d+)\s+\(ID:\s+(\d+)\):/g;
  const found = [];
  let m;
  while ((m = re.exec(structureOutput))) {
    found.push({ number: parseInt(m[1]), id: parseInt(m[2]) });
  }
  const newOnes = found.filter(s => !beforeIds.has(s.id));
  return newOnes.sort((a, b) => b.number - a.number)[0];
}

function ensureStub(aDir, name) {
  const stub = join(aDir, '_stub.md');
  if (!existsSync(stub)) writeFileSync(stub, `${name}\n`);
  return stub;
}

function quote(s) {
  if (/^[A-Za-z0-9_./:-]+$/.test(s)) return s;
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

async function uploadSection(srcSecDir) {
  const sec = readJson(join(srcSecDir, 'section.json'));
  console.log(`\n========== Source Section ${String(sec.number).padStart(2)}: ${sec.title} (${sec.activityCount} Aktivitäten) ==========`);

  // 1. Snapshot existing section IDs
  console.log('  → Status vorher abfragen');
  const beforeOut = structure();
  const beforeIds = new Set(
    [...beforeOut.matchAll(/ID:\s+(\d+)/g)].map(m => parseInt(m[1]))
  );

  // 2. Add a new empty section
  console.log('  → Neue leere Section anlegen (add-section)');
  run('add-section');

  // 3. Find new section
  let newSec;
  if (live) {
    const afterOut = structure();
    newSec = findNewSection(beforeIds, afterOut);
    if (!newSec) throw new Error('Neue Section nach duplicate-section nicht gefunden');
    console.log(`  → Neue Section: number=${newSec.number}, id=${newSec.id}`);
  } else {
    newSec = { number: '<NN>', id: '<ID>' };
  }

  // 4. Rename
  console.log('  → Section umbenennen');
  run(`rename-section ${newSec.id} ${quote(sec.title)}`);

  // 5. Section summary
  if (existsSync(join(srcSecDir, 'summary.md'))) {
    console.log('  → Section-Summary setzen');
    const rel = join(srcSecDir, 'summary.md');
    run(`update-summary ${newSec.id} ${quote(rel)}`);
  }

  // 6. Activities
  const actDirs = listDirs(srcSecDir).filter(d => /^\d{2}-/.test(d));
  // Snapshot section's cm list before creating activities so we can later
  // resolve which new cmids correspond to our created activities (Moodle
  // assigns IDs in creation order).
  const sectionStateBefore = live ? structure() : '';
  const cmListBefore = (() => {
    if (!live) return [];
    const re = new RegExp(`Section\\s+${newSec.number}\\s+\\(ID:\\s+${newSec.id}\\):[^\\n]*\\n\\s*Modules:\\s*([0-9, ]+)`);
    const m = sectionStateBefore.match(re);
    return m ? m[1].split(',').map(s => parseInt(s.trim())).filter(Boolean) : [];
  })();

  const createdActivities = []; // { srcAct, sourceOrder } in creation order
  let okCount = 0, skipCount = 0, failCount = 0;
  for (const ad of actDirs) {
    const aDir = join(srcSecDir, ad);
    const act = readJson(join(aDir, 'activity.json'));
    const tag = `[${act.type} #${act.id}] ${act.name}`;
    // Prefer raw HTML for verlustfreien Round-Trip; fall back to MD for edits.
    const contentMd = existsSync(join(aDir, 'content.html'))
      ? join(aDir, 'content.html')
      : (existsSync(join(aDir, 'content.md')) ? join(aDir, 'content.md') : null);
    const filePath = act.file ? join(aDir, act.file) : null;
    const sec2 = String(newSec.number);

    let cmd = null;
    if (act.type === 'page' && contentMd) cmd = `create-page ${sec2} ${quote(act.name)} ${quote(contentMd)}`;
    else if (act.type === 'label' && contentMd) cmd = `create-label ${sec2} ${quote(contentMd)}`;
    else if (act.type === 'assign') {
      const c = contentMd || ensureStub(aDir, act.name);
      cmd = `create-assign ${sec2} ${quote(act.name)} ${quote(c)}`;
    }
    else if (act.type === 'forum') {
      const c = contentMd || ensureStub(aDir, act.name);
      cmd = `create-forum ${sec2} ${quote(act.name)} ${quote(c)}`;
    }
    else if (act.type === 'url' && act.externalUrl) cmd = `create-url ${sec2} ${quote(act.name)} ${quote(act.externalUrl)}`;
    else if (act.type === 'resource' && filePath) cmd = `create-resource ${sec2} ${quote(act.name)} ${quote(filePath)}`;
    else if (act.type === 'quiz' && existsSync(join(aDir, 'quiz-config.json'))) {
      cmd = `create-quiz ${sec2} ${quote(join(aDir, 'quiz-config.json'))}`;
    }

    if (!cmd) {
      console.log(`  · SKIP ${tag} (kein passender Befehl / Inhalt fehlt)`);
      skipCount++;
      continue;
    }

    try {
      console.log(`  · ${tag}`);
      run(cmd);
      okCount++;
      createdActivities.push(act);
    } catch {
      failCount++;
    }
  }

  // 7. Apply indent + visibility to the just-created modules.
  if (live && createdActivities.length > 0) {
    console.log('  → Einrückungen / Sichtbarkeit anwenden');
    const stateAfter = structure();
    const re = new RegExp(`Section\\s+${newSec.number}\\s+\\(ID:\\s+${newSec.id}\\):[^\\n]*\\n\\s*Modules:\\s*([0-9, ]+)`);
    const m = stateAfter.match(re);
    const cmListAfter = m ? m[1].split(',').map(s => parseInt(s.trim())).filter(Boolean) : [];
    const beforeSet = new Set(cmListBefore);
    const newCmids = cmListAfter.filter(id => !beforeSet.has(id));

    if (newCmids.length !== createdActivities.length) {
      console.log(`  ⚠ erwartete ${createdActivities.length} neue Modules, gefunden ${newCmids.length} — Indent/Hide übersprungen`);
    } else {
      for (let i = 0; i < createdActivities.length; i++) {
        const src = createdActivities[i];
        const cmid = newCmids[i];
        const indent = parseInt(src.indent || 0, 10);
        for (let n = 0; n < indent; n++) {
          run(`indent-activity ${cmid}`);
        }
        if (src.visible === false) {
          run(`hide-activity ${cmid}`);
        }
      }
    }
  }

  console.log(`  → Section fertig: ok=${okCount}, skip=${skipCount}, fail=${failCount}`);
  return { okCount, skipCount, failCount };
}

async function main() {
  console.log(`Mode: ${live ? 'LIVE' : 'DRY RUN'}`);
  console.log(`Source: ${kursDir}`);
  console.log(`Target: ${process.env.MOODLE_URL || ''} course ${process.env.COURSE_ID || ''} (aus .env)`);

  const sections = listDirs(kursDir).filter(d => /^\d{2}-/.test(d));
  const filtered = onlySection
    ? sections.filter(d => d.startsWith(onlySection.padStart(2, '0') + '-'))
    : sections;

  if (filtered.length === 0) {
    console.error('Keine passenden Sections gefunden.');
    process.exit(1);
  }

  const totals = { ok: 0, skip: 0, fail: 0 };
  for (const sd of filtered) {
    const r = await uploadSection(join(kursDir, sd));
    totals.ok += r.okCount; totals.skip += r.skipCount; totals.fail += r.failCount;
  }

  console.log('\n=========================================');
  console.log(`Sections verarbeitet: ${filtered.length}`);
  console.log(`Aktivitäten: ok=${totals.ok}, skip=${totals.skip}, fail=${totals.fail}`);
  if (!live) console.log('DRY RUN — keine Änderungen. Mit --live tatsächlich ausführen.');
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
