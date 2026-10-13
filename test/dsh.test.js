import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import SkillRegistry from '@deepseek-ai/dsh-skill';
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm';
import * as plugin from '../src/index.js';
import { generateDsh } from '../src/dsh-adapter.js';

test('official Cordis loads plugin, registers four tools and two skills, exports and disposes listener', async () => {
  const ctx = new Context(), fibers = [], dir = await mkdtemp(path.join(tmpdir(), 'policy-dsh-'));
  const mount = async (mod, config) => { const f = ctx.plugin(mod, config); fibers.push(f); await f.await(); return f; };
  let url;
  try {
    await mount(SystemPrompt); await mount(ToolRuntime); await mount(SkillRegistry); await mount(LlmRuntime);
    class Fixture extends LlmAdapter {
      async listModels(provider) { return [{ provider, id: 'fixture', name: 'Fixture (no external calls)' }]; }
      async *stream() { yield { type: 'text-delta', index: 0, text: '{"isPolicy":false}' }; yield { type: 'finish', reason: { kind: 'stop' } }; }
    }
    await mount({ name: 'policy-test-adapter', inject: ['llm'], apply(c) { c.llm.registerAdapter(['fixture'], new Fixture()); } });
    await mount(plugin, { dataDir: dir });
    const call = async (name, args) => JSON.parse(await ctx.tools.get(name).execute(args, {}));
    const workbench = await call('policy_workbench', {}); url = workbench.url;
    assert.equal(workbench.models[0].id, 'fixture');
    assert.deepEqual((await ctx.skills.list()).map(s => s.name).sort(), ['policy-office', 'policy-search']);
    const guide = await call('policy_office', { action: 'guide', format: 'xlsx' }); assert.match(guide.formatReference, /Excel/);
    const result = await generateDsh(ctx.llm, { provider: 'fixture', model: 'fixture', prompt: 'extract', signal: new AbortController().signal }); assert.equal(JSON.parse(result).isPolicy, false);
    const { id } = await call('policy_search', { request: JSON.stringify({ query: '演示', mode: 'demo' }) });
    let job;
    for (let i = 0; i < 100; i++) { job = await call('policy_job', { id }); if (job.status !== 'running') break; await new Promise(r => setTimeout(r, 10)); }
    assert.equal(job.status, 'completed'); assert.equal(job.records.length, 2);
    const file = await call('policy_office', { action: 'export', format: 'docx', id }); assert.ok(file.file.startsWith(dir));
  } finally { for (const f of fibers.reverse()) await f.dispose(); await rm(dir, { recursive: true, force: true }); }
  await assert.rejects(() => fetch(url.split('#')[0]));
});
