import { parseFile } from './parsers.js';
import { tokenize, orpIndex } from './tokenizer.js';
import { RsvpReader, READER_LIMITS } from './reader.js';
import {
  listDocs,
  saveDoc,
  getDocText,
  getDocMeta,
  deleteDoc,
  saveProgress,
  loadProgress,
} from './storage.js';

const els = {
  libraryView: document.getElementById('library-view'),
  readerView: document.getElementById('reader-view'),
  dropZone: document.getElementById('drop-zone'),
  fileInput: document.getElementById('file-input'),
  docList: document.getElementById('doc-list'),
  status: document.getElementById('status'),
  wordLeft: document.getElementById('word-left'),
  wordOrp: document.getElementById('word-orp'),
  wordRight: document.getElementById('word-right'),
  wordTap: document.getElementById('word-tap'),
  progressFill: document.getElementById('progress-fill'),
  positionLabel: document.getElementById('position-label'),
  etaLabel: document.getElementById('eta-label'),
  playPause: document.getElementById('btn-play'),
  back: document.getElementById('btn-back'),
  forward: document.getElementById('btn-forward'),
  slower: document.getElementById('btn-slower'),
  faster: document.getElementById('btn-faster'),
  wpmLabel: document.getElementById('wpm-label'),
  wpmSlider: document.getElementById('wpm-slider'),
  exit: document.getElementById('btn-exit'),
  titleLabel: document.getElementById('reader-title'),
};

let reader = null;
let activeDocId = null;
let saveTimer = null;

function showLibrary() {
  els.readerView.hidden = true;
  els.libraryView.hidden = false;
  renderLibrary();
}

function showReader() {
  els.libraryView.hidden = true;
  els.readerView.hidden = false;
}

function renderLibrary() {
  const docs = listDocs();
  els.docList.innerHTML = '';
  if (docs.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No documents yet. Drop a file above to get started.';
    els.docList.appendChild(empty);
    return;
  }
  for (const doc of docs) {
    const prog = loadProgress(doc.id);
    const pct = prog && prog.totalWords
      ? Math.min(100, Math.round((prog.wordIndex / prog.totalWords) * 100))
      : 0;
    const row = document.createElement('div');
    row.className = 'doc-row';
    row.innerHTML = `
      <button class="doc-open" type="button">
        <span class="doc-title"></span>
        <span class="doc-meta">
          <span class="doc-type"></span>
          <span class="doc-progress"></span>
        </span>
        <span class="doc-bar"><span class="doc-bar-fill"></span></span>
      </button>
      <button class="doc-delete" type="button" aria-label="Delete document">×</button>
    `;
    row.querySelector('.doc-title').textContent = doc.title;
    row.querySelector('.doc-type').textContent = doc.type.toUpperCase();
    row.querySelector('.doc-progress').textContent =
      prog ? `${pct}% · ${prog.wpm} wpm` : 'Not started';
    row.querySelector('.doc-bar-fill').style.width = `${pct}%`;
    row.querySelector('.doc-open').addEventListener('click', () => openDoc(doc.id));
    row.querySelector('.doc-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Delete "${doc.title}"?`)) {
        deleteDoc(doc.id);
        renderLibrary();
      }
    });
    els.docList.appendChild(row);
  }
}

async function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) return;
  for (const file of files) {
    setStatus(`Parsing ${file.name}…`);
    try {
      const parsed = await parseFile(file, (p) => {
        setStatus(`Parsing ${file.name}… ${Math.round(p * 100)}%`);
      });
      if (!parsed.text || !parsed.text.trim()) {
        throw new Error('No readable text found in file.');
      }
      const meta = saveDoc(parsed);
      setStatus(`Added "${meta.title}".`);
    } catch (err) {
      console.error(err);
      setStatus(`Failed: ${err.message}`);
    }
  }
  renderLibrary();
}

function setStatus(msg) {
  els.status.textContent = msg;
  if (msg) {
    clearTimeout(setStatus._t);
    setStatus._t = setTimeout(() => (els.status.textContent = ''), 4000);
  }
}

