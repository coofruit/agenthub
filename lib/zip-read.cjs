/**
 * 最小 ZIP 读取（仅支持 docx 等常见 deflate/存储条目）
 */
const zlib = require('zlib');

const SIG_LOCAL = 0x04034b50;

function findZipEntry(buffer, entryPath) {
  const want = String(entryPath || '').replace(/\\/g, '/');
  let offset = 0;
  const len = buffer.length;

  while (offset + 30 < len) {
    if (buffer.readUInt32LE(offset) !== SIG_LOCAL) {
      offset += 1;
      continue;
    }

    const compMethod = buffer.readUInt16LE(offset + 8);
    const compSize = buffer.readUInt32LE(offset + 18);
    const fileNameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLen;
    if (nameEnd > len) break;

    const name = buffer.toString('utf8', nameStart, nameEnd);
    const dataStart = nameEnd + extraLen;
    const dataEnd = dataStart + compSize;
    if (dataEnd > len) break;

    const compressed = buffer.subarray(dataStart, dataEnd);
    offset = dataEnd;

    if (name !== want) continue;

    if (compMethod === 0) return compressed;
    if (compMethod === 8) {
      try {
        return zlib.inflateRawSync(compressed);
      } catch {
        return null;
      }
    }
    return null;
  }
  return null;
}

module.exports = { findZipEntry };
