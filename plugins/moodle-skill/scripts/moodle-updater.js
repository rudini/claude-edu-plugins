#!/usr/bin/env node

/**
 * moodle-updater.js
 *
 * CLI tool for managing Moodle courses via HTTP.
 * Uses the MoodleSession cookie for authentication.
 *
 * Setup: Create .env with MOODLE_SESSION, MOODLE_URL, COURSE_ID
 * Help: node moodle-updater.js --help
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, basename } from 'path';
import { JSDOM } from 'jsdom';
import { marked } from 'marked';
import hljs from 'highlight.js/lib/core';
import { markedHighlight } from 'marked-highlight';
// Nur benoetigte Sprachen registrieren
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import xml from 'highlight.js/lib/languages/xml';
import bashLang from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import css from 'highlight.js/lib/languages/css';

hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('bash', bashLang);
hljs.registerLanguage('sh', bashLang);
hljs.registerLanguage('json', json);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('css', css);

// --- Config ---

function loadEnvFile() {
  // Search CWD first, then plugin data dir
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

const envFile = loadEnvFile();

const MOODLE_URL = process.env.MOODLE_URL || envFile.MOODLE_URL;
if (!MOODLE_URL) {
  console.error('Error: MOODLE_URL not set. Add it to .env or set as environment variable.');
  process.exit(1);
}

const courseIdStr = process.env.COURSE_ID || envFile.COURSE_ID;
if (!courseIdStr) {
  console.error('Error: COURSE_ID not set. Add it to .env or set as environment variable.');
  process.exit(1);
}
const COURSE_ID = parseInt(courseIdStr, 10);

const FETCH_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 120_000;

function getSessionCookie() {
  const session = process.env.MOODLE_SESSION || envFile.MOODLE_SESSION;
  if (session) return session;

  console.error('Error: MOODLE_SESSION not found.');
  console.error('');
  console.error('Options:');
  console.error('  1. Create .env file with: MOODLE_SESSION=<value>');
  console.error('  2. Set environment variable: MOODLE_SESSION=<value> node moodle-updater.js ...');
  console.error('');
  console.error('How to find the cookie value:');
  console.error('  Browser > Your Moodle site > Dev Tools > Application > Cookies > MoodleSession');
  process.exit(1);
}

// --- HTTP Helpers ---

function headers() {
  return {
    'Cookie': `MoodleSession=${getSessionCookie()}`,
    'User-Agent': 'MoodleUpdater/1.0',
  };
}

/** Fetch wrapper with auth cookie, auto-redirect, timeout, and retry on network errors. */
async function moodleFetch(url, options = {}) {
  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutMs = options.timeout || FETCH_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, {
        ...options,
        headers: { ...headers(), ...options.headers },
        redirect: 'follow',
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) throw new Error(`HTTP ${resp.status} bei ${url}`);
      return resp;
    } catch (err) {
      clearTimeout(timer);
      const isNetworkError = err.name === 'AbortError' || err.cause?.code === 'ECONNRESET'
        || err.cause?.code === 'ECONNREFUSED' || err.message === 'fetch failed';
      if (!isNetworkError || attempt === maxRetries) throw err;
      const delay = 1000 * Math.pow(2, attempt);
      console.log(`  Retry ${attempt + 1}/${maxRetries}: ${err.message} (${delay}ms warten...)`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function fetchForm(url, formSelector, errorLabel) {
  const resp = await moodleFetch(url);
  const html = await resp.text();
  if (html.includes('login/index.php')) {
    throw new Error('Session abgelaufen. Bitte neuen MoodleSession-Cookie setzen.');
  }
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const form = doc.querySelector(formSelector);
  if (!form) throw new Error(`${errorLabel} nicht gefunden.`);
  return { doc, form, dom, html };
}

function fetchEditForm(moduleId) {
  return fetchForm(
    `${MOODLE_URL}/course/modedit.php?update=${moduleId}&return=1`,
    'form[action*="modedit.php"]', 'Edit-Formular');
}

function fetchSectionForm(sectionId) {
  return fetchForm(
    `${MOODLE_URL}/course/editsection.php?id=${sectionId}&sr=0`,
    'form[action*="editsection.php"]', 'Section-Formular');
}

function fetchAddForm(type, sectionNum, beforemod) {
  const beforeParam = beforemod ? `&beforemod=${beforemod}` : '';
  return fetchForm(
    `${MOODLE_URL}/course/modedit.php?add=${type}&course=${COURSE_ID}&section=${sectionNum}${beforeParam}&return=0&sr=0`,
    'form[action*="modedit.php"]', `Add-${type}-Formular`);
}

function getFormData(form) {
  const params = new URLSearchParams();
  form.querySelectorAll('input, select, textarea').forEach(el => {
    if (!el.name || el.name === 'cancel') return;
    if (el.type === 'checkbox' && !el.checked) return;
    if (el.type === 'radio' && !el.checked) return;
    // Skip non-save submit buttons (e.g. "boundary_add_fields" in quiz forms)
    if (el.type === 'submit' && el.name !== 'submitbutton' && el.name !== 'submitbutton2') return;
    params.append(el.name, el.value || '');
  });
  return params;
}

async function submitForm(url, formData) {
  const resp = await moodleFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
  });
  const html = await resp.text();
  // After successful form submission, Moodle redirects (POST-redirect-GET).
  // Only check for errors if we're still on the form page (no redirect).
  if (!resp.redirected) {
    if (html.includes('class="alert-danger"')) {
      const dom = new JSDOM(html);
      const error = dom.window.document.querySelector('.alert-danger');
      throw new Error(`Moodle-Fehler: ${error?.textContent?.trim() || 'Unbekannt'}`);
    }
    // Check for validation errors (form re-displayed with error class)
    if (html.includes('class="error"') || html.includes('class="fitem has-danger"')) {
      const dom = new JSDOM(html);
      const errors = [...dom.window.document.querySelectorAll('.error, .has-danger .form-control-feedback')];
      const msgs = errors.map(e => e.textContent?.trim()).filter(Boolean).slice(0, 5);
      throw new Error(`Formular-Validierungsfehler: ${msgs.join('; ') || 'Unbekannt (Formular nicht akzeptiert)'}`);
    }
    // Generic: form was re-displayed (not redirected) without explicit errors
    if (html.includes('id="mform1"') || html.includes('_qf__')) {
      console.log('  WARNUNG: Formular wurde nicht akzeptiert (kein Redirect, kein expliziter Fehler)');
      return false;
    }
  }
  return resp.redirected;
}

// --- Core API ---

let _sesskey = null;
let _courseStateCache = null;

async function getSesskey() {
  if (_sesskey) return _sesskey;
  const resp = await moodleFetch(`${MOODLE_URL}/course/view.php?id=${COURSE_ID}`);
  const html = await resp.text();
  _sesskey = html.match(/"sesskey":"([^"]+)"/)?.[1];
  if (!_sesskey) throw new Error('Sesskey nicht gefunden. Session abgelaufen?');
  return _sesskey;
}

function invalidateCache() {
  _sesskey = null;
  _courseStateCache = null;
}

/** Fetch full course state (sections + modules). Cached until invalidateCache(). */
async function getCourseState() {
  if (_courseStateCache) return _courseStateCache;
  const sesskey = await getSesskey();
  const resp = await moodleFetch(`${MOODLE_URL}/lib/ajax/service.php?sesskey=${sesskey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{
      index: 0,
      methodname: 'core_courseformat_get_state',
      args: { courseid: COURSE_ID }
    }])
  });
  const result = await resp.json();
  if (result[0]?.error) throw new Error(result[0].exception?.message || 'API-Fehler');
  _courseStateCache = JSON.parse(result[0].data);
  return _courseStateCache;
}

/** Execute a Moodle course format AJAX action (e.g. cm_move, cm_hide, section_add). */
async function courseFormatAction(action, ids, options = {}) {
  const sesskey = await getSesskey();
  const args = { action, courseid: COURSE_ID, ids };
  if (options.targetsectionid !== undefined) args.targetsectionid = options.targetsectionid;
  if (options.targetcmid !== undefined) args.targetcmid = options.targetcmid;

  const resp = await moodleFetch(`${MOODLE_URL}/lib/ajax/service.php?sesskey=${sesskey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{
      index: 0,
      methodname: 'core_courseformat_update_course',
      args
    }])
  });
  const result = await resp.json();
  if (result[0]?.error) throw new Error(`AJAX-Fehler (${action}): ${result[0].exception?.message || 'Unbekannt'}`);
  return result[0];
}

