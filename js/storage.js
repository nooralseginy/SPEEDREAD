// localStorage-backed document library and reading progress.

const INDEX_KEY = 'speedread.docs';
const DOC_PREFIX = 'speedread.doc.';
const PROGRESS_PREFIX = 'speedread.progress.';
const MAX_DOC_CHARS = 4_000_000; // ~4 MB headroom under the typical 5 MB origin cap

function loadIndex() {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveIndex(list) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(list));
}

export function listDocs() {
  return loadIndex().sort((a, b) => b.addedAt - a.addedAt);
}

export function saveDoc({ title, type, text }) {
  if (text.length > MAX_DOC_CHARS) {
    throw new Error(
      `Document too large for browser storage (${(text.length / 1_000_000).toFixed(1)} MB, limit ~4 MB).`
    );
  }
  const id = crypto.randomUUID();
  const meta = { id, title, type, addedAt: Date.now(), length: text.length };
  const index = loadIndex();
  index.push(meta);
  saveIndex(index);
  localStorage.setItem(DOC_PREFIX + id, text);
  return meta;
}

export function getDocText(id) {
  return localStorage.getItem(DOC_PREFIX + id);
}

export function getDocMeta(id) {
  return loadIndex().find((d) => d.id === id) || null;
}

export function deleteDoc(id) {
  const index = loadIndex().filter((d) => d.id !== id);
  saveIndex(index);
  localStorage.removeItem(DOC_PREFIX + id);
  localStorage.removeItem(PROGRESS_PREFIX + id);
}

export function saveProgress(id, { wordIndex, wpm, totalWords }) {
  localStorage.setItem(
    PROGRESS_PREFIX + id,
    JSON.stringify({ wordIndex, wpm, totalWords, updatedAt: Date.now() })
  );
}

export function loadProgress(id) {
  try {
    const raw = localStorage.getItem(PROGRESS_PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
