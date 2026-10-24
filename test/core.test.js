import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { dateValue, canonicalUrl, validateExtraction, deduplicate, filterRecords, policyDocument } from '../src/policy.js';
import { validateUrl, isPublicAddress, extractHtml, readSource, sourceKind, SafeFetcher } from '../src/fetcher.js';
import { searchPolicies, validateFilters } from '../src/search.js';
import { fixturePages, fixtureExtract, officeDocument } from './fixtures.js';
import { exportDocument, validateDocument } from '../src/export.js';

const page = fixturePages[0];
const record = () => validateExtraction(fixtureExtract(page), page, '2026-10-18');

test('dates reject impossible values and normalize Chinese dates', () => {
  assert.equal(dateValue('截止2026年2月28日'), '2026-02-28'); assert.equal(dateValue('2026年2月30日'), null); assert.equal(dateValue('长期有效'), null);
});
test('date roles remain separate and deadline day remains not-past', () => {
  const r = record(); assert.equal(r.fields.publishedDate.value, '2026-10-01'); assert.equal(r.fields.deadline.value, '2026-11-30');
  assert.equal(validateExtraction(fixtureExtract(page), page, '2026-11-30').deadlineStatus, '尚未到申报截止日期');
  assert.equal(validateExtraction(fixtureExtract(page), page, '2026-12-01').deadlineStatus, '已过申报截止日期');
});
test('invented fields and missing evidence are cleared', () => {
  const raw = fixtureExtract(page); raw.fields.subsidy = { value: '100万元', evidence: '补贴100万元' };
  const r = validateExtraction(raw, page); assert.equal(r.fields.subsidy.value, null); assert.ok(r.warnings.length);
});
test('amount rewrites fall back to the source quote', () => {
  const raw = fixtureExtract(page); raw.fields.subsidy.value = '保证返还100%';
  assert.equal(validateExtraction(raw, page).fields.subsidy.value, raw.fields.subsidy.evidence);
});
test('publication dates cannot be promoted to application deadlines', () => {
  const raw = fixtureExtract(page); raw.fields.deadline = raw.fields.publishedDate;
  assert.equal(validateExtraction(raw, page).fields.deadline.value, null);
});
test('ambiguous multi-round deadlines become unknown', () => {
  const source = { ...page, text: `${page.text}\n第一批截止2026年10月1日，第二批截止2026年11月30日。` };
  const raw = fixtureExtract(page); raw.fields.deadline.evidence = '第一批截止2026年10月1日，第二批截止2026年11月30日。';
  raw.fields.deadline.value = '2026-10-01'; assert.equal(validateExtraction(raw, source).fields.deadline.value, null);
});
test('non-policy pages are excluded and malformed output rejected', () => { assert.equal(validateExtraction({ isPolicy: false }, page), null); assert.throws(() => validateExtraction({}, page)); });
test('canonical URLs preserve meaningful queries and deduplicate text', () => {
  assert.equal(canonicalUrl('https://www.gov.cn/a?id=1&utm_source=x#fragment'), 'https://www.gov.cn/a?id=1');
  const a = record(), b = { ...a, sourceUrl: 'https://www.gov.cn/reprint' };
  const deduped = deduplicate([a, a, b]); assert.equal(deduped.length, 1); assert.equal(deduped[0].alternateSources.length, 1);
});
test('filters exclude unknown publication dates and preserve matching fields', () => {
  assert.equal(filterRecords([record()], { region: '示例市' }).length, 1); assert.equal(filterRecords([record()], { industry: '软件' }).length, 0);
  const r = record(); r.fields.publishedDate.value = null; assert.equal(filterRecords([r], { from: '2026-01-01' }).length, 0);
});
test('network boundary accepts public park domains but rejects internal addresses and credentials', () => {
  for (const url of ['file:///etc/passwd', 'http://127.0.0.1', 'https://u:p@www.gov.cn', 'https://www.gov.cn:8888']) assert.throws(() => validateUrl(url));
  assert.equal(validateUrl('https://www.gov.cn').hostname, 'www.gov.cn'); assert.equal(validateUrl('https://park.example').hostname, 'park.example');
  for (const ip of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1', '100.64.0.1']) assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress('8.8.8.8'), true);
});
test('HTML extraction removes script/instructions markup and preserves article text', () => {
  const p = extractHtml('<html><title>政策标题</title><body><nav>导航</nav><article><p>企业补贴条件</p><script>steal()</script><p>申报截止</p></article><a href="/doc.pdf">附件</a></body></html>', 'https://www.gov.cn/a');
  assert.equal(p.title, '政策标题'); assert.ok(!p.text.includes('steal')); assert.ok(!p.text.includes('导航')); assert.equal(p.links[0].url, 'https://www.gov.cn/doc.pdf');
});

test('lookalike domains are never classified as government sources', () => {
  assert.match(sourceKind('https://gov.cn.evil.example/a'), /待核对/);
  assert.match(sourceKind('https://www.gov.cn/a'), /政府域名/);
});
test('search uses the host provider and propagates cancellation without fallback', async () => {
  const signal = new AbortController().signal;
  const web = { async search(request, receivedSignal) {
    assert.equal(receivedSignal, signal); assert.match(request.query, /广东/); assert.equal(request.maxResults, 5);
    return { sources: [{ url: 'https://park.example/a' }, { url: 'https://park.example/a?utm_source=x' }, { url: 'http://127.0.0.1/' }], truncated: false };
  } };
  const result = await searchPolicies(web, { query: '补贴', filters: { region: '广东' }, limit: 5 }, signal);
  assert.equal(result.sources.length, 1); assert.equal(result.rejected.length, 1);
  await assert.rejects(() => searchPolicies(null, { query: '补贴' }, signal), /DSH 搜索服务/);
  await assert.rejects(() => searchPolicies({ search: async () => { throw new Error('provider offline'); } }, { query: '补贴' }), /provider offline/);
});
test('filters reject impossible and reversed dates', () => {
  assert.throws(() => validateFilters({ from: '2026-02-30' }));
  assert.throws(() => validateFilters({ from: '2026-10-18', to: '2026-10-01' }));
  assert.doesNotThrow(() => validateFilters({ from: '2026-01-01' }));
});
test('source reading uses host fetch and respects response errors and truncation', async () => {
  const signal = new AbortController().signal;
  const web = { async fetch({ url }, receivedSignal) { assert.equal(receivedSignal, signal); return { url, statusCode: 200, body: { kind: 'text', content: '政策正文'.repeat(20000) }, truncated: true }; } };
  const page = await readSource(web, 'https://park.example/policy', 'auto', signal);
  assert.equal(page.text.length, 60000); assert.equal(page.truncated, true);
  await assert.rejects(() => readSource({ fetch: async () => ({ url: page.url, statusCode: 403 }) }, page.url), /403/);
  await assert.rejects(() => readSource(null, page.url), /DSH 网页读取/);
  await assert.rejects(() => readSource(web, page.url, 'auto', AbortSignal.abort()), /abort/i);
});
test('document schema rejects malformed table rows and formula objects', () => {
  assert.throws(() => validateDocument({ title: '' }));
  assert.throws(() => validateDocument({ title: '表格', tables: [{ name: '数据', columns: ['A'], rows: [[1, 2]] }] }));
  assert.throws(() => validateDocument({ title: '表格', tables: [{ name: '数据', columns: ['A'], rows: [[{ formula: '1+1' }]] }] }));
});
test('standalone XLSX preserves numbers and formula-like strings, with safe unique sheet names', async () => {
  const doc = structuredClone(officeDocument);
  doc.tables.push({ name: '统计/表', columns: ['文字'], rows: [['=HYPERLINK("https://example.com")']] });
  doc.tables.push({ name: '统计/表', columns: ['文字'], rows: [['第二张表']] });
  const book = new ExcelJS.Workbook(); await book.xlsx.load(await exportDocument(doc, 'xlsx'));
  assert.equal(book.getWorksheet('费用明细').getCell('B2').value, 1200);
  assert.equal(book.getWorksheet('统计 表').getCell('A2').type, ExcelJS.ValueType.String);
  assert.equal(book.getWorksheet('统计 表 (2)').getCell('A2').value, '第二张表');
});
test('policy composition keeps evidence, failures and legacy fictional labels', async () => {
  const result = { request: { query: '测试', mode: 'demo' }, asOf: '2026-10-18', records: [record()], status: 'partial', errors: [{ stage: 'read', url: 'https://park.example/bad', message: 'HTTP 403' }] };
  const doc = policyDocument(result, 'xlsx');
  const book = new ExcelJS.Workbook(); await book.xlsx.load(await exportDocument(doc, 'xlsx'));
  assert.equal(book.worksheets.length, 4);
  assert.match(book.getWorksheet('字段证据').getCell('D2').value, /虚构/);
  assert.equal(book.getWorksheet('未完成来源').getCell('C2').value, 'HTTP 403');
  assert.match(policyDocument(result, 'docx').title, /旧版虚构/);
});
test('all formats generate independently and cancellation prevents success', async () => {
  for (const format of ['xlsx', 'docx', 'pdf', 'json']) {
    const bytes = await exportDocument(officeDocument, format);
    assert.ok(bytes.length > 100);
    if (format !== 'json') assert.equal(bytes.subarray(0, format === 'pdf' ? 5 : 2).toString(), format === 'pdf' ? '%PDF-' : 'PK');
    else assert.equal(JSON.parse(bytes).title, officeDocument.title);
  }
  await assert.rejects(() => exportDocument(officeDocument, 'pdf', AbortSignal.abort()), /abort/i);
});

test('binary PDF reader extracts actual Chinese text, including short documents', async () => {
  const data = await exportDocument({ title: '读取测试' }, 'pdf');
  const fetcher = new SafeFetcher(); fetcher.checkRobots = async () => {};
  fetcher.raw = async () => ({ url: 'https://park.example/test.pdf', status: 200, headers: { 'content-type': 'application/pdf' }, data });
  const page = await fetcher.page('https://park.example/test.pdf');
  assert.match(page.text, /读取测试/); assert.equal(page.truncated, false);
});

test('PDF without extractable text reports the OCR boundary instead of an empty success', async () => {
  const pdf = new PDFDocument(), chunks = [];
  const done = new Promise(resolve => { pdf.on('data', c => chunks.push(c)); pdf.on('end', resolve); });
  pdf.end(); await done;
  const fetcher = new SafeFetcher(); fetcher.checkRobots = async () => {};
  fetcher.raw = async () => ({ url: 'https://park.example/blank.pdf', status: 200, headers: { 'content-type': 'application/pdf' }, data: Buffer.concat(chunks) });
  await assert.rejects(() => fetcher.page('https://park.example/blank.pdf'), /OCR/);
});
