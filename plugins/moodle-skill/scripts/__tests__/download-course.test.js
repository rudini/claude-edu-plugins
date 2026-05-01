// Unit tests for pure helpers in download-course.js.
// Run with: node --test plugins/moodle-skill/scripts/__tests__/download-course.test.js
//
// download-course.js validates env vars at import time, so we have to set
// dummy values before importing.
process.env.MOODLE_URL = 'https://example.invalid';
process.env.COURSE_ID = '1';
process.env.MOODLE_SESSION = 'dummy';

import { test } from 'node:test';
import assert from 'node:assert/strict';

const mod = await import('../download-course.js');
const {
  parseEnvFile,
  slugify,
  pad,
  safeName,
  safeDecodeURIComponent,
  htmlToMd,
  pMapLimit,
  parseQuizConfig,
} = mod;

// --- parseEnvFile ---
test('parseEnvFile: basic key=value', () => {
  const v = parseEnvFile('FOO=bar\nBAZ=qux');
  assert.deepEqual(v, { FOO: 'bar', BAZ: 'qux' });
});

test('parseEnvFile: strips double quotes', () => {
  const v = parseEnvFile('URL="https://example.com"');
  assert.equal(v.URL, 'https://example.com');
});

test('parseEnvFile: strips single quotes', () => {
  const v = parseEnvFile("TOKEN='abc=def'");
  assert.equal(v.TOKEN, 'abc=def');
});

test('parseEnvFile: preserves = in value', () => {
  const v = parseEnvFile('SECRET=a=b=c');
  assert.equal(v.SECRET, 'a=b=c');
});

test('parseEnvFile: ignores comments and blank lines', () => {
  const v = parseEnvFile('# comment\n\nFOO=1\n# another');
  assert.deepEqual(v, { FOO: '1' });
});

test('parseEnvFile: accepts lowercase and mixed-case keys', () => {
  const v = parseEnvFile('foo=1\nMyVar=2');
  assert.equal(v.foo, '1');
  assert.equal(v.MyVar, '2');
});

test('parseEnvFile: ignores malformed lines', () => {
  const v = parseEnvFile('NO_EQUALS_LINE\n=novalue\nGOOD=ok');
  assert.deepEqual(v, { GOOD: 'ok' });
});

// --- slugify ---
test('slugify: basic ASCII', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
});

test('slugify: German umlauts', () => {
  assert.equal(slugify('Übungen für Anfänger'), 'uebungen-fuer-anfaenger');
  assert.equal(slugify('Größe'), 'groesse');
});

test('slugify: collapses non-alphanumerics', () => {
  assert.equal(slugify('Foo!!!  ___ bar??'), 'foo-bar');
});

test('slugify: trims dashes', () => {
  assert.equal(slugify('---hello---'), 'hello');
});

test('slugify: empty/null input', () => {
  assert.equal(slugify(''), 'untitled');
  assert.equal(slugify(null), 'untitled');
  assert.equal(slugify(undefined), 'untitled');
});

test('slugify: max length 60', () => {
  const long = 'a'.repeat(100);
  assert.equal(slugify(long).length, 60);
});

// --- pad ---
test('pad: zero-pad', () => {
  assert.equal(pad(1, 2), '01');
  assert.equal(pad(42, 4), '0042');
  assert.equal(pad(123, 2), '123');
});

// --- safeName ---
test('safeName: keeps simple ASCII', () => {
  assert.equal(safeName('Foo_Bar.pdf'), 'foo-bar.pdf');
});

test('safeName: handles umlauts deterministically', () => {
  assert.equal(safeName('Müller.pdf'), 'mueller.pdf');
});

test('safeName: extension preserved', () => {
  assert.equal(safeName('Übung 1.PDF'), 'uebung-1.PDF');
});

test('safeName: no extension', () => {
  assert.equal(safeName('README'), 'readme');
});

