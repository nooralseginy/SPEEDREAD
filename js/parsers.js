// File parsers that turn an uploaded File into { title, type, text }.
// PDF and EPUB libraries are loaded lazily from a CDN on first use.

const PDFJS_VERSION = '4.7.76';
const PDFJS_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`;
const PDFJS_WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;
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

let jszipReady = null;
function loadJSZip() {
  if (!jszipReady) {
    jszipReady = (async () => {
      await loadScript(JSZIP_URL);
      if (!window.JSZip) throw new Error('JSZip failed to load.');
      return window.JSZip;
    })();
  }
  return jszipReady;
}

// Resolve a spine item's href relative to the OPF file's directory,
// collapsing `..` / `.` and decoding percent-escapes.
function resolveZipPath(opfPath, href) {
  const cleanHref = decodeURIComponent(href.split('#')[0]);
  const baseDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const parts = (baseDir + cleanHref).split('/');
  const out = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return out.join('/');
}

function zipFileCaseInsensitive(zip, path) {
  const direct = zip.file(path);
  if (direct) return direct;
  const lower = path.toLowerCase();
  for (const name of Object.keys(zip.files)) {
    if (name.toLowerCase() === lower) return zip.file(name);
  }
  return null;
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
  const JSZip = await loadJSZip();
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);

  // EPUBs declare the package (OPF) file via META-INF/container.xml.
  const containerEntry = zipFileCaseInsensitive(zip, 'META-INF/container.xml');
  if (!containerEntry) throw new Error('Not a valid EPUB: missing META-INF/container.xml.');
  const containerXml = await containerEntry.async('string');
  const container = new DOMParser().parseFromString(containerXml, 'application/xml');
  const rootfile = container.getElementsByTagName('rootfile')[0];
  const opfPath = rootfile?.getAttribute('full-path');
  if (!opfPath) throw new Error('Not a valid EPUB: no rootfile in container.xml.');

  const opfEntry = zipFileCaseInsensitive(zip, opfPath);
  if (!opfEntry) throw new Error(`EPUB package file not found at ${opfPath}.`);
  const opfXml = await opfEntry.async('string');
  const opf = new DOMParser().parseFromString(opfXml, 'application/xml');

  // Title from Dublin Core metadata, with fallbacks.
  let title = '';
  const DC_NS = 'http://purl.org/dc/elements/1.1/';
  const titleEl =
    opf.getElementsByTagNameNS(DC_NS, 'title')[0] ||
    opf.querySelector('metadata > title') ||
    opf.querySelector('title');
  if (titleEl?.textContent) title = titleEl.textContent.trim();

  // Build manifest (id -> href) and resolve the spine reading order.
  const manifest = {};
  for (const item of opf.getElementsByTagName('item')) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) manifest[id] = href;
  }
  const spineRefs = Array.from(opf.getElementsByTagName('itemref'))
    .map((ref) => ref.getAttribute('idref'))
    .map((id) => manifest[id])
    .filter(Boolean);

  if (spineRefs.length === 0) throw new Error('EPUB has no readable spine items.');

  const chunks = [];
  const failures = [];
  for (let i = 0; i < spineRefs.length; i++) {
    const fullPath = resolveZipPath(opfPath, spineRefs[i]);
    const entry = zipFileCaseInsensitive(zip, fullPath);
    if (!entry) {
      failures.push(fullPath);
    } else {
      try {
        const html = await entry.async('string');
        const text = stripHtml(html);
        if (text.trim()) chunks.push(text);
      } catch (err) {
        failures.push(fullPath);
      }
    }
    if (onProgress) onProgress((i + 1) / spineRefs.length);
  }

  if (chunks.length === 0) {
    throw new Error(
      failures.length
        ? `EPUB unreadable: could not extract text from spine (${failures.length} files).`
        : 'EPUB unreadable: spine produced no text.'
    );
  }

  return {
    title: title || titleFromFilename(file.name),
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