function openDoc(id) {
  const meta = getDocMeta(id);
  const text = getDocText(id);
  if (!meta || !text) {
    setStatus('Document missing — it may have been cleared.');
    return;
  }
  const tokens = tokenize(text);
  if (tokens.length === 0) {
    setStatus('No words to read in this document.');
    return;
  }
  const prog = loadProgress(id);
  activeDocId = id;
  if (reader) reader.destroy();
  reader = new RsvpReader(tokens, {
    wpm: prog?.wpm || 300,
    startIndex: clamp(prog?.wordIndex || 0, 0, tokens.length - 1),
    onChange: renderReader,
  });
  els.titleLabel.textContent = meta.title;
  els.wpmSlider.min = READER_LIMITS.MIN_WPM;
  els.wpmSlider.max = READER_LIMITS.MAX_WPM;
  els.wpmSlider.step = READER_LIMITS.WPM_STEP;
  els.wpmSlider.value = reader.wpm;
  showReader();
  reader.emit();
}

function renderReader(state) {
  const { word, orp, index, total, wpm, playing } = state;
  els.wordLeft.textContent = word.slice(0, orp);
  els.wordOrp.textContent = word.charAt(orp) || '';
  els.wordRight.textContent = word.slice(orp + 1);
  els.positionLabel.textContent = `${index + 1} / ${total}`;
  els.progressFill.style.width = total > 0 ? `${((index + 1) / total) * 100}%` : '0%';
  els.wpmLabel.textContent = `${wpm} wpm`;
  if (Number(els.wpmSlider.value) !== wpm) els.wpmSlider.value = wpm;
  els.playPause.textContent = playing ? '⏸' : '▶';
  els.playPause.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  const wordsLeft = Math.max(0, total - (index + 1));
  els.etaLabel.textContent = formatEta(wordsLeft / wpm);
  scheduleSave();
}

function formatEta(minutes) {
  if (!isFinite(minutes) || minutes <= 0) return '0:00';
  const totalSec = Math.round(minutes * 60);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function scheduleSave() {
  if (!reader || !activeDocId) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveProgress(activeDocId, {
      wordIndex: reader.index,
      wpm: reader.wpm,
      totalWords: reader.tokens.length,
    });
  }, 1500);
}

function exitReader() {
  if (reader && activeDocId) {
    saveProgress(activeDocId, {
      wordIndex: reader.index,
      wpm: reader.wpm,
      totalWords: reader.tokens.length,
    });
    reader.destroy();
  }
  reader = null;
  activeDocId = null;
  showLibrary();
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// ---- Wire up DOM ----

els.dropZone.addEventListener('click', () => els.fileInput.click());
els.dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    els.fileInput.click();
  }
});
els.fileInput.addEventListener('change', (e) => {
  handleFiles(e.target.files);
  e.target.value = '';
});

['dragenter', 'dragover'].forEach((evt) =>
  els.dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    els.dropZone.classList.add('drag-active');
  })
);
['dragleave', 'drop'].forEach((evt) =>
  els.dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    els.dropZone.classList.remove('drag-active');
  })
);
els.dropZone.addEventListener('drop', (e) => handleFiles(e.dataTransfer?.files));

els.playPause.addEventListener('click', () => reader?.toggle());
els.back.addEventListener('click', () => reader?.stepSentence(-1));
els.forward.addEventListener('click', () => reader?.stepSentence(1));
els.slower.addEventListener('click', () => reader?.bumpWpm(-1));
els.faster.addEventListener('click', () => reader?.bumpWpm(1));
els.wpmSlider.addEventListener('input', (e) => reader?.setWpm(Number(e.target.value)));
els.exit.addEventListener('click', exitReader);
els.wordTap.addEventListener('click', () => reader?.toggle());

document.addEventListener('keydown', (e) => {
  if (els.readerView.hidden) return;
  if (e.target.tagName === 'INPUT') return;
  switch (e.key) {
    case ' ':
      e.preventDefault();
      reader?.toggle();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      e.shiftKey ? reader?.stepSentence(-1) : reader?.stepWord(-1);
      break;
    case 'ArrowRight':
      e.preventDefault();
      e.shiftKey ? reader?.stepSentence(1) : reader?.stepWord(1);
      break;
    case 'ArrowUp':
      e.preventDefault();
      reader?.bumpWpm(1);
      break;
    case 'ArrowDown':
      e.preventDefault();
      reader?.bumpWpm(-1);
      break;
    case 'Escape':
      e.preventDefault();
      exitReader();
      break;
  }
});

window.addEventListener('beforeunload', () => {
  if (reader && activeDocId) {
    saveProgress(activeDocId, {
      wordIndex: reader.index,
      wpm: reader.wpm,
      totalWords: reader.tokens.length,
    });
  }
});

showLibrary();
