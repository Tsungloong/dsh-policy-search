import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import SkillRegistry from '@deepseek-ai/dsh-skill';
import WebRuntime from '@deepseek-ai/dsh-web';
import * as plugin from '../src/index.js';
import { fixturePages, fixtureExtract, officeDocument } from './fixtures.js';

async function host() {
  const ctx = new Context(), fibers = [], dir = await mkdtemp(path.join(tmpdir(), 'policy-native-'));
  const mount = async (mod, config) => { const fiber = ctx.plugin(mod, config); fibers.push(fiber); await fiber.await(); return fiber; };
  await mount(SystemPrompt); await mount(ToolRuntime); await mount(SkillRegistry);
  const fiber = await mount(plugin, { dataDir: path.join(dir, 'data') });
  let callId = 0;
  const invoke = (name, args, signal = new AbortController().signal) => ctx.tools.execute({ callId: `test-${++callId}`, name, arguments: args, signal });
  const call = async (name, args, signal) => { const result = await invoke(name, args, signal); if (result.isError) throw new Error(result.error.message); return result.value; };
  return { ctx, dir, fiber, mount, invoke, call, close: async () => { for (const fiber of fibers.reverse()) await fiber.dispose(); await rm(dir, { recursive: true, force: true }); } };
}

test('native plugin loads with no model, network or listener and office works independently', async () => {
  const h = await host();
  try {
    assert.equal(h.ctx.get('llm'), undefined); assert.equal(h.ctx.get('web'), undefined);
    assert.deepEqual(await readdir(h.dir), [], 'loading must not create runtime state');
    for (const name of ['policy_search', 'policy_read', 'policy_check', 'policy_office']) assert.ok(h.ctx.tools.get(name));
    assert.equal(h.ctx.tools.get('policy_workbench'), undefined); assert.equal(h.ctx.tools.get('policy_job'), undefined);
    assert.deepEqual((await h.ctx.skills.list()).map(s => s.name).sort(), ['policy-office', 'policy-search']);
    const guide = await h.call('policy_office', { action: 'guide', format: 'xlsx' }); assert.match(guide.formatReference, /Excel/);
    await assert.rejects(() => h.call('policy_search', { query: '补贴' }), /DSH 搜索服务/);
    for (const format of ['xlsx', 'docx', 'pdf', 'json']) {
      const result = await h.call('policy_office', { document: officeDocument, format });
      assert.equal((await readFile(result.file)).length, result.bytes); assert.ok(result.file.startsWith(path.join(h.dir, 'data', 'exports')));
    }
    await h.fiber.dispose(); assert.equal(h.ctx.tools.get('policy_office'), undefined);
  } finally { await h.close(); }
});

test('host search, source snapshot, current-agent extraction and office exports compose', async () => {
  const h = await host(), page = fixturePages[0];
  try {
    await h.mount(WebRuntime, {});
    h.ctx.web.registerSearchProvider({ id: 'fixture', available: () => true, search: async () => ({ sources: [{ url: page.url, title: page.title }], truncated: false }) });
    h.ctx.web.registerFetchProvider({ id: 'fixture', available: () => true, fetch: async ({ url }) => ({ url, statusCode: 200, body: { kind: 'text', content: page.text }, truncated: false }) });
    const search = await h.call('policy_search', { query: '稳岗补贴' }); assert.equal(search.sources.length, 1); assert.equal(search.id, undefined);
    const source = await h.call('policy_read', { url: search.sources[0].url }); assert.equal(source.text, page.text);
    const extraction = fixtureExtract(page); extraction.fields.subsidy = { value: '100万元', evidence: '伪造的补贴' };
    const result = await h.call('policy_check', { query: '稳岗补贴', items: [{ sourceId: source.sourceId, extraction }], failures: [{ url: 'https://park.example/fail', message: 'HTTP 403' }] });
    assert.equal(result.status, 'partial'); assert.equal(result.records[0].fields.subsidy.value, null);
    assert.equal(result.records[0].text, undefined);
    const saved = JSON.parse(await readFile(result.file, 'utf8')); assert.equal(saved.sources[0].text, page.text);
    for (const format of ['xlsx', 'docx', 'pdf', 'json']) {
      const file = await h.call('policy_office', { id: result.id, format }); assert.ok((await readFile(file.file)).length > 100);
      if (format === 'json') assert.equal(JSON.parse(await readFile(file.file)).sources[0].text, page.text);
    }
    assert.equal(h.ctx.get('llm'), undefined, 'plugin must not start its own model');
  } finally { await h.close(); }
});

test('native argument schemas reject malformed content; output paths cannot escape or overwrite', async () => {
  const h = await host();
  try {
    assert.equal((await h.invoke('policy_office', { format: 'xlsx', document: { title: 'bad', tables: 'wrong' } })).isError, true);
    await assert.rejects(() => h.call('policy_office', { format: 'pdf' }), /其中一项/);
    await assert.rejects(() => h.call('policy_office', { format: 'pdf', id: '../secret' }), /无效/);
    await assert.rejects(() => h.call('policy_office', { format: 'json', document: officeDocument, filename: '../escape.json' }), /filename/);
    const file = await h.call('policy_office', { format: 'json', document: officeDocument, filename: 'keep.json' });
    const before = await readFile(file.file);
    await assert.rejects(() => h.call('policy_office', { format: 'json', document: { title: 'overwrite' }, filename: 'keep.json' }), /已存在/);
    assert.deepEqual(await readFile(file.file), before);
  } finally { await h.close(); }
});

test('DSH cancellation reaches the active host fetch and produces no snapshot', async () => {
  const h = await host(), controller = new AbortController();
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  try {
    await h.mount(WebRuntime, {});
    h.ctx.web.registerFetchProvider({ id: 'wait', available: () => true, fetch: (_request, signal) => new Promise((_resolve, reject) => { started(); signal.addEventListener('abort', () => reject(signal.reason), { once: true }); }) });
    const pending = h.invoke('policy_read', { url: 'https://www.gov.cn/policy' }, controller.signal);
    await ready; controller.abort(); assert.equal((await pending).isError, true);
    assert.deepEqual(await readdir(h.dir), []);
    assert.equal((await h.invoke('policy_office', { format: 'json', document: officeDocument }, AbortSignal.abort())).isError, true);
  } finally { await h.close(); }
});

test('existing history files remain readable and are not rewritten during export', async () => {
  const h = await host();
  try {
    const first = await h.call('policy_office', { format: 'json', document: officeDocument });
    const id = '11111111-1111-4111-8111-111111111111', file = path.join(h.dir, 'data', `${id}.json`);
    const legacy = { id, request: { mode: 'demo', query: '旧任务' }, status: 'running', asOf: '2026-10-13', records: [], errors: [], pages: [{ text: '旧正文' }] };
    await writeFile(file, JSON.stringify(legacy));
    const result = await h.call('policy_office', { format: 'json', id });
    assert.deepEqual(JSON.parse(await readFile(result.file)), legacy);
    assert.deepEqual(JSON.parse(await readFile(file)), legacy);
    assert.notEqual(first.file, result.file);
  } finally { await h.close(); }
});
