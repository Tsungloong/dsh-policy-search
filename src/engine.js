import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { SOURCES, POLICY_WORDS } from './sources.js';
import { SafeFetcher, validateUrl } from './fetcher.js';
import { canonicalUrl, extractionPrompt, parseModelJson, validateExtraction, deduplicate, filterRecords, today } from './policy.js';

export function validateRequest(input) {
  if (!input || typeof input !== 'object') throw new Error('检索参数必须为对象');
  const query = String(input.query ?? '').trim();
  if (!query || query.length > 200) throw new Error('请输入 1–200 字的检索主题');
  const limit = input.limit ?? 8;
  if (!Number.isInteger(limit) || limit < 1 || limit > 30) throw new Error('处理数量须为 1–30');
  const urls = input.urls ?? [];
  if (!Array.isArray(urls) || urls.length > 30 || urls.some(u => typeof u !== 'string' || u.length > 2000)) throw new Error('最多提供 30 个来源地址');
  const sources = input.sources ?? ['central'];
  if (!Array.isArray(sources) || sources.some(id => !SOURCES.some(s => s.id === id))) throw new Error('未知来源目录');
  const filters = {};
  for (const key of ['region', 'industry', 'policyType', 'level', 'from', 'to']) {
    if (input.filters?.[key]) {
      if (typeof input.filters[key] !== 'string' || input.filters[key].length > 100) throw new Error('筛选条件无效');
      filters[key] = input.filters[key].trim();
    }
  }
  for (const k of ['from', 'to']) if (filters[k] && !/^\d{4}-\d{2}-\d{2}$/.test(filters[k])) throw new Error('日期筛选须为 YYYY-MM-DD');
  if (filters.from && filters.to && filters.from > filters.to) throw new Error('开始日期不能晚于结束日期');
  return { query, limit, urls, sources, filters, provider: String(input.provider ?? '').slice(0, 100), model: String(input.model ?? '').slice(0, 200), mode: input.mode === 'demo' ? 'demo' : 'live' };
}