// --- Kursstruktur ---

async function showStructure() {
  const data = await getCourseState();
  console.log(`\nKurs ${COURSE_ID}: ${data.section.length} Sections\n`);
  console.log('-'.repeat(70));
  for (const section of data.section) {
    console.log(`Section ${String(section.number).padStart(2)} (ID: ${section.id}): ${section.title}`);
    if (section.cmlist.length > 0) {
      console.log(`  Modules: ${section.cmlist.join(', ')}`);
    }
  }
  console.log('-'.repeat(70));
}

async function listActivities(sectionId) {
  const state = await getCourseState();
  const section = state.section.find(s => String(s.id) === String(sectionId));
  if (!section) throw new Error(`Section mit ID ${sectionId} nicht gefunden.`);

  console.log(`\nSection ${section.number} (ID: ${section.id}): ${section.title}`);
  console.log(`${section.cmlist.length} Aktivitaeten\n`);
  console.log('-'.repeat(70));

  for (const cmId of section.cmlist) {
    const cm = state.cm.find(m => m.id === cmId);
    if (!cm) {
      console.log(`  ${cmId}: (nicht gefunden)`);
      continue;
    }
    const flags = [];
    if (cm.indent) flags.push(`indent-${cm.indent}`);
    if (!cm.visible) flags.push('hidden');
    const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : '';
    console.log(`  ${cm.id}: ${cm.module} | ${cm.name}${flagStr}`);
  }
  console.log('-'.repeat(70));
}

// --- Show-Befehle ---

async function showLabel(moduleId) {
  const { form } = await fetchEditForm(moduleId);
  const content = form.querySelector('[name="introeditor[text]"]')?.value;
  if (!content) throw new Error('introeditor[text] nicht gefunden');
  const name = form.querySelector('[name="name"]')?.value || 'unbekannt';
  console.log(`\nLabel ${moduleId}: ${name}\n`);
  console.log('-'.repeat(70));
  console.log(content);
  console.log('-'.repeat(70));
}

async function showPage(moduleId) {
  const { form } = await fetchEditForm(moduleId);
  const content = form.querySelector('[name="page[text]"]')?.value ||
                  form.querySelector('[name="introeditor[text]"]')?.value;
  if (!content) throw new Error('Content-Feld nicht gefunden');
  const name = form.querySelector('[name="name"]')?.value || 'unbekannt';
  console.log(`\nPage ${moduleId}: ${name}\n`);
  console.log('-'.repeat(70));
  console.log(content);
  console.log('-'.repeat(70));
}

// --- Update-Befehle ---

async function updateModuleContent(label, id, htmlFile, live, { fetchFn, fieldSelector, submitUrl }) {
  const neuerHtml = readFileSync(resolve(htmlFile), 'utf-8').trim();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`${label}: ${id} ${live ? '(LIVE)' : '(DRY RUN)'}`);
  console.log('='.repeat(60));

  const { form } = await fetchFn(id);
  const contentField = typeof fieldSelector === 'string'
    ? form.querySelector(fieldSelector)
    : fieldSelector(form);
  if (!contentField) throw new Error('Content-Feld nicht gefunden');

  console.log('\nVORHER (Auszug):');
  console.log(contentField.value.substring(0, 300));
  console.log('\nNACHHER (Auszug):');
  console.log(neuerHtml.substring(0, 300));

  if (!live) {
    console.log('\nDRY RUN - nichts geaendert. Mit --live ausfuehren zum Absenden.');
    return;
  }

  const formData = getFormData(form);
  formData.set(contentField.name, neuerHtml);
  await submitForm(`${MOODLE_URL}${submitUrl}`, formData);
  console.log(`\n${label} erfolgreich aktualisiert!`);
}

function updateLabel(moduleId, htmlFile, live) {
  return updateModuleContent('Label-Update', moduleId, htmlFile, live, {
    fetchFn: fetchEditForm,
    fieldSelector: '[name="introeditor[text]"]',
    submitUrl: '/course/modedit.php',
  });
}

function updatePage(moduleId, htmlFile, live) {
  return updateModuleContent('Page-Update', moduleId, htmlFile, live, {
    fetchFn: fetchEditForm,
    fieldSelector: (form) => form.querySelector('[name="page[text]"]') || form.querySelector('[name="introeditor[text]"]'),
    submitUrl: '/course/modedit.php',
  });
}

function updateSummary(sectionId, htmlFile, live) {
  return updateModuleContent('Section-Summary-Update', sectionId, htmlFile, live, {
    fetchFn: fetchSectionForm,
    fieldSelector: '[name="summary_editor[text]"]',
    submitUrl: '/course/editsection.php',
  });
}

// --- Strukturelle Befehle ---

async function duplicateSection(live) {
  const state = await getCourseState();
  const lastSection = state.section[state.section.length - 1];

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Section duplizieren ${live ? '(LIVE)' : '(DRY RUN)'}`);
  console.log('='.repeat(60));
  console.log(`Quelle: Section ${lastSection.number} (ID: ${lastSection.id}): "${lastSection.title}"`);
  console.log(`Module: ${lastSection.cmlist.length}`);

  if (!live) {
    console.log('\nDRY RUN - nichts geaendert. Mit --live ausfuehren.');
    return;
  }

  await courseFormatAction('section_duplicate', [lastSection.id]);
  invalidateCache();

  const newState = await getCourseState();
  const newSection = newState.section[newState.section.length - 1];
  console.log(`\nNeue Section erstellt: ${newSection.number} (ID: ${newSection.id}): "${newSection.title}"`);
}

async function renameSection(sectionId, title, live) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Section umbenennen: ${sectionId} ${live ? '(LIVE)' : '(DRY RUN)'}`);
  console.log('='.repeat(60));
  console.log(`Neuer Titel: "${title}"`);

  if (!live) {
    console.log('\nDRY RUN - nichts geaendert. Mit --live ausfuehren.');
    return;
  }

  const { form } = await fetchSectionForm(sectionId);
  const formData = getFormData(form);

  // Uncheck "use default name" and set custom name
  formData.delete('usedefaultname');
  formData.set('name', title);

  await submitForm(`${MOODLE_URL}/course/editsection.php`, formData);
  console.log('\nSection erfolgreich umbenannt!');
}

async function createModule(type, sectionNum, name, live, fieldSetup, beforemod) {
  console.log(`  ${type} erstellen: "${name}" (Section ${sectionNum})${beforemod ? ` [beforemod=${beforemod}]` : ''}`);

  if (!live) return;

  const { form } = await fetchAddForm(type, sectionNum, beforemod);
  const formData = getFormData(form);
  formData.set('name', name);
  if (fieldSetup) fieldSetup(form, formData);

  const success = await submitForm(`${MOODLE_URL}/course/modedit.php`, formData);
  if (!success) {
    throw new Error(`${type} "${name}" konnte nicht erstellt werden (Formular nicht akzeptiert).`);
  }
  console.log(`  ${type} erstellt: "${name}"`);
}

/** Refresh state and find all new module IDs by diffing cmlist before/after. */
async function resolveNewModuleIds(sectionNum, cmlistBefore) {
  invalidateCache();
  const state = await getCourseState();
  const section = state.section.find(s => s.number === sectionNum);
  if (!section) return [];
  const beforeSet = new Set(cmlistBefore);
  return section.cmlist.filter(id => !beforeSet.has(id));
}

// --- Schedule / Date Helpers ---

/**
 * Set Moodle date sub-fields from a Unix timestamp (seconds).
 * Converts to Europe/Zurich local time for the form fields.
 * @param {boolean} [withEnabled=true] - Whether to set the [enabled] sub-field (some fields like cutoffdate don't have it)
 */
function setMoodleDateFields(formData, fieldName, timestamp, withEnabled = true) {
  const date = new Date(timestamp * 1000);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: process.env.MOODLE_TZ || 'Europe/Zurich',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(date);
  const get = (type) => parseInt(parts.find(p => p.type === type)?.value || '0', 10);

  if (withEnabled) formData.set(`${fieldName}[enabled]`, '1');
  formData.set(`${fieldName}[day]`, String(get('day')));
  formData.set(`${fieldName}[month]`, String(get('month')));
  formData.set(`${fieldName}[year]`, String(get('year')));
  formData.set(`${fieldName}[hour]`, String(get('hour')));
  formData.set(`${fieldName}[minute]`, String(get('minute')));
}

