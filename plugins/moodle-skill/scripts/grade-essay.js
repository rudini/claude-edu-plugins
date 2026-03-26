/**
 * grade-essay.js
 *
 * Scrape student essay responses from Moodle quizzes and submit grades back.
 *
 * Sub-commands:
 *   scrape - Parse GIFT file + fetch student responses → JSON output
 *   submit - Read graded JSON + submit scores to Moodle
 */

import { JSDOM } from 'jsdom';
import { writeFileSync, readFileSync } from 'fs';
import { parseGiftEssayQuestions, formatQuestionSummary } from './gift-parser.js';

/**
 * Run the grade-essay command.
 *
 * @param {object} params
 * @param {string} params.subCommand - 'scrape' or 'submit'
 * @param {number} params.cmid - Quiz course module ID
 * @param {string} [params.giftPath] - Path to GIFT file (required for scrape)
 * @param {number} [params.slot] - Grade only this slot number
 * @param {boolean} [params.regrade] - Also process already-graded responses
 * @param {string} [params.output] - Output JSON file path (scrape)
 * @param {string} [params.gradesPath] - Input grades JSON file path (submit)
 * @param {boolean} [params.live] - Write grades to Moodle (submit)
 * @param {object} moodle - Moodle helper functions from moodle-updater.js
 */
export async function cmdGradeEssay(params, moodle) {
  const subCommand = params.subCommand;
  if (subCommand === 'scrape') {
    return await scrapeGrading(params, moodle);
  } else if (subCommand === 'submit') {
    return await submitGrading(params, moodle);
  } else {
    throw new Error('Usage: grade-essay scrape|submit ...');
  }
}

// --- Sub-commands ---

/**
 * Scrape: Parse GIFT file, fetch student responses from Moodle, write JSON.
 *
 * grade-essay scrape <cmid> --gift <path> [--slot <N>] [--regrade] --output <file>
 */
