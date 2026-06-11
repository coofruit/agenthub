/**
 * 无第三方依赖的 docx 正文提取（word/document.xml → w:t 文本）
 */
const { findZipEntry } = require('./zip-read.cjs');

function decodeXmlEntities(s) {
  return String(s || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractTextFromDocumentXml(xml) {
  const parts = [];
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const t = decodeXmlEntities(m[1]);
    if (t) parts.push(t);
  }
  return parts.join('');
}

function extractDocxText(buffer) {
  if (!buffer || buffer.length < 4) return '';
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) return '';

  const xmlBuf = findZipEntry(buffer, 'word/document.xml');
  if (!xmlBuf || !xmlBuf.length) return '';

  const xml = xmlBuf.toString('utf8');
  return extractTextFromDocumentXml(xml)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

module.exports = { extractDocxText };