function createUrl(sectionNum, name, externalUrl, live, beforemod) {
  return createModule('url', sectionNum, name, live, (_form, formData) => {
    formData.set('externalurl', externalUrl);
  }, beforemod);
}

function createPage(sectionNum, name, htmlContent, live, beforemod) {
  return createModule('page', sectionNum, name, live, (form, formData) => {
    const pageTextField = form.querySelector('[name="page[text]"]');
    if (pageTextField) {
      formData.set('page[text]', htmlContent);
      formData.set('page[format]', '1');
    } else {
      formData.set('introeditor[text]', htmlContent);
      formData.set('introeditor[format]', '1');
    }
  }, beforemod);
}

function createAssign(sectionNum, name, introHtml, live, beforemod, dates) {
  return createModule('assign', sectionNum, name, live, (_form, formData) => {
    if (introHtml) {
      formData.set('introeditor[text]', introHtml);
      formData.set('introeditor[format]', '1');
    }
    if (dates) {
      if (dates.open !== undefined) setMoodleDateFields(formData, 'allowsubmissionsfromdate', dates.open);
      if (dates.due !== undefined) {
        setMoodleDateFields(formData, 'duedate', dates.due);
        // cutoffdate = duedate (no late submissions); field has no [enabled] toggle
        setMoodleDateFields(formData, 'cutoffdate', dates.due, false);
        // gradingduedate must be >= duedate; set to 7 days after due
        setMoodleDateFields(formData, 'gradingduedate', dates.due + 7 * 24 * 60 * 60);
      }
    }
  }, beforemod);
}

function createForum(sectionNum, name, introHtml, live, beforemod) {
  return createModule('forum', sectionNum, name, live, (_form, formData) => {
    if (introHtml) {
      formData.set('introeditor[text]', introHtml);
      formData.set('introeditor[format]', '1');
    }
    formData.set('type', 'general');
    // Forum form has completionpostsenabled checked by default, which conflicts with
    // completion=0 (disabled) and causes silent form rejection. Remove all completion
    // condition fields and explicitly set completion to disabled.
    for (const [k] of [...formData.entries()]) {
      if (k.startsWith('completion')) formData.delete(k);
    }
    formData.set('completion', '0');
  }, beforemod);
}

// --- Quiz ---

/** Create a Moodle quiz with SEB configuration. */
async function createQuiz(sectionNum, config, live) {
  console.log(`  quiz erstellen: "${config.name}" (Section ${sectionNum})`);

  if (!live) return;

  const { form } = await fetchAddForm('quiz', sectionNum);
  const formData = getFormData(form);

  formData.set('name', config.name);
  formData.set('timelimit[number]', String(config.timeLimit));
  formData.set('timelimit[timeunit]', '1');  // 1 = Sekunden
  formData.set('attempts', String(config.attempts));
  formData.set('shuffleanswers', config.shuffle ? '1' : '0');
  formData.set('preferredbehaviour', 'deferredfeedback');

  // SEB-Konfiguration (Feldnamen via dump-form verifiziert)
  if (config.seb) {
    formData.set('seb_requiresafeexambrowser', '1');  // 1 = Manuell konfigurieren (Moodle 4.5)
    formData.set('seb_showsebdownloadlink', '1');
    formData.set('seb_linkquitseb', '');
    formData.set('seb_userconfirmquit', '1');
    formData.set('seb_allowuserquitseb', '1');
    formData.set('seb_activateurlfiltering', config.sebUrls.length > 0 ? '1' : '0');
    formData.set('seb_filterembeddedcontent', '0');  // NICHT aktivieren (bricht MS-Login)
    formData.set('seb_expressionsallowed', config.sebUrls.join('\n'));
    formData.set('seb_regexallowed', '');
    formData.set('seb_expressionsblocked', '');
    formData.set('seb_regexblocked', '');
    formData.set('seb_allowedbrowserexamkeys', '');
  }

  // Review-Optionen konfigurieren
  if (config.review) {
    const presets = getReviewPreset(config.review);
    for (const [field, value] of Object.entries(presets)) {
      formData.set(field, value);
    }
    console.log(`  review-optionen: "${config.review}" Preset angewendet`);
  }

  // Schedule: open/close times
  if (config.timeopen) setMoodleDateFields(formData, 'timeopen', config.timeopen);
  if (config.timeclose) setMoodleDateFields(formData, 'timeclose', config.timeclose);

  const success = await submitForm(`${MOODLE_URL}/course/modedit.php`, formData);
  if (!success) {
    throw new Error(`Quiz "${config.name}" konnte nicht erstellt werden (Formular nicht akzeptiert).`);
  }
  console.log(`  quiz erstellt: "${config.name}"`);
}

/**
 * Review-Option Presets für Moodle Quiz.
 * Moodle-Felder: {aspect}{timing} wobei
 *   aspect = attempt, correctness, maxmarks, marks, specificfeedback, generalfeedback, rightanswer, overallfeedback
 *   timing = during, immediately, open, closed
 * Wert '1' = Checkbox aktiv (anzeigen), Feld weglassen/löschen = nicht anzeigen.
 */
function getReviewPreset(preset) {
  const aspects = ['attempt', 'correctness', 'maxmarks', 'marks', 'specificfeedback', 'generalfeedback', 'rightanswer', 'overallfeedback'];
  const timings = ['during', 'immediately', 'open', 'closed'];

  // Alle Felder zuerst auf '0' setzen
  const fields = {};
  for (const a of aspects) {
    for (const t of timings) fields[`${a}${t}`] = '0';
  }

  if (preset === 'exam') {
    // Während des Versuchs: nur Versuch sichtbar (Navigation)
    fields.attemptduring = '1';
    // Sofort nach Abgabe: nur Versuch + Punkte (Student sieht, dass abgegeben wurde)
    fields.attemptimmediately = '1';
    fields.maxmarksimmediately = '1';
    // Später, solange offen: nichts (verhindert Austausch)
    // Nach Schliessung: alles (für Besprechung)
    fields.attemptclosed = '1';
    fields.correctnessclosed = '1';
    fields.maxmarksclosed = '1';
    fields.marksclosed = '1';
    fields.specificfeedbackclosed = '1';
    fields.generalfeedbackclosed = '1';
    fields.rightanswerclosed = '1';
    fields.overallfeedbackclosed = '1';
  } else if (preset === 'open') {
    // Alles sofort sichtbar (z.B. Übungsquiz)
    for (const a of aspects) {
      fields[`${a}immediately`] = '1';
      fields[`${a}open`] = '1';
      fields[`${a}closed`] = '1';
    }
    fields.attemptduring = '1';
    fields.maxmarksduring = '1';
  } else {
    throw new Error(`Unbekanntes Review-Preset: "${preset}". Erlaubt: exam, open`);
  }

  return fields;
}

