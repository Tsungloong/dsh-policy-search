import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFile, readdir } from 'node:fs/promises';
import { officeDocument, fixturePages, fixtureExtract } from '../test/fixtures.js';

const profileDir = path.resolve(process.argv[2]);
const anchor = path.join(profileDir, 'package.json');
const require = createRequire(anchor);
const installed = name => import(pathToFileURL(require.resolve(name)));
const { loadProfileDirectory, readProfilePlugins, evaluatePluginCompatibility } = await installed('@deepseek-ai/dsh-app-boot');
const profile = loadProfileDirectory('dsh', profileDir, anchor);
assert.deepEqual(profile.skippedBundles, []);
assert.equal(profile.layers.length, 1);
const inventory = readProfilePlugins({ binName: 'dsh', profileDir, installAnchor: anchor });
const entry = inventory.dependencies.find(item => item.name === 'dsh-policy-search');
assert.deepEqual(entry, { name: 'dsh-policy-search', version: '0.2.0', bundle: true, enabled: true });
const directory = profile.layers[0].packageDir;
const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
assert.equal(evaluatePluginCompatibility(manifest), undefined);
assert.equal(manifest.bin, undefined);
assert.deepEqual((await readdir(path.join(directory, 'src'))).sort(), ['export.js', 'fetcher.js', 'index.js', 'policy.js', 'search.js']);
assert.ok(!(await readdir(directory)).includes('public'));

const { Context } = await installed('@deepseek-ai/cordis');
const ctx = new Context(), fibers = [];
const mount = async (plugin, config) => { const fiber = ctx.plugin(plugin, config); fibers.push(fiber); await fiber.await(); };
process.env.DSH_HOME = path.join(profileDir, 'isolated-home');
let sequence = 0;
const call = async (name, args) => {
  const result = await ctx.tools.execute({ callId: `packed-${++sequence}`, name, arguments: args, signal: new AbortController().signal });
  if (result.isError) throw new Error(result.error.message);
  return result.value;
};
const outputs = [];
try {
  for (const name of ['@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-skill']) await mount((await installed(name)).default);
  const insertion = profile.layers[0].patches.flatMap(patch => patch.insert ?? [])[0];
  assert.equal(insertion.name, 'dsh-policy-search'); assert.deepEqual(insertion.config, {});
  await mount(await installed(insertion.name), insertion.config);
  assert.equal(ctx.get('llm'), undefined); assert.equal(ctx.get('web'), undefined);
  assert.deepEqual((await ctx.skills.list()).map(s => s.name).sort(), ['policy-office', 'policy-search']);
  for (const format of ['xlsx', 'docx', 'pdf']) outputs.push(await call('policy_office', { document: officeDocument, format }));

  await mount((await installed('@deepseek-ai/dsh-web')).default, {});
  const page = fixturePages[0];
  ctx.web.registerSearchProvider({ id: 'verification', available: () => true, search: async () => ({ sources: [{ url: page.url, title: page.title }], truncated: false }) });
  ctx.web.registerFetchProvider({ id: 'verification', available: () => true, fetch: async ({ url }) => ({ url, statusCode: 200, body: { kind: 'text', content: page.text }, truncated: false }) });
  const search = await call('policy_search', { query: '测试政策' });
  const source = await call('policy_read', { url: search.sources[0].url });
  const result = await call('policy_check', { query: '测试政策', items: [{ sourceId: source.sourceId, extraction: fixtureExtract(page) }] });
  assert.equal(result.records.length, 1);
  for (const format of ['xlsx', 'docx', 'pdf']) outputs.push(await call('policy_office', { id: result.id, format }));
  const { SafeFetcher } = await import(pathToFileURL(path.join(directory, 'src/fetcher.js')));
  const fetcher = new SafeFetcher(); fetcher.checkRobots = async () => {};
  const pdf = await readFile(outputs[2].file);
  fetcher.raw = async () => ({ url: 'https://example.com/report.pdf', status: 200, headers: { 'content-type': 'application/pdf' }, data: pdf });
  assert.match((await fetcher.page('https://example.com/report.pdf')).text, /企业服务月度报告/);
  for (const output of outputs) assert.equal((await readFile(output.file)).length, output.bytes);
  console.log(JSON.stringify({ profileDir, installed: entry, skippedBundles: 0, emptyConfigLoaded: true, modelServiceRequired: false,
    standaloneFormats: ['xlsx', 'docx', 'pdf'], composedFormats: ['xlsx', 'docx', 'pdf'], pdfTextRead: true, outputs }, null, 2));
} finally { for (const fiber of fibers.reverse()) await fiber.dispose(); }
