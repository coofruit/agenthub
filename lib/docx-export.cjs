'use strict';

const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
} = require('docx');

function splitLines(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n');
}

function bodyParagraphs(text, { bold = false } = {}) {
  const lines = splitLines(text).filter((line, i, arr) => line.trim() || arr.length === 1);
  if (!lines.length) return [new Paragraph({ children: [new TextRun('（无内容）')] })];
  return lines.map(line => new Paragraph({
    children: [new TextRun({ text: line, bold })],
    spacing: { after: 120 },
  }));
}

async function buildDocxBuffer({ title, query, processText, mainText, dualOpinion = false }) {
  const children = [
    new Paragraph({
      text: title || '智能体回复',
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 240 },
    }),
  ];

  if (dualOpinion) {
    const parts = [processText, mainText].map(t => String(t || '').trim()).filter(Boolean);
    children.push(...bodyParagraphs(parts.join('\n\n') || '（无内容）'));
  } else if (query?.trim()) {
    children.push(
      new Paragraph({ text: '用户问题', heading: HeadingLevel.HEADING_2, spacing: { before: 120, after: 120 } }),
      ...bodyParagraphs(query),
    );
    if (processText?.trim()) {
      children.push(
        new Paragraph({ text: '分析过程', heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } }),
        ...bodyParagraphs(processText),
      );
    }
    children.push(
      new Paragraph({ text: '正式回复', heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } }),
      ...bodyParagraphs(mainText || '（无正式回复）'),
    );
  } else {
    if (processText?.trim()) {
      children.push(
        new Paragraph({ text: '分析过程', heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } }),
        ...bodyParagraphs(processText),
      );
    }
    children.push(
      new Paragraph({ text: '正式回复', heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } }),
      ...bodyParagraphs(mainText || '（无正式回复）'),
    );
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
  });
  return Packer.toBuffer(doc);
}

module.exports = { buildDocxBuffer };