/** Import GIFT questions into a quiz's question bank via Moodle import form. */
async function importGiftQuestions(giftPath, quizCmId, quizName) {
  // 1. Read GIFT content, strip our custom header lines
  const content = readFileSync(giftPath, 'utf-8');
  const lines = content.split('\n');
  const strippedContent = lines
    .filter(l => !l.match(/^\/\/\s*(quiz_name|time_limit|seb|seb_urls|attempts|shuffle|review):/))
    .filter(l => !l.match(/^\$CATEGORY:/))
    .join('\n');

  // Derive quiz name from GIFT header if not provided
  if (!quizName) {
    const nameMatch = content.match(/^\/\/\s*quiz_name:\s*(.+)$/m);
    quizName = nameMatch ? nameMatch[1].trim() : basename(giftPath, '.gift');
  }

  // Prepend $CATEGORY so Moodle creates a dedicated category for this quiz
  const giftContent = `$CATEGORY: $course$/${quizName}\n\n${strippedContent}`;

  // 2. Load the import form
  const importUrl = `${MOODLE_URL}/question/bank/importquestions/import.php?cmid=${quizCmId}`;
  const resp = await moodleFetch(importUrl);
  const html = await resp.text();
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const form = doc.querySelector('form[action*="import.php"]');
  if (!form) throw new Error('Import-Formular nicht gefunden');

  // 3. Extract draft area itemid from the file input
  const fileInput = form.querySelector('input[name="newfile"]');
  const itemid = fileInput?.value || '0';

  // 4. Extract context ID and upload repo ID from page
  const scriptTags = [...doc.querySelectorAll('script')];
  let ctxId = null;
  for (const script of scriptTags) {
    const ctxMatch = (script.textContent || '').match(/"contextid"\s*:\s*(\d+)/);
    if (ctxMatch) { ctxId = ctxMatch[1]; break; }
  }
  if (!ctxId) {
    for (const script of scriptTags) {
      const cfgMatch = (script.textContent || '').match(/M\.cfg\s*=\s*\{[^}]*contextid\s*:\s*(\d+)/);
      if (cfgMatch) { ctxId = cfgMatch[1]; break; }
    }
  }
  if (!ctxId) throw new Error('Context-ID fuer Import nicht gefunden');

  const sesskey = await getSesskey();
  const repoId = extractUploadRepoId(html);

  // 5. Upload GIFT file to draft area
  const giftBlob = new Blob([giftContent], { type: 'text/plain' });
  const fileName = basename(giftPath);

  const uploadFormData = new FormData();
  uploadFormData.append('repo_upload_file', giftBlob, fileName);
  uploadFormData.append('title', fileName);
  uploadFormData.append('author', 'Dozent');
  uploadFormData.append('license', 'allrightsreserved');
  uploadFormData.append('itemid', String(itemid));
  uploadFormData.append('repo_id', String(repoId));
  uploadFormData.append('sesskey', sesskey);
  uploadFormData.append('client_id', 'moodle-updater');
  uploadFormData.append('ctx_id', String(ctxId));
  uploadFormData.append('env', 'filemanager');
  uploadFormData.append('savepath', '/');

  const uploadResp = await moodleFetch(`${MOODLE_URL}/repository/repository_ajax.php?action=upload`, {
    method: 'POST',
    headers: { 'Cookie': `MoodleSession=${getSessionCookie()}` },
    body: uploadFormData,
    timeout: UPLOAD_TIMEOUT_MS,
  });
  const uploadResult = await uploadResp.json();
  if (uploadResult.error) throw new Error(`GIFT-Upload-Fehler: ${uploadResult.error}`);
  console.log(`  GIFT-Datei hochgeladen: ${fileName}`);

  // 6. Submit the import form (format = gift)
  // Moodle import is a single POST that both parses and imports.
  // The response is a preview page with a "Weiter" link (not a confirmation form).
  // Set stoponerror=0 so partial imports succeed even if some questions have parse errors.
  const formData = getFormData(form);
  formData.set('format', 'gift');
  formData.set('stoponerror', '0');
  const importResp = await moodleFetch(importUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
  });
  const importHtml = await importResp.text();

  // Check for errors
  if (importHtml.includes('alert-danger')) {
    const dom2 = new JSDOM(importHtml);
    const errors = [...dom2.window.document.querySelectorAll('.alert-danger')];
    for (const err of errors) {
      const text = err.textContent?.replace(/\s+/g, ' ').trim();
      if (text && !text.includes('Bei Fehler stoppen')) {
        console.log(`  WARNUNG: ${text.slice(0, 150)}`);
      }
    }
  }

  // Count imported questions from response
  const importedMatch = importHtml.match(/(\d+)\s*Fragen?\s*werden\s*aus/);
  const parsedCount = importedMatch ? parseInt(importedMatch[1]) : 0;
  const expectedCount = lines.filter(l => l.startsWith('::')).length;
  if (parsedCount > 0) {
    console.log(`  ${parsedCount} Fragen erkannt, ${expectedCount} erwartet`);
  } else {
    console.log(`  WARNUNG: Keine Fragen im Import erkannt (${expectedCount} erwartet)`);
  }
}

/**
 * Find a question category by name from the question bank page.
 * Loads question/edit.php for the quiz context and parses the category <select>.
 * Returns { catId, ctxId } or null if not found.
 *
 * Moodle 4.5: category select has single-value IDs (e.g., "80632").
 * The context ID is extracted from the data-filtercondition JSON attribute.
 * Note: JSDOM fails to find this select, so we use regex on raw HTML.
 */
async function findQuizCategory(quizCmId, categoryName) {
  const qbResp = await moodleFetch(`${MOODLE_URL}/question/edit.php?cmid=${quizCmId}`);
  const qbHtml = await qbResp.text();

  // Extract context ID from the data-filtercondition (format: "cat":"67792,446883")
  const filterMatch = qbHtml.match(/data-filtercondition="([^"]+)"/);
  let ctxId = null;
  if (filterMatch) {
    const decoded = filterMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    const filter = JSON.parse(decoded);
    ctxId = filter.cat?.split(',')?.[1];
  }
  if (!ctxId) return null;

  // Parse category select via regex (JSDOM doesn't reliably find this select in Moodle 4.5)
  const selectMatch = qbHtml.match(/<select[^>]*name="category"[^>]*>([\s\S]*?)<\/select>/);
  if (!selectMatch) return null;

  const options = [...selectMatch[1].matchAll(/<option[^>]*value="(\d+)"[^>]*>([\s\S]*?)<\/option>/g)];
  for (const [, value, rawText] of options) {
    const text = rawText.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/<[^>]*>/g, '').trim();
    // Match exact category name (possibly followed by " (N)" count suffix)
    // Avoid matching "Oberste für ..." or "Standard für ..." prefixed entries
    if (text === categoryName || text.startsWith(categoryName + ' (')) {
      return { catId: value, ctxId };
    }
  }
  return null;
}

/**
 * Get question IDs from a specific category via the Moodle AJAX web service.
 * Uses core_question_get_random_question_summaries (works in Moodle 4.5).
 */
async function getQuestionIdsInCategory(catId, ctxId) {
  const sesskey = await getSesskey();
  const payload = [{
    index: 0,
    methodname: 'core_question_get_random_question_summaries',
    args: {
      categoryid: parseInt(catId),
      includesubcategories: false,
      tagids: [],
      contextid: parseInt(ctxId),
      limit: 1000
    }
  }];

  const resp = await moodleFetch(
    `${MOODLE_URL}/lib/ajax/service.php?sesskey=${sesskey}&info=core_question_get_random_question_summaries`,
    {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  );
  const result = await resp.json();
  if (result[0]?.error) {
    console.log(`  WARNUNG: Fragen-Abfrage fehlgeschlagen: ${result[0].exception?.message}`);
    return [];
  }
  return (result[0]?.data?.questions || []).map(q => String(q.id));
}

/**
 * Delete all questions in a specific quiz category (for cleanup before re-import).
 * If the category doesn't exist yet (first import), silently skips.
 */
async function deleteQuizCategoryQuestions(quizCmId, categoryName) {
  // 1. Find the category
  const cat = await findQuizCategory(quizCmId, categoryName);
  if (!cat) {
    console.log(`  Kategorie "${categoryName}" nicht gefunden (erster Import). Ueberspringe Cleanup.`);
    return 0;
  }

  // 2. Get question IDs via web service
  const questionIds = await getQuestionIdsInCategory(cat.catId, cat.ctxId);
  if (questionIds.length === 0) {
    console.log(`  Keine Fragen in Kategorie "${categoryName}" zum Loeschen.`);
    return 0;
  }

  // 3. Delete via POST to delete.php (skip confirmation by providing md5 of question list)
  const sesskey = await getSesskey();
  const deleteList = questionIds.join(',');
  const confirm = createHash('md5').update(deleteList).digest('hex');

  const deleteForm = new URLSearchParams();
  deleteForm.set('deleteselected', deleteList);
  deleteForm.set('confirm', confirm);
  deleteForm.set('sesskey', sesskey);
  deleteForm.set('cmid', String(quizCmId));
  deleteForm.set('returnurl', `/question/edit.php?cmid=${quizCmId}`);
  deleteForm.set('deleteall', '1');

  const deleteResp = await moodleFetch(
    `${MOODLE_URL}/question/bank/deletequestion/delete.php`,
    { method: 'POST', body: deleteForm }
  );

  if (deleteResp.ok || deleteResp.redirected) {
    console.log(`  ${questionIds.length} alte Fragen aus Kategorie "${categoryName}" geloescht.`);
  } else {
    console.log(`  WARNUNG: Fragen-Loesch-Request gab Status ${deleteResp.status}`);
  }

  return questionIds.length;
}

/**
 * Add questions from a specific category to a quiz (questions not yet assigned as slots).
 * Uses the Moodle AJAX web service to list questions by category.
 */
async function addQuestionsToQuiz(quizCmId, categoryName) {
  // 1. Load quiz edit page to get sesskey and count existing slots
  const editResp = await moodleFetch(`${MOODLE_URL}/mod/quiz/edit.php?cmid=${quizCmId}`);
  const editHtml = await editResp.text();
  const sesskey = editHtml.match(/"sesskey"\s*:\s*"([^"]+)"/)?.[1];
  if (!sesskey) throw new Error('Sesskey nicht gefunden auf Quiz-Edit-Seite');
  const existingSlots = (editHtml.match(/id="slot-\d+"/g) || []).length;

  // 2. Get question IDs (filtered by category if provided)
  let questionIds = [];
  if (categoryName) {
    const cat = await findQuizCategory(quizCmId, categoryName);
    if (cat) {
      questionIds = await getQuestionIdsInCategory(cat.catId, cat.ctxId);
    } else {
      console.log(`  WARNUNG: Kategorie "${categoryName}" nicht gefunden.`);
    }
  }

  if (questionIds.length === 0) {
    console.log('  Keine Fragen in der Fragensammlung gefunden.');
    return 0;
  }

  if (existingSlots >= questionIds.length) {
    console.log(`  Quiz hat bereits ${existingSlots} Slots (${questionIds.length} Fragen in Bank). Ueberspringe.`);
    return 0;
  }

  // 3. Add all questions via single POST (bulk add via edit.php form)
  console.log(`  ${questionIds.length} Fragen dem Quiz zuordnen...`);
  const formData = new URLSearchParams();
  formData.set('sesskey', sesskey);
  formData.set('add', '1');
  formData.set('addonpage', '0');
  for (const qid of questionIds) {
    formData.set(`q${qid}`, '1');
  }

  const addResp = await fetch(
    `${MOODLE_URL}/mod/quiz/edit.php?cmid=${quizCmId}`,
    {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
      redirect: 'manual'
    }
  );

  if (addResp.status === 303 || addResp.status === 302) {
    console.log(`  ${questionIds.length} Fragen dem Quiz zugeordnet.`);
    return questionIds.length;
  }
  console.log(`  WARNUNG: Quiz-Add-Request gab Status ${addResp.status} (erwartet: 303)`);
  return 0;
}

