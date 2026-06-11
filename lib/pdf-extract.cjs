/**
 * 无第三方依赖的 PDF 文本提取（适用于含可复制文字的 PDF，非扫描件）
 */
const MAX_CHARS = 48000;

function decodePdfLiteral(s) {
  return String(s || '')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

function decodePdfHex(hex) {
  const clean = String(hex || '').replace(/\s/g, '');
  if (clean.length < 4) return '';
  const parts = [];
  if (clean.length % 4 === 0) {
    for (let i = 0; i < clean.length; i += 4) {
      const cp = parseInt(clean.slice(i, i + 4), 16);
      if (cp >= 32 && cp !== 0xffff) parts.push(String.fromCharCode(cp));
    }
    return parts.join('');
  }
  for (let i = 0; i + 1 < clean.length; i += 2) {
    const b = parseInt(clean.slice(i, i + 2), 16);
    if (b >= 32 && b < 127) parts.push(String.fromCharCode(b));
  }
  return parts.join('');
}

function isUsefulChunk(t) {
  const s = String(t || '').trim();
  if (s.length < 1) return false;
  if (/^[\x00-\x08\x0e-\x1f]+$/.test(s)) return false;
  return /[\u4e00-\u9fffA-Za-z0-9]/.test(s);
}

function extractPdfText(buffer) {
  if (!buffer || buffer.length < 5) return '';
  if (buffer[0] !== 0x25 || buffer[1] !== 0x50 || buffer[2] !== 0x44 || buffer[3] !== 0x46) return '';

  const raw = buffer.toString('latin1');
  const chunks = [];

  const literalRe = /\(([^()\\]*(?:\\.[^()\\]*)*)\)/g;
  let m;
  while ((m = literalRe.exec(raw)) !== null) {
    const t = decodePdfLiteral(m[1]);
    if (isUsefulChunk(t)) chunks.push(t);
  }

  const hexRe = /<([0-9A-Fa-f\s]+)>/g;
  while ((m = hexRe.exec(raw)) !== null) {
    const t = decodePdfHex(m[1]);
    if (isUsefulChunk(t)) chunks.push(t);
  }

  let text = chunks.join('\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();

  if (text.length < 8) return '';
  if (text.length > MAX_CHARS) {
    return text.slice(0, MAX_CHARS) + '\n\n…（PDF 内容过长，已截断）';
  }
  return text;
}

module.exports = { extractPdfText };
