import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { dateValue, canonicalUrl, validateExtraction, deduplicate, filterRecords, parseModelJson } from '../src/policy.js';
import { validateUrl, isPublicAddress, extractHtml } from '../src/fetcher.js';
import { PolicyEngine, validateRequest } from '../src/engine.js';
import { demoPages, demoExtract } from '../src/demo.js';
import { exportBrief } from '../src/export.js';
import { startWorkbench } from '../src/server.js';
import { generateDsh } from '../src/dsh-adapter.js';

const page = demoPages[0];
const record = () => validateExtraction(demoExtract(page), page, '2026-10-13');
async function engineFixture(options = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'policy-test-'));
  const engine = new PolicyEngine({ dataDir, demo: true, ...options }); await engine.init();
  return { engine, dataDir, close: async () => { await engine.close(); await rm(dataDir, { recursive: true, force: true }); } };
}
async function finished(engine, id) { await engine.pending.get(id); return engine.get(id); }

test('dates reject impossible values and normalize Chinese dates', () => {
  assert.equal(dateValue('截止2026年2月28日'), '2026-02-28'); assert.equal(dateValue('2026年2月30日'), null); assert.equal(dateValue('长期有效'), null);
});
test('date roles remain separate and deadline day remains not-past', () => {
  const r = record(); assert.equal(r.fields.publishedDate.value, '2026-10-01'); assert.equal(r.fields.deadline.value, '2026-11-30');
  assert.equal(validateExtraction(demoExtract(page), page, '2026-11-30').deadlineStatus, '尚未到申报截止日期');
  assert.equal(validateExtraction(demoExtract(page), page, '2026-12-01').deadlineStatus, '已过申报截止日期');
});
test('invented fields and missing evidence are cleared', () => {
  const raw = demoExtract(page); raw.fields.subsidy = { value: '100万元', evidence: '补贴100万元' };
  const r = validateExtraction(raw, page); assert.equal(r.fields.subsidy.value, null); assert.ok(r.warnings.length);
});
test('amount rewrites fall back to the source quote', () => {
  const raw = demoExtract(page); raw.fields.subsidy.value = '保证返还100%';
  assert.equal(validateExtraction(raw, page).fields.subsidy.value, raw.fields.subsidy.evidence);
});
test('publication dates cannot be promoted to application deadlines', () => {
  const raw = demoExtract(page); raw.fields.deadline = raw.fields.publishedDate;
  assert.equal(validateExtraction(raw, page).fields.deadline.value, null);
});
test('ambiguous multi-round deadlines become unknown', () => {
  const source = { ...page, text: `${page.text}\n第一批截止2026年10月1日，第二批截止2026年11月30日。` };
  const raw = demoExtract(page); raw.fields.deadline.evidence = '第一批截止2026年10月1日，第二批截止2026年11月30日。';
  raw.fields.deadline.value = '2026-10-01'; assert.equal(validateExtraction(raw, source).fields.deadline.value, null);
});
test('non-policy pages are excluded and malformed output rejected', () => { assert.equal(validateExtraction({ isPolicy: false }, page), null); assert.throws(() => validateExtraction({}, page)); assert.throws(() => parseModelJson('not json')); });
test('canonical URLs preserve meaningful queries and deduplicate text', () => {
  assert.equal(canonicalUrl('https://www.gov.cn/a?id=1&utm_source=x#fragment'), 'https://www.gov.cn/a?id=1');
  const a = record(), b = { ...a, sourceUrl: 'https://www.gov.cn/reprint' };
  const deduped = deduplicate([a, a, b]); assert.equal(deduped.length, 1); assert.equal(deduped[0].alternateSources.length, 1);
});
test('filters exclude unknown publication dates and preserve matching fields', () => {
  assert.equal(filterRecords([record()], { region: '示例市' }).length, 1); assert.equal(filterRecords([record()], { industry: '软件' }).length, 0);
  const r = record(); r.fields.publishedDate.value = null; assert.equal(filterRecords([r], { from: '2026-01-01' }).length, 0);
});
test('network source boundaries reject lookalikes, internal IPs and credentials', () => {
  for (const url of ['https://gov.cn.evil.com/a', 'file:///etc/passwd', 'http://127.0.0.1', 'https://u:p@www.gov.cn', 'https://www.gov.cn:8888']) assert.throws(() => validateUrl(url));
  assert.equal(validateUrl('https://www.gov.cn').hostname, 'www.gov.cn'); assert.equal(validateUrl('https://park.example', ['park.example']).hostname, 'park.example');
  for (const ip of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1', '100.64.0.1']) assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress('8.8.8.8'), true);
});
test('HTML extraction removes script/instructions markup and preserves article text', () => {
  const p = extractHtml('<html><title>政策标题</title><body><nav>导航</nav><article><p>企业补贴条件</p><script>steal()</script><p>申报截止</p></article><a href="/doc.pdf">附件</a></body></html>', 'https://www.gov.cn/a');
  assert.equal(p.title, '政策标题'); assert.ok(!p.text.includes('steal')); assert.ok(!p.text.includes('导航')); assert.equal(p.links[0].url, 'https://www.gov.cn/doc.pdf');
});
test('request validation bounds work and rejects malformed dates', () => {
  assert.throws(() => validateRequest({ query: 'test', limit: 31 })); assert.throws(() => validateRequest({ query: '' })); assert.throws(() => validateRequest({ query: 'test', sources: ['bogus'] }));
  assert.throws(() => validateRequest({ query: 'test', filters: { from: '2026-10-15', to: '2026-10-01' } }));
});
test('live pipeline persists exact model input, handles one failed source and records partial state', async () => {
  const fixture = await engineFixture({ fetcher: { allowedHosts: [], page: async url => { if (url.endsWith('bad')) throw new Error('HTTP 403'); return { ...page, url }; } }, model: async () => JSON.stringify(demoExtract(page)) });
  try {
    const { id } = await fixture.engine.start({ query: '稳岗', provider: 'fixture', model: 'fixture', urls: ['https://www.gov.cn/good', 'https://www.gov.cn/bad'] });
    const job = await finished(fixture.engine, id); assert.equal(job.status, 'partial'); assert.equal(job.records.length, 1); assert.equal(job.errors.length, 1);
    const saved = JSON.parse(await readFile(path.join(fixture.dataDir, `${id}.json`))); assert.ok(saved.audit[0].prompt.includes(page.text.split('\n')[0])); assert.ok(saved.audit[0].response);
  } finally { await fixture.close(); }
});
test('search failure is visible even when directory fallback works', async () => {
  let count = 0;
  const f = await engineFixture({ search: async () => { throw new Error('search offline'); }, fetcher: { allowedHosts: [], page: async url => ++count === 1 ? { ...page, url, links: [{ url: 'https://www.gov.cn/good', title: '企业补贴政策' }] } : { ...page, url } }, model: async () => JSON.stringify(demoExtract(page)) });
  try { const j = await f.engine.start({ query: '补贴', provider: 'fixture', model: 'fixture' }); const done = await finished(f.engine, j.id); assert.equal(done.status, 'partial'); assert.match(done.coverage, /目录/); assert.match(done.errors[0].message, /offline/); } finally { await f.close(); }
});
test('cancellation stops model processing and settles the task', async () => {
  const f = await engineFixture({ fetcher: { allowedHosts: [], page: async url => ({ ...page, url }) }, model: ({ signal }) => new Promise((resolve, reject) => { if (signal.aborted) reject(signal.reason); else signal.addEventListener('abort', () => reject(signal.reason), { once: true }); }) });
  try { const j = await f.engine.start({ query: '稳岗', provider: 'fixture', model: 'fixture', urls: ['https://www.gov.cn/good'] }); f.engine.cancel(j.id); const done = await finished(f.engine, j.id); assert.equal(done.status, 'cancelled'); } finally { await f.close(); }
});
test('initial persistence failure does not consume a job or concurrency slot', async () => {
  const f = await engineFixture();
  try {
    await rm(f.dataDir, { recursive: true });
    await assert.rejects(() => f.engine.start({ query: '演示', mode: 'demo' }), /任务保存失败/);
    assert.equal(f.engine.controllers.size, 0); assert.equal(f.engine.jobs.size, 0);
  } finally { await f.close(); }
});
test('DSH stream adapter rejects failures and truncated output', async () => {
  const args = { provider: 'x', model: 'x', prompt: 'extract', signal: new AbortController().signal };
  const llm = reason => ({ async *stream() { yield { type: 'text-delta', text: '{"ok":true}' }; yield { type: 'finish', reason }; } });
  assert.equal(await generateDsh(llm({ kind: 'stop' }), args), '{"ok":true}');
  await assert.rejects(() => generateDsh(llm({ kind: 'max-tokens' }), args)); await assert.rejects(() => generateDsh(llm({ kind: 'error', failure: { message: 'credential missing' } }), args), /credential missing/);
});
test('workbench requires bearer token, rejects cross-origin writes and exports real files', async () => {
  const f = await engineFixture(), app = await startWorkbench({ engine: f.engine });
  const base = app.url.split('/#')[0], headers = { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(`${base}/api/jobs`)).status, 401);
    assert.equal((await fetch(`${base}/api/jobs`, { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' }, body: '{}' })).status, 403);
    const res = await fetch(`${base}/api/jobs`, { method: 'POST', headers, body: JSON.stringify({ query: '演示政策', mode: 'demo' }) }); assert.equal(res.status, 202);
    const { id } = await res.json(); const job = await finished(f.engine, id); assert.equal(job.records.length, 2);
    for (const format of ['xlsx', 'docx', 'pdf']) { const file = await fetch(`${base}/api/jobs/${id}/export?format=${format}`, { headers }); assert.equal(file.status, 200); const bytes = Buffer.from(await file.arrayBuffer()); assert.equal(bytes.subarray(0, format === 'pdf' ? 5 : 2).toString(), format === 'pdf' ? '%PDF-' : 'PK'); }
  } finally { await app.close(); await f.close(); }
});
test('Excel stores potentially executable text as a string, with evidence and source sheets', async () => {
  const f = await engineFixture();
  try {
    const j = await f.engine.start({ query: 'demo', mode: 'demo' }), job = await finished(f.engine, j.id); job.records[0].fields.name.value = '=HYPERLINK("https://evil.example")';
    const book = new ExcelJS.Workbook(); await book.xlsx.load(await exportBrief(job, 'xlsx'));
    assert.equal(book.worksheets.length, 4); assert.equal(book.getWorksheet('政策汇总').getCell('A2').type, ExcelJS.ValueType.String); assert.match(book.getWorksheet('字段证据').getCell('D2').value, /虚构/);
  } finally { await f.close(); }
});