// --- Datei-Upload (Resource) ---

let _uploadRepoId = null;

/** Find the Moodle "upload" repository ID by parsing it from the form page HTML (cached). */
function extractUploadRepoId(formPageHtml) {
  if (_uploadRepoId) return _uploadRepoId;
  const match = formPageHtml.match(/"(\d+)":\{"id":"\d+","name":"[^"]*","type":"upload"/);
  if (!match) throw new Error('Upload-Repository-ID nicht im Formular-HTML gefunden');
  _uploadRepoId = match[1];
  return _uploadRepoId;
}

/** Upload a file to Moodle's draft area via multipart POST. */
async function uploadToDraftArea(filePath, itemid, { ctxId, repoId, sesskey }) {
  const fileBuffer = readFileSync(filePath);
  const fileName = basename(filePath);

  const formData = new FormData();
  formData.append('repo_upload_file', new Blob([fileBuffer]), fileName);
  formData.append('title', fileName);
  formData.append('author', 'Dozent');
  formData.append('license', 'allrightsreserved');
  formData.append('itemid', String(itemid));
  formData.append('repo_id', String(repoId));
  formData.append('sesskey', sesskey);
  formData.append('client_id', 'moodle-updater');
  formData.append('ctx_id', String(ctxId));
  formData.append('env', 'filemanager');
  formData.append('savepath', '/');

  const resp = await moodleFetch(`${MOODLE_URL}/repository/repository_ajax.php?action=upload`, {
    method: 'POST',
    headers: { 'Cookie': `MoodleSession=${getSessionCookie()}` },
    body: formData,
    timeout: UPLOAD_TIMEOUT_MS,
  });
  const result = await resp.json();
  if (result.error) throw new Error(`Upload-Fehler: ${result.error}`);
  return result;
}

/** Create a Moodle "resource" (file) activity: load form, upload file to draft, submit form. */
async function createResource(sectionNum, name, filePath, live, beforemod) {
  console.log(`  resource erstellen: "${name}" (Section ${sectionNum})${beforemod ? ` [beforemod=${beforemod}]` : ''}`);

  if (!live) return null;

  // 1. Load the add-resource form
  const { form, doc, html: formPageHtml } = await fetchAddForm('resource', sectionNum, beforemod);

  // 2. Extract itemid from the hidden filemanager input
  const filemanagerInput = form.querySelector('input[name="files_filemanager"]')
    || form.querySelector('input[name="files"]');
  if (!filemanagerInput) throw new Error('files/files_filemanager input nicht gefunden im Resource-Formular');
  const itemid = filemanagerInput.value;

  // 3. Extract context ID from page
  const scriptTags = [...doc.querySelectorAll('script')];
  let ctxId = null;
  for (const script of scriptTags) {
    const ctxMatch = (script.textContent || '').match(/"contextid"\s*:\s*(\d+)/);
    if (ctxMatch) { ctxId = ctxMatch[1]; break; }
  }
  // Fallback: try M.cfg.contextid
  if (!ctxId) {
    for (const script of scriptTags) {
      const cfgMatch = (script.textContent || '').match(/M\.cfg\s*=\s*\{[^}]*contextid\s*:\s*(\d+)/);
      if (cfgMatch) { ctxId = cfgMatch[1]; break; }
    }
  }
  // Fallback: hidden input
  if (!ctxId) {
    const ctxInput = form.querySelector('input[name="ctx_id"]') || doc.querySelector('input[name="ctx_id"]');
    if (ctxInput) ctxId = ctxInput.value;
  }
  if (!ctxId) throw new Error('Context-ID (ctx_id) nicht gefunden');

  const sesskey = await getSesskey();
  const repoId = extractUploadRepoId(formPageHtml);

  // 4. Upload file to draft area
  console.log(`  Datei hochladen: ${basename(filePath)} (itemid=${itemid}, ctx=${ctxId}, repo=${repoId})`);
  await uploadToDraftArea(filePath, itemid, { ctxId, repoId, sesskey });

  // 5. Submit the form with the uploaded file
  const formData = getFormData(form);
  formData.set('name', name);
  const success = await submitForm(`${MOODLE_URL}/course/modedit.php`, formData);
  if (!success) {
    throw new Error(`Resource "${name}" konnte nicht erstellt werden (Formular nicht akzeptiert).`);
  }
  console.log(`  resource erstellt: "${name}"`);
}

async function deleteActivity(moduleId, live) {
  console.log(`  Aktivitaet loeschen: Module ${moduleId}`);

  if (!live) return;

  await courseFormatAction('cm_delete', [moduleId]);
}

async function indentActivity(moduleId, live) {
  console.log(`  Aktivitaet einruecken: Module ${moduleId}`);

  if (!live) return;

  await courseFormatAction('cm_moveright', [moduleId]);
}

async function hideActivity(moduleId, live) {
  console.log(`  Aktivitaet verbergen: Module ${moduleId}`);

  if (!live) return;

  await courseFormatAction('cm_hide', [moduleId]);
}

async function moveActivity(moduleId, afterModuleId, live) {
  console.log(`  Aktivitaet verschieben: Module ${moduleId} nach ${afterModuleId}`);

  if (!live) return;

  // Get the section ID of the target module
  const state = await getCourseState();
  const targetCm = state.cm.find(cm => String(cm.id) === String(afterModuleId));
  if (!targetCm) throw new Error(`Ziel-Module ${afterModuleId} nicht gefunden`);

  await courseFormatAction('cm_move', [moduleId], {
    targetsectionid: targetCm.sectionid,
    targetcmid: afterModuleId
  });
}

// --- HTML-Generierung: Inline-Styles (GitHub Light Theme) ---

const STYLES = {
  codeBlock: 'background-color: #f6f8fa; border-radius: 6px; padding: 16px; overflow: auto; font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; font-size: 85%; line-height: 1.45;',
  codeInline: 'background-color: rgba(175,184,193,0.2); padding: 0.2em 0.4em; border-radius: 6px; font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; font-size: 85%;',
  blockquote: 'border-left: 4px solid #d0d7de; padding: 0 1em; color: #656d76; margin: 0 0 16px 0;',
  h1: 'font-size: 1.6em; font-weight: 600; margin: 24px 0 16px 0; padding-bottom: 0.3em; border-bottom: 1px solid #d8dee4;',
  h2: 'font-size: 1.35em; font-weight: 600; margin: 24px 0 16px 0; padding-bottom: 0.3em; border-bottom: 1px solid #d8dee4;',
  h3: 'font-size: 1.25em; font-weight: 600; margin: 24px 0 16px 0; padding-bottom: 0.3em; border-bottom: 1px solid #d8dee4;',
  h4: 'font-size: 1em; font-weight: 600; margin: 24px 0 16px 0;',
  h5: 'font-size: 0.875em; font-weight: 600; margin: 24px 0 16px 0;',
  table: 'border-collapse: collapse; width: 100%; margin-bottom: 16px;',
  th: 'padding: 6px 13px; border: 1px solid #d0d7de; font-weight: 600; background-color: #f6f8fa; text-align: left;',
  td: 'padding: 6px 13px; border: 1px solid #d0d7de;',
  ul: 'padding-left: 2em; margin-bottom: 16px;',
  ol: 'padding-left: 2em; margin-bottom: 16px;',
  li: 'margin-top: 0.25em;',
  p: 'margin-bottom: 16px; line-height: 1.5;',
  a: 'color: #0969da; text-decoration: none;',
  hr: 'height: 0.25em; padding: 0; margin: 24px 0; background-color: #d0d7de; border: 0;',
  img: 'max-width: 100%; height: auto;',
  trPause: 'background-color: #f0f0f0; font-style: italic;',
};

const HLJ_STYLES = {
  'hljs-keyword': 'color: #cf222e;',
  'hljs-built_in': 'color: #8250df;',
  'hljs-type': 'color: #8250df;',
  'hljs-literal': 'color: #0550ae;',
  'hljs-number': 'color: #0550ae;',
  'hljs-string': 'color: #0a3069;',
  'hljs-comment': 'color: #6e7781; font-style: italic;',
  'hljs-doctag': 'color: #6e7781;',
  'hljs-meta': 'color: #6e7781;',
  'hljs-attr': 'color: #0550ae;',
  'hljs-attribute': 'color: #0550ae;',
  'hljs-name': 'color: #116329;',
  'hljs-tag': 'color: #116329;',
  'hljs-title': 'color: #8250df;',
  'hljs-function': 'color: #8250df;',
  'hljs-selector-class': 'color: #116329;',
  'hljs-selector-id': 'color: #0550ae;',
  'hljs-selector-tag': 'color: #116329;',
  'hljs-variable': 'color: #953800;',
  'hljs-template-variable': 'color: #953800;',
  'hljs-params': 'color: inherit;',
  'hljs-property': 'color: #0550ae;',
  'hljs-punctuation': 'color: inherit;',
};

/** Replace hljs class attributes with inline styles for Moodle compatibility. */
function hljsClassToInlineStyle(html) {
  return html.replace(/class="(hljs-[\w-]+)"/g, (match, cls) => {
    const style = HLJ_STYLES[cls];
    return style ? `style="${style}"` : match;
  });
}

// --- marked configuration: syntax highlighting + inline styles ---

marked.use(
  markedHighlight({
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return code;
    },
  })
);

