import ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, ExternalHyperlink, Footer, PageNumber, AlignmentType, Table, TableRow, TableCell, WidthType } from 'docx';
import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';

const font = fileURLToPath(new URL('../assets/NotoSansCJKsc-Regular.otf', import.meta.url));
export const FORMATS = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf', json: 'application/json',
};
const cellText = value => value === null ? '' : String(value);

export function validateDocument(input) {
  if (!input || typeof input !== 'object' || typeof input.title !== 'string' || !input.title.trim()) throw new Error('document.title 须为非空标题');
  if (input.summary !== undefined && typeof input.summary !== 'string') throw new Error('summary 须为文字');
  for (const key of ['sections', 'tables', 'references']) if (input[key] !== undefined && !Array.isArray(input[key])) throw new Error(`${key} 须为数组`);
  const doc = { title: input.title, summary: input.summary ?? '', sections: input.sections ?? [], tables: input.tables ?? [], references: input.references ?? [] };
  for (const s of doc.sections) {
    if (!s || typeof s.heading !== 'string' || typeof s.text !== 'string') throw new Error('每个 section 须包含 heading 和 text');
  }
  for (const table of doc.tables) {
    if (!table || typeof table.name !== 'string' || !Array.isArray(table.columns) || !table.columns.length || table.columns.some(c => typeof c !== 'string') || !Array.isArray(table.rows)) throw new Error('每个 table 须包含 name、文字 columns 和 rows 数组');
    for (const row of table.rows) {
      if (!Array.isArray(row) || row.length !== table.columns.length || row.some(c => c !== null && !['string', 'number', 'boolean'].includes(typeof c))) throw new Error('表格每行须与列数一致，单元格仅接受文字、数字、布尔值或 null');
    }
  }
  for (const ref of doc.references) {
    if (!ref || typeof ref.title !== 'string' || typeof ref.url !== 'string' || !/^https?:$/.test(new URL(ref.url).protocol)) throw new Error('references 须包含 title 与 HTTP(S) url');
  }
  return doc;
}

