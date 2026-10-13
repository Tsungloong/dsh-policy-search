import { defineTool } from '@deepseek-ai/dsh-tools';
import { homedir } from 'node:os';
import path from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PolicyEngine } from './engine.js';
import { startWorkbench } from './server.js';
import { listDshModels, generateDsh } from './dsh-adapter.js';
import { exportBrief, FORMATS } from './export.js';

export const name = 'policy-search';
export const inject = ['tools'];

export function apply(ctx, config = {}) {
  const dataDir = path.resolve(config.dataDir || path.join(process.env.DSH_HOME || path.join(homedir(), '.dsh'), 'policy-search'));
  const allowedHosts = config.allowedHosts ?? [];
  if (!Array.isArray(allowedHosts) || allowedHosts.some(h => typeof h !== 'string' || !/^[a-z0-9.-]+$/.test(h))) throw new Error('allowedHosts 必须是域名数组');
  ctx.inject(['skills'], skillCtx => {
    for (const skillName of ['policy-search', 'policy-office']) {
      const directory = fileURLToPath(new URL(`../skills/${skillName}/`, import.meta.url));
      const raw = readFileSync(path.join(directory, 'SKILL.md'), 'utf8');
      const description = /^description: (.+)$/m.exec(raw)[1];
      skillCtx.skills.register({ name: skillName, description, source: 'bundled', resourceBase: { kind: 'directory', path: directory }, content: raw.replace(/^---\n[\s\S]*?\n---\n/, '') });
    }
  });
  let engine, workbench;
  const ready = (async () => {
    engine = new PolicyEngine({ dataDir, allowedHosts, dnsResolver: config.dnsResolver, demo: true,
      model: args => generateDsh(ctx.get('llm'), args),
      search: (request, signal) => {
        const web = ctx.get('web'); if (!web) throw new Error('DSH 网页搜索服务未安装，将尝试官网目录');
        return web.search(request, signal);
      } });
    await engine.init();
    workbench = await startWorkbench({ engine, models: () => listDshModels(ctx.get('llm')), port: config.port ?? 0 });
    return { engine, workbench };
  })();
  // The rejection remains visible through each tool, while avoiding unhandled promises.
  ready.catch(err => ctx.logger?.warn?.(`政策工作台启动失败：${err.message}`));
  ctx.effect(() => async () => { try { await ready; await workbench.close(); } catch { /* Failed startup has no listener to close. */ } });
  const add = (toolName, description, parameters, execute) => ctx.tools.register(defineTool({ name: toolName, description, parameters,
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { await ready; return JSON.stringify(await execute(args)); },
  }));
  add('policy_workbench', '打开企业扶持政策工作台，查看可用模型、来源、历史任务。返回本机带访问令牌的链接，勿向外部发送。', {}, async () => ({ url: workbench.url, models: await listDshModels(ctx.get('llm')), dataDir }));
  add('policy_search', '搜索中国政府/园区企业扶持政策并生成证据简报。只在用户请求搜索时调用；使用用户选定的 DSH 模型，会访问官网及模型服务。request 为 JSON 字符串：query、provider、model 必填；urls 可直接指定；limit 1-30；filters 包含 region/industry/policyType/level/from/to。返回任务 ID，随后用 policy_job 查询。', { request: { type: 'string', required: true, description: '检索请求 JSON，默认真实检索；不要擅自使用 demo 模式' } }, async args => engine.start(JSON.parse(args.request)));
  add('policy_job', '查询或取消本插件创建的检索任务。保留错误、证据和覆盖范围，不把部分完成描述为全部成功。', { id: { type: 'string', required: true }, cancel: { type: 'boolean' } }, async args => { if (args.cancel) engine.cancel(args.id); return engine.summary(engine.get(args.id)); });
  add('policy_office', '读取内置开源办公制作技能或导出已有政策任务为 XLSX/DOCX/PDF/JSON。action=guide 返回适配技能及对应格式参考；action=export 生成文件并返回本地路径。不会更改原始政策。', {
    action: { type: 'string', required: true, enum: ['guide', 'export'] }, format: { type: 'string', required: true, enum: ['xlsx', 'docx', 'pdf', 'json'] }, id: { type: 'string', description: 'export 时必填，政策任务 ID' },
  }, async args => {
    if (args.action === 'guide') {
      const guide = await readFile(new URL('../skills/policy-office/SKILL.md', import.meta.url), 'utf8');
      const ref = { xlsx: 'excel', docx: 'word', pdf: 'pdf' }[args.format];
      return { guide, formatReference: ref ? await readFile(new URL(`../skills/policy-office/upstream/references/${ref}.md`, import.meta.url), 'utf8') : 'JSON 保留完整来源正文与模型提取记录。' };
    }
    if (!args.id || !Object.hasOwn(FORMATS, args.format)) throw new Error('导出须提供任务 ID 和支持的格式');
    const job = engine.get(args.id), dir = path.join(dataDir, 'exports'); await mkdir(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `policy-${job.id}-${Date.now()}.${args.format}`);
    await writeFile(file, await exportBrief(job, args.format), { mode: 0o600 }); return { file, format: args.format, count: job.records.length, status: job.status };
  });
}