async function scrapeGrading(params, moodle) {
  const { cmid, giftPath, slot: slotFilter, regrade, output } = params;

  if (!giftPath) {
    throw new Error('--gift <path> is required. Provide the path to the GIFT file.');
  }
  if (!output) {
    throw new Error('--output <file> is required. Provide the output JSON file path.');
  }

  console.log(`\n=== Essay Scrape (Quiz cmid=${cmid})${regrade ? ' [REGRADE]' : ''} ===\n`);

  // Step 1: Parse GIFT file
  console.log(`GIFT-Datei: ${giftPath}`);
  const { quizName, questions } = parseGiftEssayQuestions(giftPath);
  console.log(`Quiz: ${quizName}`);
  console.log(`FT-Fragen gefunden: ${questions.length}\n`);

  for (const q of questions) {
    console.log(formatQuestionSummary(q));
  }
  console.log('');

  if (questions.length === 0) {
    console.log('Keine Freitext-Fragen in der GIFT-Datei gefunden.');
    return;
  }

  // Step 2: Fetch grading overview from Moodle
  console.log('Lade Grading-Uebersicht von Moodle...');
  const essaySlots = await fetchGradingOverview(cmid, moodle);

  if (essaySlots.length === 0) {
    console.log('Keine Essay-Fragen im Quiz gefunden (oder alle bereits bewertet).');
    return;
  }

  console.log(`Essay-Slots im Quiz: ${essaySlots.length}`);
  for (const s of essaySlots) {
    const toGrade = regrade ? s.needsGrading + s.alreadyGraded : s.needsGrading;
    console.log(`  Slot ${s.slot}: ${s.questionName} (${toGrade} zu bewerten${regrade ? `, davon ${s.alreadyGraded} bereits bewertet` : ''})`);
  }
  console.log('');

  // Step 3: Process each slot
  const slotsToProcess = slotFilter
    ? essaySlots.filter(s => s.slot === slotFilter)
    : essaySlots;

  if (slotsToProcess.length === 0) {
    console.log(`Slot ${slotFilter} nicht gefunden.`);
    return;
  }

  const outputSlots = [];

  for (const slotInfo of slotsToProcess) {
    console.log(`\n--- Slot ${slotInfo.slot}: ${slotInfo.questionName} ---`);

    const totalToGrade = regrade ? slotInfo.needsGrading + slotInfo.alreadyGraded : slotInfo.needsGrading;
    if (totalToGrade === 0) {
      console.log('  Alle bereits bewertet, ueberspringe. (--regrade um neu zu bewerten)');
      continue;
    }

    // Match GIFT question to Moodle slot
    const question = matchQuestionToSlot(questions, slotInfo);
    if (!question) {
      console.log(`  WARNUNG: Keine passende FT-Frage in GIFT-Datei gefunden fuer "${slotInfo.questionName}". Ueberspringe.`);
      continue;
    }
    console.log(`  Matched: ${question.id} (${question.maxScore} Pt.)`);

    // Fetch student responses
    const gradeFilter = regrade ? 'all' : 'needsgrading';
    console.log(`  Lade Antworten (${gradeFilter})...`);
    const { responses, pageData } = await fetchStudentResponses(cmid, slotInfo, moodle, { gradeFilter });
    console.log(`  ${responses.length} Antworten geladen.`);

    if (responses.length === 0) continue;

    outputSlots.push({
      slot: slotInfo.slot,
      questionName: slotInfo.questionName,
      question: {
        id: question.id,
        title: question.title,
        questionText: question.questionText,
        maxScore: question.maxScore,
        modelAnswer: question.modelAnswer,
        criteria: question.criteria,
        alternatives: question.alternatives || [],
        commonErrors: question.commonErrors || [],
        notAccepted: question.notAccepted || [],
      },
      responses: responses.map(r => ({
        studentName: r.studentName,
        response: r.response,
        formFields: r.formFields,
      })),
      pageData,
    });
  }

  // Write output JSON
  const outputData = {
    cmid,
    quizName,
    slots: outputSlots,
  };

  writeFileSync(output, JSON.stringify(outputData, null, 2));
  console.log(`\nScrape-Daten exportiert: ${output}`);
  console.log(`${outputSlots.length} Slot(s), ${outputSlots.reduce((sum, s) => sum + s.responses.length, 0)} Antworten total.`);

  return outputData;
}

/**
 * Submit: Read graded JSON file and submit scores to Moodle.
 *
 * grade-essay submit <cmid> --grades <file> [--live]
 */
async function submitGrading(params, moodle) {
  const { cmid, gradesPath, live } = params;

  if (!gradesPath) {
    throw new Error('--grades <file> is required. Provide the graded JSON file path.');
  }

  console.log(`\n=== Essay Submit (Quiz cmid=${cmid})${live ? ' [LIVE]' : ' [DRY RUN]'} ===\n`);

  // Read grades JSON
  const gradesData = JSON.parse(readFileSync(gradesPath, 'utf-8'));

  if (String(gradesData.cmid) !== String(cmid)) {
    console.log(`WARNUNG: cmid in Grades-Datei (${gradesData.cmid}) stimmt nicht mit Parameter (${cmid}) ueberein.`);
  }

  let totalSubmitted = 0;
  let totalSkipped = 0;

  for (const slotData of gradesData.slots) {
    console.log(`--- Slot ${slotData.slot} ---`);

    if (!slotData.grades || slotData.grades.length === 0) {
      console.log('  Keine Bewertungen vorhanden, ueberspringe.');
      continue;
    }

    console.log(`  ${slotData.grades.length} Bewertungen zu uebermitteln.`);

    if (live) {
      const success = await submitGradesPage(slotData.pageData, slotData.grades, moodle);
      if (success) {
        console.log(`  → ${slotData.grades.length} Bewertungen erfolgreich geschrieben`);
        totalSubmitted += slotData.grades.length;
      } else {
        console.log(`  → WARNUNG: Submission moeglicherweise fehlgeschlagen`);
        totalSkipped += slotData.grades.length;
      }
    } else {
      for (const grade of slotData.grades) {
        console.log(`  [DRY] Score: ${grade.score}, Comment: ${(grade.commentHtml || '').slice(0, 80)}...`);
      }
      totalSkipped += slotData.grades.length;
    }
  }

  console.log('\n=== Zusammenfassung ===');
  if (live) {
    console.log(`Geschrieben: ${totalSubmitted} | Fehlgeschlagen: ${totalSkipped}`);
  } else {
    console.log(`DRY RUN — ${totalSkipped} Bewertungen wurden NICHT in Moodle geschrieben.`);
    console.log('Mit --live ausfuehren, um Bewertungen in Moodle zu schreiben.');
    console.log('HINWEIS: Der Dozent muss die Bewertungen anschliessend manuell pruefen und abschliessen.');
  }
}

