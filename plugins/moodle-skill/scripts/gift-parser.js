/**
 * gift-parser.js
 *
 * Parst GIFT-Dateien und extrahiert Freitext-Fragen (FT-XX) mit:
 * - Fragentext, Musterloesung, Bewertungskriterien, Alternativen, haeufige Fehler
 * - Rubric-Normalisierung: Jedes Kriterium wird auf 1 Pt. normalisiert
 */

import { readFileSync } from 'fs';

/**
 * Decode GIFT escape sequences: \= → =, \{ → {, \} → }, \: → :, \~ → ~, \# → #
 */
function decodeGiftEscapes(text) {
  return text
    .replace(/\\=/g, '=')
    .replace(/\\\{/g, '{')
    .replace(/\\\}/g, '}')
    .replace(/\\:/g, ':')
    .replace(/\\~/g, '~')
    .replace(/\\#/g, '#');
}

/**
 * Convert simple HTML to plaintext (strip tags, decode entities).
 */
function htmlToPlaintext(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h\d>/gi, '\n')
    .replace(/<li>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extract content between <pre><code> tags, preserving code formatting.
 */
function extractCodeBlocks(html) {
  const blocks = [];
  const regex = /<pre><code>([\s\S]*?)<\/code><\/pre>/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    blocks.push(decodeGiftEscapes(htmlToPlaintext(match[1])));
  }
  return blocks;
}

/**
 * Extract list items from HTML <ul>/<ol> lists.
 */
function extractListItems(html) {
  const items = [];
  const regex = /<li>([\s\S]*?)<\/li>/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    items.push(decodeGiftEscapes(htmlToPlaintext(match[1])).trim());
  }
  return items;
}

/**
 * Parse a single GIFT essay question and extract structured data.
 * Essay questions in GIFT format: ::Title::[html]<question>{####<feedback>}
 */
function parseEssayQuestion(title, questionHtml, feedbackHtml) {
  // Extract ID (e.g. "FT-13") from title
  const idMatch = title.match(/^(FT-\d+)/);
  const id = idMatch ? idMatch[1] : title;

  // Extract max score from question text "(X Punkte)"
  const scoreMatch = questionHtml.match(/\((\d+)\s*Punkte?\)/);
  const maxScore = scoreMatch ? parseInt(scoreMatch[1]) : 0;

  // Clean question text (remove score indicator for display)
  const questionText = decodeGiftEscapes(htmlToPlaintext(questionHtml));

  // Parse feedback HTML into sections
  const sections = parseFeedbackSections(feedbackHtml);

  // Extract and normalize criteria
  const rawCriteria = sections.criteria;
  const criteria = normalizeCriteria(rawCriteria, maxScore);

  return {
    id,
    title: decodeGiftEscapes(title),
    questionHtml: decodeGiftEscapes(questionHtml),
    questionText,
    maxScore,
    modelAnswer: sections.modelAnswer,
    criteria,
    alternatives: sections.alternatives,
    commonErrors: sections.commonErrors,
    notAccepted: sections.notAccepted,
  };
}

/**
 * Parse the feedback section (####...) into structured parts.
 */
function parseFeedbackSections(feedbackHtml) {
  const decoded = decodeGiftEscapes(feedbackHtml);

  // Extract model answer from code blocks
  const codeBlocks = extractCodeBlocks(decoded);
  const modelAnswer = codeBlocks.join('\n\n');

  // Extract criteria from "Bewertung:" section
  const criteria = [];
  const bewertungMatch = decoded.match(/<p><strong>Bewertung[^<]*<\/strong><\/p>\s*<ul>([\s\S]*?)<\/ul>/);
  if (bewertungMatch) {
    const items = extractListItems(bewertungMatch[1]);
    for (const item of items) {
      const ptMatch = item.match(/\((\d+(?:\.\d+)?)\s*Pt?\.\)/);
      criteria.push({
        description: item.replace(/\(\d+(?:\.\d+)?\s*Pt?\.\)/, '').trim(),
        points: ptMatch ? parseFloat(ptMatch[1]) : 1,
      });
    }
  }

  // Extract alternatives from "Auch akzeptiert:" section
  const alternatives = [];
  const altMatch = decoded.match(/<p><strong>Auch akzeptiert[^<]*<\/strong><\/p>\s*<ul>([\s\S]*?)<\/ul>/);
  if (altMatch) {
    alternatives.push(...extractListItems(altMatch[1]));
  }

  // Extract common errors from "Häufige Fehler:" section
  const commonErrors = [];
  const errMatch = decoded.match(/<p><strong>Häufige Fehler[^<]*<\/strong><\/p>\s*<ul>([\s\S]*?)<\/ul>/);
  if (errMatch) {
    commonErrors.push(...extractListItems(errMatch[1]));
  }

  // Extract "Nicht akzeptiert:" section
  const notAccepted = [];
  const naMatch = decoded.match(/<p><strong>Nicht akzeptiert[^<]*<\/strong><\/p>\s*<ul>([\s\S]*?)<\/ul>/);
  if (naMatch) {
    notAccepted.push(...extractListItems(naMatch[1]));
  }

  return { modelAnswer, criteria, alternatives, commonErrors, notAccepted };
}