test('safeName: empty falls back to id', () => {
  assert.equal(safeName('', 42), 'file-42');
  assert.equal(safeName(''), 'file');
});

test('safeName: pure-symbol stem falls back to file-id', () => {
  assert.equal(safeName('???.pdf', 7), 'file-7.pdf');
});

// --- safeDecodeURIComponent ---
test('safeDecodeURIComponent: valid', () => {
  assert.equal(safeDecodeURIComponent('Hallo%20Welt'), 'Hallo Welt');
});

test('safeDecodeURIComponent: invalid returns input', () => {
  // %ZZ is not valid percent-encoding
  assert.equal(safeDecodeURIComponent('bad%ZZ'), 'bad%ZZ');
});

// --- htmlToMd ---
test('htmlToMd: empty returns empty', () => {
  assert.equal(htmlToMd(''), '');
  assert.equal(htmlToMd(null), '');
});

test('htmlToMd: basic conversion', () => {
  assert.equal(htmlToMd('<p>Hello <strong>world</strong></p>'), 'Hello **world**');
});

test('htmlToMd: fenced code with language', () => {
  const md = htmlToMd('<pre><code class="language-js">const x = 1;</code></pre>');
  assert.match(md, /```js/);
  assert.match(md, /const x = 1;/);
});

// --- pMapLimit ---
test('pMapLimit: processes all items', async () => {
  const result = await pMapLimit([1, 2, 3, 4, 5], 2, async (n) => n * 2);
  assert.deepEqual(result, [2, 4, 6, 8, 10]);
});

test('pMapLimit: respects concurrency', async () => {
  let active = 0;
  let maxActive = 0;
  await pMapLimit([1, 2, 3, 4, 5, 6], 2, async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise(r => setTimeout(r, 10));
    active--;
  });
  assert.ok(maxActive <= 2, `expected <=2 concurrent, got ${maxActive}`);
});

test('pMapLimit: empty input', async () => {
  const result = await pMapLimit([], 4, async (n) => n);
  assert.deepEqual(result, []);
});

// --- parseQuizConfig ---
test('parseQuizConfig: parses German attempts and time limit (Minuten)', () => {
  const html = `<html><body><div class="box quizinfo">
    Versuche: 3
    Zeitbegrenzung: 45 Minuten
  </div></body></html>`;
  const cfg = parseQuizConfig(html, 'Test', 'https://m.example');
  assert.equal(cfg.attempts, 3);
  assert.equal(cfg.timeLimit, 45 * 60);
  assert.equal(cfg.seb, false);
});

test('parseQuizConfig: parses Stunden as hours', () => {
  const html = `<div class="box quizinfo">Zeitbegrenzung: 2 Stunden</div>`;
  const cfg = parseQuizConfig(html, 'T', 'https://m');
  assert.equal(cfg.timeLimit, 2 * 3600);
});

test('parseQuizConfig: parses English locale', () => {
  const html = `<div class="box quizinfo">
    Attempts allowed: 5
    Time limit: 30 minutes
  </div>`;
  const cfg = parseQuizConfig(html, 'T', 'https://m');
  assert.equal(cfg.attempts, 5);
  assert.equal(cfg.timeLimit, 30 * 60);
});

test('parseQuizConfig: defaults are null when nothing matched', () => {
  const cfg = parseQuizConfig('<html><body></body></html>', 'T', 'https://m');
  assert.equal(cfg.attempts, null);
  assert.equal(cfg.timeLimit, null);
  assert.ok(cfg._todo.includes('attempts'));
  assert.ok(cfg._todo.includes('timeLimit'));
});

test('parseQuizConfig: detects SEB', () => {
  const html = `<div class="box quizinfo">Safe Exam Browser</div>`;
  const cfg = parseQuizConfig(html, 'T', 'https://m.example');
  assert.equal(cfg.seb, true);
  assert.deepEqual(cfg.sebUrls, ['https://m.example', 'https://login.microsoftonline.com']);
});