marked.use({
  renderer: {
    code({ text }) {
      const highlighted = hljsClassToInlineStyle(text);
      return `<pre style="${STYLES.codeBlock}"><code>${highlighted}</code></pre>\n`;
    },
    blockquote({ tokens }) {
      const body = this.parser.parse(tokens);
      return `<blockquote style="${STYLES.blockquote}">${body}</blockquote>\n`;
    },
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      const style = STYLES[`h${depth}`] || '';
      return style
        ? `<h${depth} style="${style}">${text}</h${depth}>\n`
        : `<h${depth}>${text}</h${depth}>\n`;
    },
    hr() {
      return `<hr style="${STYLES.hr}" />\n`;
    },
    list({ ordered, items }) {
      let body = '';
      for (const item of items) {
        body += this.listitem(item);
      }
      const tag = ordered ? 'ol' : 'ul';
      const style = ordered ? STYLES.ol : STYLES.ul;
      return `<${tag} style="${style}">${body}</${tag}>\n`;
    },
    listitem({ tokens }) {
      const text = this.parser.parse(tokens);
      return `<li style="${STYLES.li}">${text}</li>\n`;
    },
    paragraph({ tokens }) {
      const text = this.parser.parseInline(tokens);
      return `<p style="${STYLES.p}">${text}</p>\n`;
    },
    table({ header, rows }) {
      let html = `<table style="${STYLES.table}">\n<thead>\n`;
      // Header row
      html += '<tr>\n';
      for (const cell of header) {
        const align = cell.align ? ` text-align: ${cell.align};` : '';
        const content = this.parser.parseInline(cell.tokens);
        html += `<th style="${STYLES.th}${align}">${content}</th>\n`;
      }
      html += '</tr>\n</thead>\n<tbody>\n';
      // Body rows
      for (const row of rows) {
        html += '<tr>\n';
        for (const cell of row) {
          const align = cell.align ? ` text-align: ${cell.align};` : '';
          const content = this.parser.parseInline(cell.tokens);
          html += `<td style="${STYLES.td}${align}">${content}</td>\n`;
        }
        html += '</tr>\n';
      }
      html += '</tbody>\n</table>\n';
      return html;
    },
    codespan({ text }) {
      return `<code style="${STYLES.codeInline}">${text}</code>`;
    },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const titleAttr = title ? ` title="${title}"` : '';
      return `<a href="${href}" style="${STYLES.a}"${titleAttr}>${text}</a>`;
    },
    image({ href, title, text }) {
      const titleAttr = title ? ` title="${title}"` : '';
      return `<img src="${href}" alt="${text}" style="${STYLES.img}"${titleAttr} />`;
    },
  },
});

// ---

/** Convert simple Markdown (headings, lists, paragraphs, inline) to HTML. */
function simpleMarkdownToHtml(markdown) {
  if (!markdown) return '';

  const blocks = markdown.split(/\n{2,}/);
  const htmlBlocks = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Headings
    if (trimmed.startsWith('#### ')) {
      htmlBlocks.push(`<h4 style="${STYLES.h4}">${inlineMarkdown(trimmed.slice(5))}</h4>`);
      continue;
    }
    if (trimmed.startsWith('### ')) {
      htmlBlocks.push(`<h3 style="${STYLES.h3}">${inlineMarkdown(trimmed.slice(4))}</h3>`);
      continue;
    }

    // Mixed block: non-list line(s) followed by list items → split
    const lines = trimmed.split('\n');
    const firstListIdx = lines.findIndex(l => /^\s*[-*]\s/.test(l));
    if (firstListIdx > 0) {
      const before = lines.slice(0, firstListIdx).join(' ').trim();
      if (before) {
        htmlBlocks.push(`<p style="${STYLES.p}">${inlineMarkdown(before)}</p>`);
      }
      const listItems = lines.slice(firstListIdx)
        .filter(l => l.trim())
        .map(l => {
          const text = l.replace(/^\s*[-*]\s+/, '');
          return `  <li style="${STYLES.li}">${inlineMarkdown(text)}</li>`;
        });
      htmlBlocks.push(`<ul style="${STYLES.ul}">\n${listItems.join('\n')}\n</ul>`);
      continue;
    }

    // Unordered list
    if (/^[\s]*[-*]\s/.test(trimmed)) {
      const items = trimmed.split('\n')
        .filter(l => l.trim())
        .map(l => {
          const text = l.replace(/^[\s]*[-*]\s+/, '');
          return `  <li style="${STYLES.li}">${inlineMarkdown(text)}</li>`;
        });
      htmlBlocks.push(`<ul style="${STYLES.ul}">\n${items.join('\n')}\n</ul>`);
      continue;
    }

    // Ordered list
    if (/^[\s]*\d+\.\s/.test(trimmed)) {
      const items = trimmed.split('\n')
        .filter(l => l.trim())
        .map(l => {
          const text = l.replace(/^[\s]*\d+\.\s+/, '');
          return `  <li style="${STYLES.li}">${inlineMarkdown(text)}</li>`;
        });
      htmlBlocks.push(`<ol style="${STYLES.ol}">\n${items.join('\n')}\n</ol>`);
      continue;
    }

    // Paragraph
    htmlBlocks.push(`<p style="${STYLES.p}">${inlineMarkdown(trimmed.replace(/\n/g, ' '))}</p>`);
  }

  return htmlBlocks.join('\n');
}

/** Convert a Markdown file to styled HTML suitable for Moodle pages. */
function markdownFileToHtml(filePath) {
  const md = readFileSync(filePath, 'utf-8');
  return marked.parse(md);
}

