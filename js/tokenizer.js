// Turn raw document text into a flat list of reader tokens.
// Each token = { word, delayMul } where delayMul scales the per-word duration.

const MAX_WORD_LEN = 13;
const SPLIT_CHUNK = 8;

function splitLongWord(word) {
  if (word.length <= MAX_WORD_LEN) return [word];

  // Prefer hyphen boundary if present.
  if (word.includes('-')) {
    const parts = word.split('-');
    const out = [];
    for (let i = 0; i < parts.length; i++) {
      const piece = i < parts.length - 1 ? parts[i] + '-' : parts[i];
      out.push(...splitLongWord(piece));
    }
    return out;
  }

  // Otherwise hard-split every SPLIT_CHUNK chars with a trailing hyphen.
  const chunks = [];
  for (let i = 0; i < word.length; i += SPLIT_CHUNK) {
    const piece = word.slice(i, i + SPLIT_CHUNK);
    const isLast = i + SPLIT_CHUNK >= word.length;
    chunks.push(isLast ? piece : piece + '-');
  }
  return chunks;
}

function delayFor(word) {
  const last = word.slice(-1);
  if ('.!?'.includes(last)) return 1.6;
  if (',;:'.includes(last)) return 1.3;
  if (word.endsWith('-')) return 0.9; // mid-word continuation reads slightly faster
  return 1.0;
}

export function tokenize(text) {
  if (!text) return [];

  // Normalize whitespace; keep paragraph breaks as sentence-strong boundaries.
  const cleaned = text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();

  const rawWords = cleaned.split(/\s+/);
  const tokens = [];
  for (const w of rawWords) {
    if (!w) continue;
    const pieces = splitLongWord(w);
    for (const p of pieces) {
      tokens.push({ word: p, delayMul: delayFor(p) });
    }
  }
  return tokens;
}

// ORP (Optimal Recognition Point) index using a Spritz-like table.
export function orpIndex(word) {
  const len = word.length;
  if (len <= 1) return 0;
  if (len <= 4) return 1;
  if (len <= 9) return 2;
  if (len <= 13) return 3;
  return 4;
}

// Find the nearest sentence boundary going back/forward from `idx`.
export function findSentenceBoundary(tokens, idx, direction) {
  const step = direction < 0 ? -1 : 1;
  let i = idx + step;
  while (i > 0 && i < tokens.length - 1) {
    const last = tokens[i].word.slice(-1);
    if ('.!?'.includes(last)) return Math.min(tokens.length - 1, i + 1);
    i += step;
  }
  return Math.max(0, Math.min(tokens.length - 1, i));
}
