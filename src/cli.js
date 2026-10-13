#!/usr/bin/env node
import path from 'node:path';
import { PolicyEngine } from './engine.js';
import { startWorkbench } from './server.js';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('用法：dsh-policy-search --demo [--port 8765] [--data-dir 路径]\n真实检索请安装至 DSH，通过宿主模型与网页搜索服务运行。'); process.exit(0);
}
if (!args.includes('--demo')) {
  console.error('独立启动仅提供 --demo 演示。真实搜索请使用 DSH 插件，以沿用宿主模型配置。'); process.exit(1);
}
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const port = Number(option('--port') ?? 8765);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('端口无效');
const engine = new PolicyEngine({ dataDir: path.resolve(option('--data-dir') || '.policy-data'), demo: true });
await engine.init();
const app = await startWorkbench({ engine, port });
console.log(`政策工作台（虚构演示模式）\n${app.url}\n按 Ctrl+C 停止。真实检索需安装 DSH 插件。`);
let closing = false;
const close = async () => { if (closing) return; closing = true; await app.close(); };
process.once('SIGINT', close); process.once('SIGTERM', close);