/** Escape HTML special characters to prevent injection. */
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Convert inline Markdown (bold, code, links, em-dash) to HTML. Input is escaped first. */
function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, `<code style="${STYLES.codeInline}">$1</code>`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, `<a href="$2" style="${STYLES.a}">$1</a>`)
    .replace(/--/g, '\u2013');
}

/** Extract URL from a markdown link field like `[text](url)` or a plain URL. */
function extractUrl(linkField) {
  if (!linkField || linkField === '--') return null;
  const match = linkField.match(/\[([^\]]+)\]\(([^)]+)\)/);
  return match ? match[2] : linkField.startsWith('http') ? linkField : null;
}

// --- GIFT Quiz Helpers ---

/** Parse metadata header from a GIFT file (// key: value comments at top). */
function parseGiftHeader(giftPath) {
  const content = readFileSync(giftPath, 'utf-8');
  const config = {
    name: 'Quiz', timeLimit: 900, seb: true,
    sebUrls: [MOODLE_URL, 'https://login.microsoftonline.com'],
    attempts: 1, shuffle: true, review: 'exam',
  };
  for (const line of content.split('\n')) {
    const match = line.match(/^\/\/\s*(quiz_name|time_limit|seb|seb_urls|attempts|shuffle|review):\s*(.+)$/);
    if (!match) { if (line.trim() && !line.startsWith('//')) break; continue; }
    const [, key, val] = match;
    if (key === 'quiz_name') config.name = val.trim();
    if (key === 'time_limit') config.timeLimit = parseInt(val);
    if (key === 'seb') config.seb = val.trim() === 'true';
    if (key === 'seb_urls') config.sebUrls = val.split(',').map(u => u.trim());
    if (key === 'attempts') config.attempts = parseInt(val);
    if (key === 'shuffle') config.shuffle = val.trim() === 'true';
    if (key === 'review') config.review = val.trim();
  }
  return config;
}

/** Count questions in a GIFT file (lines starting with ::). */
function countGiftQuestions(giftPath) {
  const content = readFileSync(giftPath, 'utf-8');
  return content.split('\n').filter(l => l.startsWith('::')).length;
}

// --- CLI ---

function updateEnvFile(key, value) {
  // Write to CWD .env, or plugin data dir if set
  const envPath = existsSync(resolve(process.cwd(), '.env'))
    ? resolve(process.cwd(), '.env')
    : process.env.PLUGIN_DATA_DIR
      ? resolve(process.env.PLUGIN_DATA_DIR, '.env')
      : resolve(process.cwd(), '.env');
  let content = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content = content.trimEnd() + `\n${key}=${value}\n`;
  }
  writeFileSync(envPath, content, 'utf-8');
}

