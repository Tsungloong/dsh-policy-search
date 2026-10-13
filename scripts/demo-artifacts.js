import { mkdir, writeFile } from 'node:fs/promises';
import { PolicyEngine } from '../src/engine.js';
import { exportBrief } from '../src/export.js';
await mkdir('output/verification', { recursive: true });
const engine = new PolicyEngine({ dataDir: 'output/verification/jobs', demo: true }); await engine.init();
const { id } = await engine.start({ query: '中小企业稳岗补贴与场地减免', mode: 'demo' }); await engine.pending.get(id);
for (const format of ['xlsx', 'docx', 'pdf', 'json']) await writeFile(`output/verification/政策简报-虚构演示.${format}`, await exportBrief(engine.get(id), format));
console.log(JSON.stringify({ id, status: engine.get(id).status, records: engine.get(id).records.length, directory: 'output/verification' }));
await engine.close();
