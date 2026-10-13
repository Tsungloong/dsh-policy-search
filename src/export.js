import ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, ExternalHyperlink, Footer, PageNumber, AlignmentType } from 'docx';
import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import { FIELD_LABELS } from './policy.js';

const font = fileURLToPath(new URL('../assets/NotoSansCJKsc-Regular.otf', import.meta.url));
export const FORMATS = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf', json: 'application/json',
};
const value = f => f?.value ?? '未明确 / 待核实';
const title = job => `${job.request.mode === 'demo' ? '【虚构演示】' : ''}企业扶持政策简报`;
const notice = job => `检索主题：${job.request.query} | 核对基准日：${job.asOf}（中国标准时间）\n${job.coverage}\n自动提取仅供资料整理，字段证据匹配不等于语义或法律效力确认；申报前以主管部门原文及最新通知为准。${job.status === 'running' ? '\n任务仍在运行，本文件为阶段快照。' : ''}`;

async function xlsx(job) {
  const book = new ExcelJS.Workbook(); book.creator = 'DSH Policy Search';
  const info = book.addWorksheet('阅读说明');
  info.addRows([[title(job)], [notice(job)], ['任务状态', job.status], ['政策数', job.records.length], ['抓取失败/提醒', job.errors.length]]);
  info.getColumn(1).width = 28; info.getColumn(2).width = 100;
  info.mergeCells('A1:B1'); info.mergeCells('A2:B2');
  info.getCell('A1').font = { bold: true }; info.getCell('A2').alignment = { wrapText: true, vertical: 'top' }; info.getRow(2).height = 110;
  const sheet = book.addWorksheet('政策汇总', { views: [{ state: 'frozen', ySplit: 1 }] });
  const keys = Object.keys(FIELD_LABELS);
  sheet.columns = [...keys.map(key => ({ header: FIELD_LABELS[key], key, width: ['name', 'eligibility', 'subsidy'].includes(key) ? 48 : 23 })), { header: '期限提示', key: 'deadlineStatus', width: 24 }, { header: '原文链接', key: 'sourceUrl', width: 55 }, { header: '抓取时间', key: 'fetchedAt', width: 28 }, { header: '复核提醒', key: 'warnings', width: 55 }];
  for (const r of job.records) {
    // Plain strings only; never turn untrusted source text into spreadsheet formulas.
    const row = Object.fromEntries(keys.map(k => [k, String(value(r.fields[k]))]));
    sheet.addRow({ ...row, deadlineStatus: r.deadlineStatus, sourceUrl: r.sourceUrl, fetchedAt: r.fetchedAt, warnings: ['待人工复核', ...r.warnings].join('；') });
  }
  sheet.autoFilter = { from: 'A1', to: { row: Math.max(1, sheet.rowCount), column: sheet.columnCount } };
  sheet.eachRow((row, n) => { row.alignment = { vertical: 'top', wrapText: true }; row.height = n === 1 ? 30 : 110; if (n === 1) { row.font = { bold: true, color: { argb: 'FFFFFFFF' } }; row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF174A42' } }; } });
  const evidence = book.addWorksheet('字段证据', { views: [{ state: 'frozen', ySplit: 1 }] });
  evidence.columns = [{ header: '政策名称', key: 'name', width: 48 }, { header: '字段', key: 'field', width: 20 }, { header: '提取值', key: 'value', width: 60 }, { header: '原文证据', key: 'quote', width: 90 }, { header: '证据匹配', key: 'verified', width: 18 }, { header: '来源', key: 'url', width: 60 }];
  for (const r of job.records) for (const k of keys) evidence.addRow({ name: value(r.fields.name), field: FIELD_LABELS[k], value: value(r.fields[k]), quote: r.fields[k].evidence ?? '', verified: r.fields[k].verified ? '原文匹配，语义待复核' : '待核实', url: r.sourceUrl });
  evidence.eachRow(row => { row.alignment = { wrapText: true, vertical: 'top' }; row.height = 65; });
  const failures = book.addWorksheet('未完成来源'); failures.addRow(['阶段', '来源', '原因']);
  job.errors.forEach(e => failures.addRow([e.stage, e.url ?? '', e.message])); failures.columns.forEach(c => { c.width = 55; });
  for (const tab of book.worksheets) tab.eachRow(row => { row.eachCell(cell => { cell.font = { ...cell.font, name: 'Noto Sans CJK SC', size: 11 }; }); });
  return Buffer.from(await book.xlsx.writeBuffer());
}

async function docx(job) {
  const p = (text, options = {}) => new Paragraph({ children: String(text).split('\n').map((line, i) => new TextRun({ text: line, ...(i ? { break: 1 } : {}) })), spacing: { after: 160 }, ...options });
  const children = [p(title(job), { heading: HeadingLevel.TITLE }), p(notice(job))];
  for (const [i, r] of job.records.entries()) {
    children.push(p(`${i + 1}. ${value(r.fields.name)}`, { heading: HeadingLevel.HEADING_1 }));
    children.push(p(`期限提示：${r.deadlineStatus}　|　待人工复核`));
    for (const [k, label] of Object.entries(FIELD_LABELS)) {
      if (k === 'name') continue;
      children.push(p(`${label}：${value(r.fields[k])}`));
      if (r.fields[k].evidence) children.push(p(`原文证据：${r.fields[k].evidence}`, { style: 'Evidence' }));
    }
    children.push(new Paragraph({ children: [new ExternalHyperlink({ link: r.sourceUrl, children: [new TextRun({ text: `来源：${r.sourceUrl}`, style: 'Hyperlink' })] })] }));
    children.push(p(`抓取时间：${r.fetchedAt}\n内容 SHA-256：${r.contentHash}\n${r.warnings.join('；')}`));
  }
  if (job.errors.length) { children.push(p('未完成来源', { heading: HeadingLevel.HEADING_1 })); job.errors.forEach(e => children.push(p(`${e.stage}：${e.url ?? ''}\n${e.message}`))); }
  const doc = new Document({ creator: 'DSH Policy Search', title: title(job),
    styles: { default: { document: { run: { font: 'Noto Sans CJK SC', size: 22 }, paragraph: { spacing: { line: 320 } } } }, paragraphStyles: [{ id: 'Evidence', name: '原文证据', basedOn: 'Normal', run: { size: 19, color: '54665F' }, paragraph: { indent: { left: 280 } } }] },
    sections: [{ properties: { page: { margin: { top: 1100, bottom: 1100, left: 1100, right: 1100 } } }, children,
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT] })] })] }) } }],
  });
  return Packer.toBuffer(doc);
}