async function ensureDependencies() {
  const { execSync } = await import('child_process');
  const dataDir = process.env.CLAUDE_PLUGIN_DATA;
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (!dataDir || !pluginRoot) return;

  if (!existsSync(resolve(dataDir, 'node_modules', 'playwright'))) {
    console.log('Dependencies not found — installing automatically (one-time)...\n');
    const srcPkg = resolve(pluginRoot, 'package.json');
    execSync(`cp "${srcPkg}" "${resolve(dataDir, 'package.json')}" && cd "${dataDir}" && npm install --ignore-scripts`, { stdio: 'inherit' });
  }
  // ESM ignores NODE_PATH — symlink node_modules into plugin root so imports resolve
  const link = resolve(pluginRoot, 'node_modules');
  if (!existsSync(link)) {
    const { symlinkSync } = await import('fs');
    symlinkSync(resolve(dataDir, 'node_modules'), link);
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
  await ensurePlaywrightBrowser();
  const browserFlag = args[args.indexOf('--browser') + 1];
  const channel = ['msedge', 'chrome'].includes(browserFlag) ? browserFlag : undefined;
  console.log(`Opening browser for Moodle login (${MOODLE_URL})...${channel ? ` (${channel})` : ''}\n`);
  const { chromium } = await import('playwright');
  const profileDir = resolve(process.cwd(), '.browser-profile');
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    channel,
    args: ['--no-first-run', '--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  const page = context.pages()[0] || await context.newPage();
  await page.goto(`${MOODLE_URL}/login/index.php`);

  console.log('Waiting for login... (browser will close automatically)');

  // Auto-detect: wait until the page navigates away from the login page
  try {
    await page.waitForURL(url => !url.pathname.includes('/login/'), { timeout: 120000 });
  } catch {
    console.error('Error: Login timed out after 2 minutes.');
    await context.close();
    process.exit(1);
  }

  const cookies = await context.cookies(MOODLE_URL);
  const sessionCookie = cookies.find(c => c.name === 'MoodleSession');
  if (!sessionCookie) {
    console.error('Error: MoodleSession cookie not found. Are you logged in?');
    await context.close();
    process.exit(1);
  }

  updateEnvFile('MOODLE_SESSION', sessionCookie.value);
  console.log(`\nMoodleSession saved to .env`);
  await context.close();
}

function showHelp() {
  console.log(`Moodle Updater - Manage Moodle courses via CLI

Setup:
  login                                      Open browser, log in, save cookie automatically
  login --browser msedge                     Use Edge for SSO (also: chrome)
  -- or manually: --
  1. Create .env with MOODLE_URL, COURSE_ID, MOODLE_SESSION
  2. MOODLE_SESSION: Browser > Dev Tools > Application > Cookies > MoodleSession
  3. COURSE_ID: from the course URL (your-moodle.example.com/course/view.php?id=XXXX)

Read:
  structure                                  Show course structure (sections + modules)
  list-activities <sectionId>                List activities in a section
  show-label <moduleId>                      Show label HTML content
  show-page <moduleId>                       Show page HTML content

Update:
  update-label <moduleId> <htmlFile>         Replace label content
  update-page <moduleId> <htmlFile>          Replace page content
  update-summary <sectionId> <htmlFile>      Replace section summary

Create:
  create-url <sectionNum> <name> <url>       Create a URL resource
  create-page <sectionNum> <name> <htmlFile> Create a page from HTML file
  create-resource <sectionNum> <name> <file> Create a file resource (upload)
  create-assign <sectionNum> <name> <html>   Create an assignment
    --open <timestamp>                         Open date (Unix timestamp)
    --due <timestamp>                          Due date (Unix timestamp)
  create-forum <sectionNum> <name> <htmlFile> Create a forum
  create-quiz <sectionNum> <configJson>      Create a quiz from JSON config

Section Operations:
  duplicate-section                          Duplicate the last section
  rename-section <sectionId> <title>         Rename a section
  move-section <sectionId> <targetSectionId> Move section before target
  delete-section <sectionId>                 Delete a section

Activity Operations:
  delete-activity <moduleId>                 Delete an activity
  indent-activity <moduleId>                 Indent an activity
  hide-activity <moduleId>                   Hide an activity
  move-activity <moduleId> <afterModuleId>   Move activity after target

Quiz:
  import-gift <cmid> <giftFile>             Import GIFT questions into a quiz
  delete-quiz-questions <cmid> [category]    Delete questions from a quiz category
  add-questions-to-quiz <cmid> [category]    Assign questions to quiz slots

AI Grading:
  grade-essay <cmid>                         Grade essay questions with AI (dry run)
    --gift <path>                              GIFT file with rubric
    --slot <num>                               Grade only one slot
    --model <name>                             Claude model (default: claude-sonnet-4-6-20250514)
    --report <path>                            Export JSON report
    --regrade                                  Re-grade already graded answers
    --live                                     Write grades to Moodle (otherwise dry run)
  dump-grading <cmid>                        Debug grading page
    --slot <num>                               Detail view for one slot

Diagnostics:
  dump-form <type> <sectionNum>              Show form fields for a module type

Flags:
  --dry-run              Preview only, no changes (default)
  --live                 Apply changes
  --help, -h             Show this help

Examples:
  # Show course structure
  node moodle-updater.js structure

  # Create a URL resource (dry run)
  node moodle-updater.js create-url 5 "Angular Docs" "https://angular.dev"

  # Create a page from HTML file (live)
  node moodle-updater.js create-page 3 "Lesson Plan" plan.html --live

  # Import GIFT questions into quiz
  node moodle-updater.js import-gift 12345 questions.gift

Environment variables (alternative to .env):
  MOODLE_SESSION   Session cookie (required)
  MOODLE_URL       Moodle base URL (required, e.g. https://your-moodle.example.com)
  COURSE_ID        Course ID (required)
  MOODLE_TZ        Timezone for date fields (default: Europe/Zurich)`);
}

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h') || args.length === 0) {
  showHelp();
  process.exit(0);
}

const live = args.includes('--live');

// Filter out --flag and --flag <value> pairs for flags that take values
const valueFlagNames = ['--open', '--due', '--gift', '--slot', '--model', '--report', '--browser'];
const cleanArgs = args.filter((a, i) => {
  if (a.startsWith('--')) return false;
  // Skip values that follow a value-flag
  const prev = args[i - 1];
  if (prev && valueFlagNames.includes(prev)) return false;
  return true;
});
const command = cleanArgs[0];

try {
  switch (command) {
    // --- Login ---
    case 'login':
      await cmdLogin();
      break;

    // --- Read ---
    case 'structure':
      await showStructure();
      break;
    case 'list-activities':
      await listActivities(parseInt(cleanArgs[1]));
      break;
    case 'show-label':
      await showLabel(parseInt(cleanArgs[1]));
      break;
    case 'show-page':
      await showPage(parseInt(cleanArgs[1]));
      break;

    // --- Update ---
    case 'update-label':
      await updateLabel(parseInt(cleanArgs[1]), cleanArgs[2], live);
      break;
    case 'update-page':
      await updatePage(parseInt(cleanArgs[1]), cleanArgs[2], live);
      break;
    case 'update-summary':
      await updateSummary(parseInt(cleanArgs[1]), cleanArgs[2], live);
      break;

    // --- Create ---
    case 'create-url':
      await createUrl(parseInt(cleanArgs[1]), cleanArgs[2], cleanArgs[3], live);
      break;
    case 'create-page':
      if (!cleanArgs[3]) throw new Error('Usage: create-page <sectionNum> <name> <htmlFile>');
      await createPage(parseInt(cleanArgs[1]), cleanArgs[2], readFileSync(resolve(cleanArgs[3]), 'utf-8').trim(), live);
      break;
    case 'create-resource':
      if (!cleanArgs[3]) throw new Error('Usage: create-resource <sectionNum> <name> <filePath>');
      await createResource(parseInt(cleanArgs[1]), cleanArgs[2], resolve(cleanArgs[3]), live);
      break;
    case 'create-assign': {
      if (!cleanArgs[3]) throw new Error('Usage: create-assign <sectionNum> <name> <htmlFile> [--open <timestamp>] [--due <timestamp>]');
      const openIdx = args.indexOf('--open');
      const dueIdx = args.indexOf('--due');
      const dates = {};
      if (openIdx >= 0) dates.open = parseInt(args[openIdx + 1]);
      if (dueIdx >= 0) dates.due = parseInt(args[dueIdx + 1]);
      const introHtml = readFileSync(resolve(cleanArgs[3]), 'utf-8').trim();
      await createAssign(parseInt(cleanArgs[1]), cleanArgs[2], introHtml, live, null, Object.keys(dates).length ? dates : undefined);
      break;
    }
    case 'create-forum': {
      if (!cleanArgs[3]) throw new Error('Usage: create-forum <sectionNum> <name> <htmlFile>');
      const introHtml = readFileSync(resolve(cleanArgs[3]), 'utf-8').trim();
      await createForum(parseInt(cleanArgs[1]), cleanArgs[2], introHtml, live);
      break;
    }
    case 'create-quiz': {
      if (!cleanArgs[2]) throw new Error('Usage: create-quiz <sectionNum> <configJson>');
      const config = JSON.parse(readFileSync(resolve(cleanArgs[2]), 'utf-8'));
      await createQuiz(parseInt(cleanArgs[1]), config, live);
      break;
    }

    // --- Section Operations ---
    case 'duplicate-section':
      await duplicateSection(live);
      break;
    case 'rename-section':
      await renameSection(parseInt(cleanArgs[1]), cleanArgs.slice(2).join(' '), live);
      break;
    case 'move-section':
      if (!cleanArgs[1] || !cleanArgs[2]) throw new Error('Usage: move-section <sectionId> <targetSectionId>');
      console.log(`Move section ${cleanArgs[1]} before section ${cleanArgs[2]} ${live ? '(LIVE)' : '(DRY RUN)'}`);
      if (live) {
        await courseFormatAction('section_move', [parseInt(cleanArgs[1])], { targetsectionid: parseInt(cleanArgs[2]) });
        invalidateCache();
        console.log('Section moved.');
      } else {
        console.log('DRY RUN - no changes. Use --live to apply.');
      }
      break;
    case 'delete-section':
      if (!cleanArgs[1]) throw new Error('Usage: delete-section <sectionId>');
      console.log(`Delete section ${cleanArgs[1]} ${live ? '(LIVE)' : '(DRY RUN)'}`);
      if (live) {
        await courseFormatAction('section_delete', [parseInt(cleanArgs[1])]);
        console.log('Section deleted.');
      } else {
        console.log('DRY RUN - no changes. Use --live to apply.');
      }
      break;

    // --- Activity Operations ---
    case 'delete-activity':
      await deleteActivity(parseInt(cleanArgs[1]), live);
      break;
    case 'indent-activity':
      await indentActivity(parseInt(cleanArgs[1]), live);
      break;
    case 'hide-activity':
      await hideActivity(parseInt(cleanArgs[1]), live);
      break;
    case 'move-activity':
      await moveActivity(parseInt(cleanArgs[1]), parseInt(cleanArgs[2]), live);
      break;

    // --- Quiz ---
    case 'import-gift': {
      if (!cleanArgs[2]) throw new Error('Usage: import-gift <cmid> <giftFile>');
      await importGiftQuestions(resolve(cleanArgs[2]), parseInt(cleanArgs[1]));
      break;
    }
    case 'delete-quiz-questions': {
      if (!cleanArgs[1]) throw new Error('Usage: delete-quiz-questions <cmid> [categoryName]');
      await deleteQuizCategoryQuestions(parseInt(cleanArgs[1]), cleanArgs[2] || null);
      break;
    }
    case 'add-questions-to-quiz':
      if (!cleanArgs[1]) throw new Error('Usage: add-questions-to-quiz <cmid> [categoryName]');
      await addQuestionsToQuiz(parseInt(cleanArgs[1]), cleanArgs[2]);
      break;

    // --- Diagnostics ---
    case 'dump-form': {
      if (!cleanArgs[1] || !cleanArgs[2]) throw new Error('Usage: dump-form <type> <sectionNum>');
      const { form } = await fetchAddForm(cleanArgs[1], parseInt(cleanArgs[2]));
      const fd = getFormData(form);
      console.log(`\nForm fields for "${cleanArgs[1]}" (section ${cleanArgs[2]}):\n`);
      for (const [key, value] of fd.entries()) {
        const display = value.length > 80 ? value.substring(0, 80) + '...' : value;
        console.log(`  ${key} = ${display}`);
      }
      break;
    }

    // --- AI Grading ---
    case 'grade-essay': {
      if (!cleanArgs[1]) throw new Error('Usage: grade-essay <cmid> [--gift <path>] [--slot <num>] [--model <name>] [--report <path>] [--regrade] [--live]');
      const { cmdGradeEssay } = await import('./grade-essay.js');
      const gradeParams = {
        cmid: parseInt(cleanArgs[1]),
        giftPath: args.includes('--gift') ? args[args.indexOf('--gift') + 1] : null,
        slot: args.includes('--slot') ? parseInt(args[args.indexOf('--slot') + 1]) : null,
        model: args.includes('--model') ? args[args.indexOf('--model') + 1] : null,
        reportPath: args.includes('--report') ? args[args.indexOf('--report') + 1] : null,
        regrade: args.includes('--regrade'),
        live,
      };
      const moodleHelpers = { moodleFetch, getSesskey, getCourseState, MOODLE_URL };
      await cmdGradeEssay(gradeParams, moodleHelpers);
      break;
    }

    case 'dump-grading': {
      if (!cleanArgs[1]) throw new Error('Usage: dump-grading <cmid> [--slot <num>]');
      const { dumpGradingPage } = await import('./grade-essay.js');
      const dumpSlot = args.includes('--slot') ? parseInt(args[args.indexOf('--slot') + 1]) : null;
      const moodleHelpers = { moodleFetch, getSesskey, getCourseState, MOODLE_URL };
      await dumpGradingPage(parseInt(cleanArgs[1]), moodleHelpers, { slot: dumpSlot });
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Show help: node moodle-updater.js --help');
      process.exit(1);
  }
} catch (err) {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
}