/**
 * Normalize criteria so each criterion is worth exactly 1 point.
 * A 4-point question with criteria (1.5 + 1 + 0.5 + 2) becomes
 * 5 criteria × 1 Pt. each (split large criteria, merge small ones).
 *
 * Simplified approach: keep original criteria descriptions but normalize
 * points to 1 each, adjusting count to match maxScore.
 */
function normalizeCriteria(rawCriteria, maxScore) {
  if (rawCriteria.length === 0 || maxScore === 0) return rawCriteria;

  // If criteria already sum to maxScore with integer points, check if normalization needed
  const totalPts = rawCriteria.reduce((sum, c) => sum + c.points, 0);

  // Simple case: total matches maxScore and all criteria are 1 pt
  if (Math.abs(totalPts - maxScore) < 0.01 && rawCriteria.every(c => c.points === 1)) {
    return rawCriteria;
  }

  // Expand: split criteria with >1 pt into multiple 1-pt criteria
  const normalized = [];
  for (const c of rawCriteria) {
    const pts = Math.round(c.points);
    if (pts <= 1) {
      normalized.push({ description: c.description, points: 1 });
    } else {
      // Split into pts separate criteria
      for (let i = 0; i < pts; i++) {
        normalized.push({
          description: pts > 1 ? `${c.description} (Teil ${i + 1}/${pts})` : c.description,
          points: 1,
        });
      }
    }
  }

  // If we have more criteria than maxScore, merge extras into last one
  while (normalized.length > maxScore) {
    const last = normalized.pop();
    normalized[normalized.length - 1].description += '; ' + last.description;
  }

  // If fewer criteria than maxScore, that's OK (partial points possible)
  return normalized;
}

/**
 * Parse a GIFT file and extract all essay/freitext questions (FT-XX).
 *
 * GIFT essay format:
 * ::Title::[html]<question>{####<feedback>}
 *
 * @param {string} giftPath - Path to the GIFT file
 * @returns {{ quizName: string, questions: Array }} Parsed FT questions
 */
export function parseGiftEssayQuestions(giftPath) {
  const content = readFileSync(giftPath, 'utf-8');

  // Extract quiz name from header
  const nameMatch = content.match(/^\/\/\s*quiz_name:\s*(.+)$/m);
  const quizName = nameMatch ? nameMatch[1].trim() : 'Unknown Quiz';

  const questions = [];

  // Match essay questions: lines starting with ::FT-
  // Essay questions use {####...} feedback (no answer choices)
  // We need to find the full question block including the feedback
  const lines = content.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Look for essay question start: ::FT-XX Title::[html]
    const titleMatch = line.match(/^::(FT-\d+\s+[^:]+)::\[html\](.*)/);
    if (!titleMatch) {
      i++;
      continue;
    }

    const title = titleMatch[1].trim();

    // Collect the full question content (may span multiple lines)
    // Find the {####...} block
    let fullContent = titleMatch[2];
    i++;

    // Continue reading lines until we find the closing }
    // Count braces to handle nested braces in code examples
    while (i < lines.length) {
      fullContent += '\n' + lines[i];
      i++;

      // Check if we've closed the feedback block
      // Simple heuristic: the closing } is on its own line or at the end
      if (fullContent.includes('{####') && fullContent.match(/\}$/)) {
        // Verify brace balance within the {####...} block
        const feedbackStart = fullContent.indexOf('{####');
        const afterFeedback = fullContent.slice(feedbackStart);
        let depth = 0;
        let closed = false;
        for (let j = 0; j < afterFeedback.length; j++) {
          const ch = afterFeedback[j];
          if (ch === '\\') { j++; continue; } // skip escaped chars
          if (ch === '{') depth++;
          if (ch === '}') { depth--; if (depth === 0) { closed = true; break; } }
        }
        if (closed) break;
      }
    }

    // Split into question and feedback
    const feedbackStart = fullContent.indexOf('{####');
    if (feedbackStart === -1) continue; // No feedback, skip

    const questionHtml = fullContent.slice(0, feedbackStart).trim();

    // Extract feedback content (between {#### and closing })
    const feedbackRaw = fullContent.slice(feedbackStart);
    let depth = 0;
    let feedbackEnd = feedbackRaw.length;
    for (let j = 0; j < feedbackRaw.length; j++) {
      const ch = feedbackRaw[j];
      if (ch === '\\') { j++; continue; }
      if (ch === '{') depth++;
      if (ch === '}') { depth--; if (depth === 0) { feedbackEnd = j; break; } }
    }
    const feedbackHtml = feedbackRaw.slice(5, feedbackEnd); // skip "{####"

    const question = parseEssayQuestion(title, questionHtml, feedbackHtml);
    questions.push(question);
  }

  return { quizName, questions };
}

/**
 * Format parsed question data for display/debugging.
 */
export function formatQuestionSummary(question) {
  const lines = [
    `${question.id}: ${question.title} (${question.maxScore} Pt.)`,
    `  Kriterien: ${question.criteria.length}`,
  ];
  for (const c of question.criteria) {
    lines.push(`    - ${c.description} (${c.points} Pt.)`);
  }
  if (question.alternatives.length > 0) {
    lines.push(`  Alternativen: ${question.alternatives.length}`);
  }
  if (question.commonErrors.length > 0) {
    lines.push(`  Haeufige Fehler: ${question.commonErrors.length}`);
  }
  return lines.join('\n');
}