async function pdf(job) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 48, bottom: 48, left: 48, right: 48 }, bufferPages: true, info: { Title: title(job), Author: 'DSH Policy Search' } });
  const chunks = [];
  const done = new Promise((resolve, reject) => { doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  doc.font(font);
  const text = (s, size = 10, color = '#233B34') => { doc.fontSize(size).fillColor(color).text(String(s), { lineGap: 2, paragraphGap: 3 }); doc.moveDown(0.15); };
  text(title(job), 22); text(notice(job), 10, '#54665F');
  for (const [i, r] of job.records.entries()) {
    if (i > 0 || doc.y > 610) doc.addPage();
    text(`${i + 1}. ${value(r.fields.name)}`, 15); text(`${r.deadlineStatus} · 待人工复核`, 10, '#956021');
    for (const [key, label] of Object.entries(FIELD_LABELS)) {
      if (key === 'name') continue;
      text(`${label}：${value(r.fields[key])}`);
      if (r.fields[key].evidence) text(`原文证据：${r.fields[key].evidence}`, 9, '#65776D');
    }
    text(`来源：${r.sourceUrl}`, 9); text(`抓取时间：${r.fetchedAt}`, 9);
    if (r.warnings.length) text(r.warnings.join('；'), 9, '#956021');
  }
  if (job.errors.length) { text('未完成来源', 15); job.errors.forEach(e => text(`${e.stage}：${e.url ?? ''}\n${e.message}`, 9)); }
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i); const bottom = doc.page.margins.bottom; doc.page.margins.bottom = 0;
    doc.fontSize(8).fillColor('#65776D').text(`${i + 1} / ${range.count}　｜　DSH 政策简报`, 48, 804, { lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end(); return done;
}

export async function exportBrief(job, format) {
  if (!Object.hasOwn(FORMATS, format)) throw new Error('不支持的导出格式');
  // Freeze a snapshot while an asynchronous task may still be updating its state.
  const snapshot = structuredClone(job);
  if (format === 'json') return Buffer.from(JSON.stringify(snapshot, null, 2));
  return ({ xlsx, docx, pdf })[format](snapshot);
}