// --- Moodle Scraping ---

/**
 * Fetch the grading overview page to get essay slots and counts.
 *
 * GET /mod/quiz/report.php?id=<cmid>&mode=grading
 */
async function fetchGradingOverview(cmid, moodle) {
  const url = `${moodle.MOODLE_URL}/mod/quiz/report.php?id=${cmid}&mode=grading`;
  const resp = await moodle.moodleFetch(url);
  const html = await resp.text();

  if (html.includes('login/index.php')) {
    throw new Error('Session abgelaufen. Bitte neuen MoodleSession-Cookie setzen.');
  }

  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const slots = [];

  // Moodle 4.5 grading overview table:
  // Cell[0]=SlotNr, Cell[1]=Type, Cell[2]=QuestionName, Cell[3]=NeedsGrading,
  // Cell[4]="N Bewertungen aktualisieren" (manuallygraded), Cell[5]="N Alles bewerten" (all)
  const rows = doc.querySelectorAll('table tbody tr');

  if (rows.length > 0) {
    for (const row of rows) {
      const cells = row.querySelectorAll('td, th');
      if (cells.length < 4) continue;

      const gradeLink = row.querySelector('a[href*="slot="]');
      if (!gradeLink) continue;

      const href = gradeLink.getAttribute('href');
      const slotMatch = href.match(/slot=(\d+)/);
      const qidMatch = href.match(/qid=(\d+)/);
      if (!slotMatch) continue;

      const slot = parseInt(slotMatch[1]);
      const qid = qidMatch ? parseInt(qidMatch[1]) : null;

      // Cell[2] = question name, Cell[3] = needs grading count
      const questionName = cells[2]?.textContent?.trim() || `Slot ${slot}`;
      const needsGrading = parseInt(cells[3]?.textContent?.trim()) || 0;

      // Cell[4] contains "N Bewertungen aktualisieren" (already graded count)
      let alreadyGraded = 0;
      const cell4Text = cells[4]?.textContent?.trim() || '';
      const gradedMatch = cell4Text.match(/^(\d+)/);
      if (gradedMatch) alreadyGraded = parseInt(gradedMatch[1]);

      slots.push({ slot, qid, questionName, needsGrading, alreadyGraded, gradeUrl: href });
    }
  }

  // Fallback: parse links directly from the page
  if (slots.length === 0) {
    const links = doc.querySelectorAll('a[href*="mode=grading"][href*="slot="]');
    for (const link of links) {
      const href = link.getAttribute('href');
      const slotMatch = href.match(/slot=(\d+)/);
      const qidMatch = href.match(/qid=(\d+)/);
      if (!slotMatch) continue;

      const slot = parseInt(slotMatch[1]);
      const qid = qidMatch ? parseInt(qidMatch[1]) : null;
      const text = link.textContent?.trim() || '';
      const countMatch = text.match(/(\d+)/);

      // Get the parent row or container for question name
      const container = link.closest('tr') || link.closest('div') || link.parentElement;
      const questionName = container?.querySelector('td:first-child, .questionname')?.textContent?.trim()
        || text.replace(/\d+/g, '').trim()
        || `Slot ${slot}`;

      slots.push({
        slot,
        qid,
        questionName,
        needsGrading: countMatch ? parseInt(countMatch[1]) : 0,
        alreadyGraded: 0,
        gradeUrl: href,
      });
    }
  }

  return slots;
}