export class PolicyEngine {
  constructor({ dataDir, model, search, allowedHosts, dnsResolver, demo = false, fetcher } = {}) {
    this.dataDir = dataDir; this.model = model; this.search = search; this.demo = demo;
    this.fetcher = fetcher ?? new SafeFetcher({ allowedHosts, dnsResolver });
    this.jobs = new Map(); this.controllers = new Map(); this.pending = new Map();
  }
  async init() {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    const names = (await readdir(this.dataDir)).filter(x => /^[a-f0-9-]{36}\.json$/.test(x));
    const entries = [];
    for (const name of names) {
      try {
        const job = JSON.parse(await readFile(path.join(this.dataDir, name), 'utf8'));
        if (job.status === 'running') { job.status = 'interrupted'; job.error = '宿主已重启，该任务中断，可重新发起'; }
        if (job.id && job.createdAt) entries.push(job);
      } catch { /* A damaged history file is left untouched, never presented as a valid job. */ }
    }
    entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100).forEach(j => this.jobs.set(j.id, j));
  }
  async persist(job) {
    const file = path.join(this.dataDir, `${job.id}.json`), tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(job, null, 2), { mode: 0o600 }); await rename(tmp, file);
  }
  async start(input) {
    const request = validateRequest(input);
    if (this.controllers.size >= 2) throw new Error('已有两个任务运行，请等待或取消后重试');
    if (request.mode === 'demo' && !this.demo) throw new Error('当前实例未启用演示数据');
    if (request.mode === 'live' && (!this.model || !request.provider || !request.model)) throw new Error('请先在 DSH 配置模型，并在工作台选择模型');
    for (const url of request.urls) validateUrl(url, this.fetcher.allowedHosts);
    const job = { id: randomUUID(), request, createdAt: new Date().toISOString(), asOf: today(), status: 'running', progress: '正在准备', records: [], errors: [], audit: [], pages: [], processed: 0, total: 0, coverage: '' };
    this.jobs.set(job.id, job);
    const controller = new AbortController(); this.controllers.set(job.id, controller);
    try { await this.persist(job); }
    catch (error) { this.controllers.delete(job.id); this.jobs.delete(job.id); throw new Error(`任务保存失败，尚未开始处理：${error.message}`); }
    const pending = this.run(job, controller.signal).catch(async err => {
      job.status = controller.signal.aborted ? 'cancelled' : 'failed'; job.error = err.message;
      job.finishedAt = new Date().toISOString(); await this.persist(job);
    }).finally(() => { this.controllers.delete(job.id); this.pending.delete(job.id); });
    // Observe persistence failures without an unhandled rejection; expose them in job state.
    pending.catch(err => { job.status = 'failed'; job.error = `任务保存失败：${err.message}`; });
    this.pending.set(job.id, pending);
    return this.summary(job);
  }
  summary(job) {
    const { pages, audit, records, ...rest } = job;
    return { ...rest, records: records.map(({ text, ...r }) => r), auditCount: audit.length, pageCount: pages.length };
  }
  get(id) { const job = this.jobs.get(id); if (!job) throw new Error('任务不存在'); return job; }
  list() { return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100).map(j => ({ id: j.id, query: j.request.query, createdAt: j.createdAt, status: j.status, count: j.records.length, mode: j.request.mode })); }
  cancel(id) { this.get(id); this.controllers.get(id)?.abort(new Error('用户取消任务')); }
  async close() { for (const c of this.controllers.values()) c.abort(new Error('宿主关闭')); await Promise.allSettled([...this.pending.values()]); }
  async run(job, signal) {
    if (job.request.mode === 'demo') {
      const { demoPages, demoExtract } = await import('./demo.js');
      for (const page of demoPages) job.records.push(validateExtraction(demoExtract(page), page, job.asOf));
      job.pages = demoPages; job.records = filterRecords(job.records, job.request.filters);
      job.coverage = '虚构演示数据；没有执行网络搜索或外部模型调用';
      job.total = job.processed = demoPages.length; job.status = 'completed'; job.progress = '演示简报已生成';
      job.finishedAt = new Date().toISOString(); await this.persist(job); return;
    }
    let candidates = job.request.urls.map(url => ({ url, title: '指定网址' }));
    if (!candidates.length && this.search) {
      job.progress = '正在检索官方来源';
      const domains = ['gov.cn', ...this.fetcher.allowedHosts].map(h => `site:${h}`).join(' OR ');
      const query = `${job.request.query} ${job.request.filters.region ?? ''} 企业 扶持 申报 (${domains})`;
      try {
        const result = await this.search({ query, maxResults: job.request.limit * 2 }, signal);
        job.audit.push({ type: 'search', query, sources: result.sources, at: new Date().toISOString() });
        candidates.push(...result.sources);
        job.coverage = 'DSH 网页搜索返回的官方候选；不代表全国政策穷尽覆盖';
      } catch (err) { job.errors.push({ stage: '搜索', message: err.message }); }
    }
    if (!candidates.length) {
      job.coverage = '未使用可用的全网搜索结果，仅扫描所选官网目录及直接链接';
      for (const source of SOURCES.filter(s => job.request.sources.includes(s.id))) {
        signal.throwIfAborted(); job.progress = `扫描目录：${source.name}`;
        try {
          const page = await this.fetcher.page(source.url, signal);
          job.audit.push({ type: 'directory', url: page.url, fetchedAt: page.fetchedAt });
          candidates.push(...page.links.filter(l => POLICY_WORDS.test(l.title)));
        } catch (err) { job.errors.push({ stage: '目录', url: source.url, message: err.message }); }
      }
    } else if (job.request.urls.length) job.coverage = '用户指定来源，未执行全网搜索';
    const seen = new Set();
    candidates = candidates.filter(c => {
      try {
        const u = canonicalUrl(validateUrl(c.url, this.fetcher.allowedHosts));
        if (seen.has(u)) return false; seen.add(u); c.url = u; return true;
      } catch (err) { job.errors.push({ stage: '来源校验', url: c.url, message: err.message }); return false; }
    }).slice(0, job.request.limit);
    job.total = candidates.length;
    if (!job.total) throw new Error('未发现可处理的官方政策候选。可添加具体政策网址，或配置 DSH 网页搜索服务');
    const records = [];
    for (const candidate of candidates) {
      signal.throwIfAborted(); job.progress = `处理 ${job.processed + 1}/${job.total}：${candidate.title || candidate.url}`;
      try {
        const page = await this.fetcher.page(candidate.url, signal);
        job.pages.push(page);
        const prompt = extractionPrompt(page, job.request.query);
        const entry = { type: 'extraction', url: page.url, provider: job.request.provider, model: job.request.model, prompt, at: new Date().toISOString() };
        job.audit.push(entry); await this.persist(job);
        const text = await this.model({ provider: job.request.provider, model: job.request.model, prompt, signal });
        entry.response = text;
        const record = validateExtraction(parseModelJson(text), page, job.asOf);
        if (record) records.push(record);
        else job.audit.push({ type: 'excluded', url: page.url, reason: '模型识别为非政策原文' });
      } catch (err) { job.errors.push({ stage: '正文/提取', url: candidate.url, message: err.message }); }
      job.processed++; job.records = filterRecords(deduplicate(records), job.request.filters); await this.persist(job);
    }
    signal.throwIfAborted();
    job.status = job.errors.length ? (job.records.length ? 'partial' : 'failed') : 'completed';
    job.progress = job.records.length ? '简报可导出，请核对证据与待核实项' : '没有匹配政策；请检查筛选条件和来源';
    job.finishedAt = new Date().toISOString(); await this.persist(job);
  }
}
