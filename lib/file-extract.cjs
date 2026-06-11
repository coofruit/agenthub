/**
 * GoalinWeb 本地附件正文解析（无云函数，由 dev-server /api/local/extract-file 调用）
 * 策略：内置 docx/pdf → 可选 npm 增强（pdf-parse、mammoth、xlsx、iconv-lite、word-extractor）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { extractDocxText } = require('./docx-extract.cjs');
const { extractPdfText: extractPdfBuiltin } = require('./pdf-extract.cjs');

const MAX_INLINE_CHARS = 48000;
const MAX_PDF_PAGES = 100;
const MAX_SHEETS = 10;
const MAX_SHEET_ROWS = 2000;
const MAX_SHEET_COLS = 50;
const MIN_USEFUL_TEXT_LEN = 8;

const TEXT_LIKE_EXTS = new Set(['txt', 'md', 'csv', 'json', 'js', 'ts', 'html', 'htm', 'xml', 'log']);
const EXTRACTABLE_EXTS = new Set([...TEXT_LIKE_EXTS, 'doc', 'docx', 'pdf', 'xls', 'xlsx']);
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);

function tryRequire(name) {
  try {
    return require(name);
  } catch {
    return null;
  }
}

const deps = {
  pdfParse: tryRequire('pdf-parse'),
  mammoth: tryRequire('mammoth'),
  xlsx: tryRequire('xlsx'),
  iconv: tryRequire('iconv-lite'),
  wordExtractor: tryRequire('word-extractor'),
};

function getExt(fileName) {
  return String(fileName || '').split('.').pop().toLowerCase();
}

function isImageFileName(fileName) {
  return IMAGE_EXTS.has(getExt(fileName));
}

function isZipLike(buffer) {
  return buffer && buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function normalizeExtractedText(text) {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/\uFFFD/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function truncateText(text) {
  const normalized = normalizeExtractedText(text);
  if (!normalized) return '';
  if (normalized.length <= MAX_INLINE_CHARS) return normalized;
  return normalized.slice(0, MAX_INLINE_CHARS) + '\n\n…（附件内容过长，已截断）';
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"');
}

function looksLikeMojibake(text) {
  if (!text) return false;
  const sample = text.slice(0, 4000);
  const bad = (sample.match(/[\u0080-\u009F]|\uFFFD|锟斤拷|Ã.|Â./g) || []).length;
  const cjk = (sample.match(/[\u4e00-\u9fff]/g) || []).length;
  return bad > 8 && cjk < 4;
}

function decodeTextBuffer(buffer) {
  if (!buffer || !buffer.length) return '';
  let start = 0;
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    start = 3;
  }
  const utf8 = buffer.slice(start).toString('utf8');
  if (!looksLikeMojibake(utf8)) return utf8;
  if (deps.iconv) {
    try {
      const gb = deps.iconv.decode(buffer.slice(start), 'gb18030');
      if (gb && !looksLikeMojibake(gb)) return gb;
    } catch {}
  }
  return utf8;
}

function isUsefulText(text) {
  return normalizeExtractedText(text).length >= MIN_USEFUL_TEXT_LEN;
}

function extractPrintableStrings(buffer, maxChars = 12000) {
  const parts = [];
  let ascii = '';
  let utf16 = '';

  const pushAscii = () => {
    const s = ascii.trim();
    if (s.length >= MIN_USEFUL_TEXT_LEN) parts.push(s);
    ascii = '';
  };
  const pushUtf16 = () => {
    const s = utf16.trim();
    if (s.length >= MIN_USEFUL_TEXT_LEN) parts.push(s);
    utf16 = '';
  };

  for (let i = 0; i < buffer.length - 1 && parts.join('\n').length < maxChars; i++) {
    const b = buffer[i];
    if (b >= 32 && b <= 126) ascii += String.fromCharCode(b);
    else pushAscii();

    if (i % 2 === 0 && i + 1 < buffer.length) {
      const lo = buffer[i];
      const hi = buffer[i + 1];
      const code = lo | (hi << 8);
      if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf) || (code >= 32 && code <= 126)) {
        utf16 += String.fromCharCode(code);
        i++;
      } else pushUtf16();
    }
  }
  pushAscii();
  pushUtf16();
  return normalizeExtractedText([...new Set(parts)].join('\n')).slice(0, maxChars);
}

async function extractWithTempFile(buffer, fileName, extractFn) {
  const tmpPath = path.join(os.tmpdir(), `goalin_${Date.now()}_${String(fileName).replace(/[\\/:*?"<>|]/g, '_')}`);
  try {
    fs.writeFileSync(tmpPath, buffer);
    return await extractFn(tmpPath);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

async function extractDocx(buffer) {
  if (deps.mammoth) {
    try {
      const { value } = await deps.mammoth.extractRawText({ buffer });
      const text = normalizeExtractedText(value);
      if (isUsefulText(text)) return text;
    } catch (e) {
      console.warn('[file-extract] mammoth raw:', e.message);
    }
    try {
      const { value } = await deps.mammoth.convertToHtml({ buffer });
      const text = normalizeExtractedText(stripHtml(value));
      if (isUsefulText(text)) return text;
    } catch (e) {
      console.warn('[file-extract] mammoth html:', e.message);
    }
  }

  const builtin = extractDocxText(buffer);
  return isUsefulText(builtin) ? builtin : '';
}

async function extractDoc(buffer, fileName) {
  if (isZipLike(buffer)) {
    const asDocx = await extractDocx(buffer);
    if (isUsefulText(asDocx)) return asDocx;
  }

  if (deps.wordExtractor) {
    try {
      const WordExtractor = deps.wordExtractor.default || deps.wordExtractor;
      const extractor = new WordExtractor();
      const doc = await extractWithTempFile(buffer, fileName, (p) => extractor.extract(p));
      const text = normalizeExtractedText([
        doc.getHeaders(),
        doc.getBody(),
        doc.getFooters(),
        doc.getFootnotes && doc.getFootnotes(),
        doc.getEndnotes && doc.getEndnotes(),
      ].filter(Boolean).join('\n\n'));
      if (isUsefulText(text)) return text;
    } catch (e) {
      console.warn('[file-extract] word-extractor:', e.message);
    }
  }

  const fallback = extractPrintableStrings(buffer);
  return isUsefulText(fallback) ? fallback : '';
}

async function extractPdf(buffer) {
  if (deps.pdfParse) {
    const pageRenderer = (pageData) =>
      pageData.getTextContent()
        .then((tc) => (tc.items || []).map((item) => item.str || '').join(' '))
        .catch(() => '');

    for (const options of [{ max: MAX_PDF_PAGES }, { max: MAX_PDF_PAGES, pagerender: pageRenderer }]) {
      try {
        const data = await deps.pdfParse(buffer, options);
        const text = normalizeExtractedText(data.text || '');
        if (isUsefulText(text)) return text;
      } catch (e) {
        console.warn('[file-extract] pdf-parse:', e.message);
      }
    }
  }

  const builtin = extractPdfBuiltin(buffer);
  return isUsefulText(builtin) ? builtin : '';
}

async function extractSpreadsheet(buffer) {
  if (!deps.xlsx) return '';
  try {
    const wb = deps.xlsx.read(buffer, {
      type: 'buffer',
      cellDates: true,
      cellNF: false,
      cellStyles: false,
      dense: true,
    });
    const blocks = [];
    for (const sheetName of wb.SheetNames.slice(0, MAX_SHEETS)) {
      const sheet = wb.Sheets[sheetName];
      if (!sheet) continue;
      const rows = deps.xlsx.utils.sheet_to_json(sheet, {
        header: 1,
        defval: '',
        raw: false,
        blankrows: false,
      });
      const lines = rows.slice(0, MAX_SHEET_ROWS).map((row) => {
        const cells = (Array.isArray(row) ? row : [row]).slice(0, MAX_SHEET_COLS);
        return cells.map((cell) => String(cell ?? '').replace(/\s+/g, ' ').trim()).join('\t');
      }).filter((line) => line.replace(/\t/g, '').trim());
      if (lines.length) blocks.push(`【工作表：${sheetName}】\n${lines.join('\n')}`);
    }
    return normalizeExtractedText(blocks.join('\n\n'));
  } catch (e) {
    console.warn('[file-extract] xlsx:', e.message);
  }
  return '';
}

function shouldExtractText(fileName, skipExtract = false) {
  if (skipExtract || isImageFileName(fileName)) return false;
  return EXTRACTABLE_EXTS.has(getExt(fileName));
}

function getExtractCapabilities() {
  return {
    builtin: ['docx', 'pdf'],
    npm: {
      'pdf-parse': !!deps.pdfParse,
      mammoth: !!deps.mammoth,
      xlsx: !!deps.xlsx,
      'iconv-lite': !!deps.iconv,
      'word-extractor': !!deps.wordExtractor,
    },
    extensions: [...EXTRACTABLE_EXTS],
  };
}

async function extractFileText(buffer, fileName, mimeType) {
  if (!buffer || !buffer.length) return '';
  if (isImageFileName(fileName)) return '';

  const ext = getExt(fileName);
  let text = '';

  try {
    if (TEXT_LIKE_EXTS.has(ext)) {
      text = ext === 'html' || ext === 'htm'
        ? stripHtml(decodeTextBuffer(buffer))
        : decodeTextBuffer(buffer);
    } else if (ext === 'docx') {
      text = await extractDocx(buffer);
    } else if (ext === 'doc') {
      text = await extractDoc(buffer, fileName);
    } else if (ext === 'pdf') {
      text = await extractPdf(buffer);
    } else if (ext === 'xls' || ext === 'xlsx') {
      text = await extractSpreadsheet(buffer);
    } else if (isZipLike(buffer)) {
      text = await extractDocx(buffer);
    }
  } catch (err) {
    console.warn('[file-extract]', fileName, err.message);
  }

  return truncateText(text);
}

module.exports = {
  extractFileText,
  shouldExtractText,
  isImageFileName,
  getExtractCapabilities,
  EXTRACTABLE_EXTS,
};