/**
 * Fetch student responses for a specific essay slot.
 *
 * GET /mod/quiz/report.php?id=<cmid>&mode=grading&slot=<slot>&qid=<qid>&grade=needsgrading&pagesize=100
 */
async function fetchStudentResponses(cmid, slotInfo, moodle, options = {}) {
  const { gradeFilter = 'needsgrading' } = options;
  const params = new URLSearchParams({
    id: cmid,
    mode: 'grading',
    slot: slotInfo.slot,
    grade: gradeFilter,
    pagesize: 100,
    action: 'viewquestionpage',
  });
  if (slotInfo.qid) params.set('qid', slotInfo.qid);

  const url = `${moodle.MOODLE_URL}/mod/quiz/report.php?${params}`;
  const resp = await moodle.moodleFetch(url);
  const html = await resp.text();

  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const responses = [];

  // Extract form action URL and sesskey for submission
  // Pick the form whose action contains report.php AND slot= (the grading form, not the navigation form)
  const gradingForm = [...doc.querySelectorAll('form')].find(f =>
    (f.getAttribute('action') || '').includes('report.php') && f.method === 'post'
    && (f.getAttribute('action') || '').includes('slot=')
  );
  const formActionUrl = gradingForm?.getAttribute('action') || url;
  const sesskeyInput = gradingForm?.querySelector('input[name="sesskey"]')
    || doc.querySelector('input[name="sesskey"]');

  // Extract global form fields (qubaids, slots) that are outside individual .que containers
  const globalFields = {};
  if (gradingForm) {
    const qubaidsInput = gradingForm.querySelector('input[name="qubaids"]');
    const slotsInput = gradingForm.querySelector('input[name="slots"]');
    if (qubaidsInput) globalFields.qubaids = qubaidsInput.value;
    if (slotsInput) globalFields.slots = slotsInput.value;
  }
  const sesskey = sesskeyInput?.value || '';

  // Each student's answer is in a div.que.essay with the response and grading form fields
  const questionDivs = doc.querySelectorAll('div.que.essay, div[class*="que essay"]');

  for (const qDiv of questionDivs) {
    // Extract student name from the H4 header before the .que container
    // Moodle renders: <h4>Versuch Nummer X von Vorname Nachname (...)</h4> <div class="que essay ...">
    let studentName = 'Unbekannt';
    const prevH4 = qDiv.previousElementSibling;
    if (prevH4?.tagName === 'H4') {
      const h4Text = prevH4.textContent?.trim() || '';
      const nameMatch = h4Text.match(/von\s+(.+?)(?:\s*\(|$)/);
      if (nameMatch) studentName = nameMatch[1].trim();
    }
    if (studentName === 'Unbekannt') {
      // Fallback: try older selectors
      const userInfo = qDiv.querySelector('.userinfo, .userpicture + a, [class*="user"]');
      if (userInfo) studentName = userInfo.textContent?.trim() || 'Unbekannt';
    }

    // Extract the student's response
    const responseDiv = qDiv.querySelector('.qtype_essay_response, .answer .qtype_essay_editor, .answer');
    const response = responseDiv ? responseDiv.textContent?.trim() : '';

    // Extract form fields for grade submission
    const formFields = extractGradingFormFields(qDiv);

    if (formFields) {
      responses.push({
        studentName,
        response,
        responseHtml: responseDiv?.innerHTML || '',
        formFields,
      });
    }
  }

  // Fallback: try parsing the grading form directly
  if (responses.length === 0) {
    const form = doc.querySelector('form[action*="report.php"]');
    if (form) {
      const containers = form.querySelectorAll('[id^="q"]');
      for (const container of containers) {
        const responseEl = container.querySelector('.qtype_essay_response, .answer, textarea[readonly]');
        const response = responseEl?.textContent?.trim() || responseEl?.value?.trim() || '';
        if (!response) continue;

        const row = container.closest('tr') || container.closest('.questioncontainer');
        const nameEl = row?.querySelector('.userlink, .userpicture + a') || container.previousElementSibling;
        const studentName = nameEl?.textContent?.trim() || 'Unbekannt';

        const formFields = extractGradingFormFields(container);
        if (formFields) {
          responses.push({ studentName, response, responseHtml: responseEl?.innerHTML || '', formFields });
        }
      }
    }
  }

  return { responses, pageData: { formActionUrl, sesskey, globalFields } };
}

/**
 * Extract ALL grading form fields from a question container.
 * Moodle requires sequencecheck, itemid, maxmark, etc. for a valid submission.
 */
function extractGradingFormFields(container) {
  const markInput = container.querySelector('input[name$="-mark"], input[name*="_-mark"]');
  if (!markInput) return null;

  const markName = markInput.name;
  // Derive related field names from mark field name (e.g. q90349:4_-mark → q90349:4_-comment)
  const prefix = markName.replace('-mark', '');

  // Collect all hidden/visible inputs for this question
  const fields = {};
  const allInputs = container.querySelectorAll('input, textarea, select');
  for (const inp of allInputs) {
    if (!inp.name) continue;
    fields[inp.name] = inp.value || '';
  }

  return {
    prefix,
    markFieldName: markName,
    commentFieldName: prefix + '-comment',
    commentFormatFieldName: prefix + '-commentformat',
    currentMark: markInput.value || '',
    fields, // all raw form fields for this question
  };
}

/**
 * Match a GIFT question to a Moodle slot by comparing titles.
 */
function matchQuestionToSlot(questions, slotInfo) {
  const slotName = slotInfo.questionName.toLowerCase();

  // Try exact match on FT-ID
  for (const q of questions) {
    if (slotName.includes(q.id.toLowerCase())) return q;
  }

  // Try matching by title keywords (bidirectional)
  for (const q of questions) {
    const qTitle = q.title.toLowerCase();
    // Check if slot name is contained in GIFT title or vice versa
    if (slotName.length > 3 && qTitle.includes(slotName)) return q;
    if (qTitle.length > 3 && slotName.includes(qTitle)) return q;

    // Keyword match: at least 2 significant words overlap
    const titleWords = qTitle.split(/\s+/).filter(w => w.length > 3);
    const matchCount = titleWords.filter(w => slotName.includes(w)).length;
    if (matchCount >= 2) return q;
  }

  // Try matching by slot number = question index
  // FT-13 to FT-18 in ZP1 = slots 13-18
  const slotNumMatch = slotInfo.questionName.match(/(\d+)/);
  if (slotNumMatch) {
    const num = parseInt(slotNumMatch[1]);
    for (const q of questions) {
      const qNum = parseInt(q.id.replace('FT-', ''));
      if (qNum === num) return q;
    }
  }

  return null;
}

/**
 * Submit graded responses for an entire page back to Moodle.
 *
 * Moodle expects ALL form fields for ALL questions on the page to be submitted
 * together as a single form POST, including sesskey, sequencecheck, itemid, etc.
 *
 * @param {object} pageData - { formActionUrl, sesskey, globalFields }
 * @param {Array<{formFields, score, commentHtml}>} grades - grade data per response
 * @param {object} moodle - Moodle helper functions
 */
async function submitGradesPage(pageData, grades, moodle) {
  const params = new URLSearchParams();
  params.set('sesskey', pageData.sesskey);

  // Add global form fields (qubaids, slots) — required for Moodle to know which attempts are on this page
  for (const [name, value] of Object.entries(pageData.globalFields || {})) {
    params.set(name, value);
  }

  // Add ALL form fields for each question on the page
  for (const grade of grades) {
    const ff = grade.formFields;
    // Set all original hidden fields (sequencecheck, itemid, maxmark, etc.)
    for (const [name, value] of Object.entries(ff.fields)) {
      if (name === ff.markFieldName || name === ff.commentFieldName) continue; // we override these
      params.set(name, value);
    }
    // Set our graded values
    params.set(ff.markFieldName, String(grade.score));
    params.set(ff.commentFieldName, grade.commentHtml);
    params.set(ff.commentFormatFieldName, '1'); // HTML format
  }

  const resp = await moodle.moodleFetch(pageData.formActionUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  // Check if submission was accepted (Moodle redirects on success)
  return resp.redirected || resp.ok;
}

/**
 * Dump the grading page HTML for debugging.
 */
export async function dumpGradingPage(cmid, moodle, options = {}) {
  const { slot } = options;

  let url = `${moodle.MOODLE_URL}/mod/quiz/report.php?id=${cmid}&mode=grading`;
  if (slot) {
    url += `&slot=${slot}&grade=needsgrading&pagesize=5&action=viewquestionpage`;
  }

  console.log(`Fetching: ${url}\n`);
  const resp = await moodle.moodleFetch(url);
  const html = await resp.text();

  const dom = new JSDOM(html);
  const doc = dom.window.document;

  // Print page title
  const title = doc.querySelector('h2, .page-header-headings h1');
  console.log(`Seitentitel: ${title?.textContent?.trim() || '(nicht gefunden)'}\n`);

  if (!slot) {
    // Overview: list all links with slot= parameter
    console.log('=== Essay-Fragen (Links mit slot=) ===');
    const links = doc.querySelectorAll('a[href*="slot="]');
    for (const link of links) {
      console.log(`  ${link.textContent?.trim()} → ${link.getAttribute('href')}`);
    }

    // List tables
    console.log('\n=== Tabellen ===');
    const tables = doc.querySelectorAll('table');
    for (const table of tables) {
      const caption = table.querySelector('caption');
      console.log(`\nTabelle: ${caption?.textContent?.trim() || '(ohne Caption)'}`);
      const rows = table.querySelectorAll('tr');
      for (const row of rows) {
        const cells = [...row.querySelectorAll('td, th')];
        console.log(`  | ${cells.map(c => c.textContent?.trim().slice(0, 50)).join(' | ')} |`);
      }
    }
  } else {
    // Detail: show question containers and form fields
    console.log('=== Frage-Container ===');
    const ques = doc.querySelectorAll('.que, [class*="que "]');
    console.log(`Gefunden: ${ques.length} .que Elemente`);

    for (const q of ques) {
      console.log(`\n  Klassen: ${q.className}`);
      console.log(`  ID: ${q.id}`);

      const responseEl = q.querySelector('.qtype_essay_response, .answer, textarea');
      if (responseEl) {
        console.log(`  Antwort (Auszug): ${responseEl.textContent?.trim().slice(0, 200)}...`);
      }

      const inputs = q.querySelectorAll('input[name*="-mark"], input[name*="-comment"]');
      for (const inp of inputs) {
        console.log(`  Input: name="${inp.name}" value="${inp.value}" type="${inp.type}"`);
      }
    }

    // Show all form fields
    console.log('\n=== Alle Formular-Felder ===');
    const form = doc.querySelector('form');
    if (form) {
      const fields = form.querySelectorAll('input, select, textarea');
      for (const f of fields) {
        if (f.type === 'hidden' && !f.name.includes('-mark') && !f.name.includes('-comment') && f.name !== 'sesskey') continue;
        console.log(`  ${f.tagName} name="${f.name}" type="${f.type}" value="${(f.value || '').slice(0, 80)}"`);
      }
    }
  }
}