async function xlsx(doc, signal) {
  const book = new ExcelJS.Workbook(); book.creator = 'DSH Policy Search';
  const names = new Set();
  const sheet = (name, columns, rows) => {
    const base = name.replace(/[\\/*?:\[\]]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || '工作表';
    let actual = base, n = 2;
    while (names.has(actual.toLowerCase())) { const suffix = ` (${n++})`; actual = base.slice(0, 31 - suffix.length) + suffix; }
    names.add(actual.toLowerCase());
    const tab = book.addWorksheet(actual, { views: [{ state: 'frozen', ySplit: 1 }] });
    tab.addRow(columns); rows.forEach(row => { signal?.throwIfAborted(); tab.addRow(row); });
    tab.columns.forEach((col, i) => { col.width = Math.min(65, Math.max(18, ...[columns, ...rows].map(row => [...cellText(row[i])].reduce((size, c) => size + (c.charCodeAt(0) > 255 ? 2 : 1), 0) + 2))); });
    tab.eachRow((row, index) => {
      row.eachCell({ includeEmpty: true }, cell => {
        cell.font = { name: 'Noto Sans CJK SC', size: 11, ...(index === 1 ? { bold: true, color: { argb: 'FFFFFFFF' } } : {}) };
        cell.alignment = { vertical: 'top', wrapText: true };
        if (index === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF174A42' } };
      });
      if (index === 1) row.height = 26;
    });
    tab.autoFilter = { from: { row: 1, column: 1 }, to: { row: tab.rowCount, column: columns.length } };
    tab.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1' };
  };
  sheet('说明', ['项目', '内容'], [['标题', doc.title], ...(doc.summary ? [['说明', doc.summary]] : []), ...doc.sections.map(s => [s.heading, s.text])]);
  for (const table of doc.tables) sheet(table.name, table.columns, table.rows);
  if (doc.references.length) sheet('来源', ['标题', '链接'], doc.references.map(r => [r.title, r.url]));
  return Buffer.from(await book.xlsx.writeBuffer());
}

const paragraph = (text, options = {}) => new Paragraph({ children: String(text).split('\n').map((line, i) => new TextRun({ text: line, ...(i ? { break: 1 } : {}) })), spacing: { after: 150 }, ...options });
const wideTable = table => table.columns.length > 6 || table.rows.some(row => row.some(c => cellText(c).length > 400));
async function docx(doc, signal) {
  const children = [paragraph(doc.title, { heading: HeadingLevel.TITLE })];
  if (doc.summary) children.push(paragraph(doc.summary));
  for (const section of doc.sections) {
    signal?.throwIfAborted();
    if (section.heading) children.push(paragraph(section.heading, { heading: HeadingLevel.HEADING_1 }));
    children.push(paragraph(section.text));
  }
  for (const table of doc.tables) {
    children.push(paragraph(table.name, { heading: HeadingLevel.HEADING_1 }));
    if (wideTable(table)) {
      table.rows.forEach((row, i) => { children.push(paragraph(`第 ${i + 1} 项`, { heading: HeadingLevel.HEADING_2 }), ...row.map((v, j) => paragraph(`${table.columns[j]}：${cellText(v)}`))); });
    } else {
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [table.columns, ...table.rows].map((row, i) => new TableRow({ tableHeader: i === 0, children: row.map(v => new TableCell({ ...(i === 0 ? { shading: { fill: 'E8F0ED' } } : {}), children: [paragraph(cellText(v))] })) })) }));
    }
  }
  if (doc.references.length) children.push(paragraph('来源', { heading: HeadingLevel.HEADING_1 }));
  for (const ref of doc.references) children.push(new Paragraph({ spacing: { after: 150 }, children: [new ExternalHyperlink({ link: ref.url, children: [new TextRun({ text: `${ref.title}：${ref.url}`, style: 'Hyperlink' })] })] }));
  return Packer.toBuffer(new Document({ creator: 'DSH Policy Search', title: doc.title,
    styles: { default: { document: { run: { font: 'Noto Sans CJK SC', size: 22 }, paragraph: { spacing: { line: 320 } } } } },
    sections: [{ properties: { page: { margin: { top: 1100, bottom: 1100, left: 1100, right: 1100 } } }, children,
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT] })] })] }) } }],
  }));
}

async function pdf(doc, signal) {
  const pdf = new PDFDocument({ size: 'A4', margins: { top: 48, bottom: 48, left: 48, right: 48 }, bufferPages: true, info: { Title: doc.title, Author: 'DSH Policy Search' } });
  const chunks = [];
  const done = new Promise((resolve, reject) => { pdf.on('data', c => chunks.push(c)); pdf.on('end', () => resolve(Buffer.concat(chunks))); pdf.on('error', reject); });
  pdf.font(font);
  const text = (s, size = 10, color = '#233B34') => { signal?.throwIfAborted(); pdf.fontSize(size).fillColor(color).text(String(s), 48, pdf.y, { width: 499, lineGap: 3, paragraphGap: 4 }); pdf.moveDown(0.3); };
  const heading = s => { if (pdf.y > 720) pdf.addPage(); text(s, 15); };
  try {
    text(doc.title, 22);
    if (doc.summary) text(doc.summary, 10, '#54665F');
    for (const section of doc.sections) { if (section.heading) heading(section.heading); text(section.text); }
    for (const table of doc.tables) {
      heading(table.name);
      if (wideTable(table)) {
        table.rows.forEach((row, i) => { text(`第 ${i + 1} 项`, 11); row.forEach((v, j) => text(`${table.columns[j]}：${cellText(v)}`)); });
      } else {
        pdf.fontSize(9).fillColor('#233B34');
        pdf.table({ maxWidth: 499, data: [table.columns, ...table.rows.map(r => r.map(cellText))], defaultStyle: { border: 0.5, borderColor: '#BACBC3', padding: 5 }, rowStyles: i => i === 0 ? { backgroundColor: '#E8F0ED' } : {} });
        pdf.moveDown();
      }
    }
    if (doc.references.length) heading('来源');
    for (const ref of doc.references) text(`${ref.title}\n${ref.url}`, 9);
    const range = pdf.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      pdf.switchToPage(i); const bottom = pdf.page.margins.bottom; pdf.page.margins.bottom = 0;
      pdf.fontSize(8).fillColor('#65776D').text(`${i + 1} / ${range.count}`, 48, 804, { lineBreak: false }); pdf.page.margins.bottom = bottom;
    }
    pdf.end();
  } catch (error) { pdf.destroy(error); }
  return done;
}

export async function exportDocument(input, format, signal) {
  if (!Object.hasOwn(FORMATS, format)) throw new Error('不支持的文件格式');
  signal?.throwIfAborted();
  const doc = validateDocument(input);
  const bytes = format === 'json' ? Buffer.from(JSON.stringify(doc, null, 2)) : await ({ xlsx, docx, pdf })[format](doc, signal);
  signal?.throwIfAborted();
  return bytes;
}
