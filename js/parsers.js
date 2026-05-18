// File parsers that turn an uploaded File into { title, type, text }.
// PDF and EPUB libraries are loaded lazily from a CDN on first use.

const PDFJS_VERSION = '4.7.76';
const PDFJS_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`;
const PDFJS_WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;
const EPUBJS_URL = 'https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js';
const JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';

const titleFromFilename = (name) => name.replace(/\.[^.]+$/, '');

export async function parseTxt(file) {
  const text = await file.text();
  return { title: titleFromFilename(file.name), type: 'txt', text };
}

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(/* @vite-ignore */ PDFJS_URL).then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return mod;
    });
  }
  return pdfjsPromise;
}

export async function parsePdf(file, onProgress) {
  const pdfjs = await loadPdfjs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;

  const chunks = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    let lastY = null;
    let line = '';
    const lines = [];
    for (const item of content.items) {
      const y = item.transform?.[5];
      if (lastY !== null && y !== lastY) {
        lines.push(line.trim());
        line = '';
      }
      line += item.str + (item.hasEOL ? '\n' : ' ');
      lastY = y;
    }
    if (line.trim()) lines.push(line.trim());
    chunks.push(lines.join('\n'));
    if (onProgress) onProgress(p / pdf.numPages);
  }

  return {
    title: titleFromFilename(file.name),
    type: 'pdf',
    text: chunks.join('\n\n'),
  };
}

function loadScript(url) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-src="${url}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = url;
    s.dataset.src = url;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${url}`));
    document.head.appendChild(s);
  });
}

let epubReady = null;
function loadEpubjs() {
  if (!epubReady) {
    epubReady = (async () => {
      await loadScript(JSZIP_URL);
      await loadScript(EPUBJS_URL);
      if (!window.ePub) throw new Error('epub.js failed to initialize');
      return window.ePub;
    })();
  }
  return epubReady;
}

function stripHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Remove scripts/styles entirely.
  doc.querySelectorAll('script, style').forEach((el) => el.remove());
  // Insert newlines for block-level elements so paragraphs survive flattening.
  doc.querySelectorAll('p, br, div, h1, h2, h3, h4, h5, h6, li').forEach((el) => {
    el.append('\n');
  });
  return (doc.body?.innerText || doc.body?.textContent || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
}

export async function parseEpub(file, onProgress) {
  const ePub = await loadEpubjs();
  const buf = await file.arrayBuffer();
  const book = ePub(buf);
  await book.ready;

  const spine = book.spine?.spineItems || [];
  let title = file.name;
  try {
    const meta = await book.loaded.metadata;
    if (meta?.title) title = meta.title;
  } catch {}

  const chunks = [];
  for (let i = 0; i < spine.length; i++) {
    const item = spine[i];
    try {
      const doc = await item.load(book.load.bind(book));
      const html = doc?.documentElement?.outerHTML || '';
      chunks.push(stripHtml(html));
      item.unload();
    } catch {
      // Skip unreadable spine items rather than aborting the whole book.
    }
    if (onProgress) onProgress((i + 1) / spine.length);
  }

  return {
    title: titleFromFilename(title) || titleFromFilename(file.name),
    type: 'epub',
    text: chunks.join('\n\n'),
  };
}

export async function parseFile(file, onProgress) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.txt') || name.endsWith('.md')) return parseTxt(file);
  if (name.endsWith('.pdf')) return parsePdf(file, onProgress);
  if (name.endsWith('.epub')) return parseEpub(file, onProgress);
  // Fall back to MIME type sniffing.
  if (file.type === 'application/pdf') return parsePdf(file, onProgress);
  if (file.type === 'application/epub+zip') return parseEpub(file, onProgress);
  if (file.type.startsWith('text/')) return parseTxt(file);
  throw new Error(`Unsupported file type: ${file.name}`);
}
