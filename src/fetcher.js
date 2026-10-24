import { lookup } from 'node:dns/promises';
import { Agent, request } from 'undici';
import ipaddr from 'ipaddr.js';
import robotsParser from 'robots-parser';
import { load } from 'cheerio';
import { setTimeout as delay } from 'node:timers/promises';
import { canonicalUrl, normalize } from './policy.js';

export const USER_AGENT = 'DSHPolicySearch/0.2 (+policy research; respects robots.txt)';
export function isPublicAddress(address) {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === 'ipv6' && parsed.isIPv4MappedAddress()) parsed = parsed.toIPv4Address();
    return parsed.range() === 'unicast';
  } catch { return false; }
}
export function validateUrl(raw) {
  const u = new URL(raw);
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || (u.port && !['80', '443'].includes(u.port))) throw new Error('只允许无凭据的 HTTP(S) 公共网站地址');
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || (ipaddr.isValid(host) && !isPublicAddress(host))) throw new Error('只允许公共网站地址');
  return u;
}

export function extractHtml(html, url) {
  const $ = load(html);
  const title = normalize($('meta[name="ArticleTitle"]').attr('content') || $('h1').first().text() || $('title').text());
  const links = [];
  $('a[href]').each((_, a) => {
    try {
      const href = canonicalUrl(new URL($(a).attr('href'), url));
      if (/^https?:/.test(href)) links.push({ url: href, title: normalize($(a).text()) });
    } catch { /* Non-URL anchors cannot be fetched. */ }
  });
  $('script,style,noscript,nav,header,footer,iframe,form').remove();
  let root = $('article,.TRS_Editor,#UCAP-CONTENT,.article-content,.article_content,#zoom,.content-detail').toArray()
    .sort((a, b) => $(b).text().length - $(a).text().length)[0];
  const content = root ? $(root) : $('body');
  content.find('br').replaceWith('\n');
  content.find('p,div,li,tr,h1,h2,h3').append('\n');
  const text = content.text().split('\n').map(normalize).filter(Boolean).join('\n');
  return { title, text: text.slice(0, 60000), truncated: text.length > 60000, links };
}

export class SafeFetcher {
  constructor({ timeoutMs = 20000, maxBytes = 5 * 1024 * 1024 } = {}) {
    this.timeoutMs = timeoutMs; this.maxBytes = maxBytes;
    this.robots = new Map(); this.last = new Map();
  }
  async raw(raw, signal, maxBytes = this.maxBytes, redirects = 0, checkRobots = false) {
    const u = validateUrl(raw);
    signal?.throwIfAborted();
    const addresses = await lookup(u.hostname, { all: true });
    signal?.throwIfAborted();
    if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new Error('来源域名解析到非公共网络，已拒绝连接');
    const address = addresses[0];
    const crawlDelay = (this.robots.get(u.origin)?.getCrawlDelay('DSHPolicySearch') ?? 0) * 1000;
    if (crawlDelay > 30000) throw new Error('来源要求超过 30 秒的抓取间隔，请人工访问');
    const wait = Math.max(0, (this.last.get(u.origin) ?? 0) + Math.max(600, crawlDelay) - Date.now());
    if (wait) await delay(wait, undefined, { signal });
    this.last.set(u.origin, Date.now());
    const agent = new Agent({ connect: { lookup: (_host, options, cb) => options.all ? cb(null, [address]) : cb(null, address.address, address.family) } });
    try {
      const response = await request(u, { dispatcher: agent, method: 'GET', signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(this.timeoutMs)]),
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/pdf,text/plain;q=0.9,*/*;q=0.1', 'accept-encoding': 'identity' }, maxRedirections: 0 });
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.body.destroy();
        if (redirects >= 4 || !response.headers.location) throw new Error('网页重定向次数超限或缺少目标');
        const next = new URL(response.headers.location, u).href;
        validateUrl(next);
        if (checkRobots) await this.checkRobots(next, signal);
        return this.raw(next, signal, maxBytes, redirects + 1, checkRobots);
      }
      if (Number(response.headers['content-length']) > maxBytes) { response.body.destroy(); throw new Error('网页或附件超过大小上限'); }
      const chunks = []; let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > maxBytes) { response.body.destroy(); throw new Error('网页或附件超过大小上限'); }
        chunks.push(chunk);
      }
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') throw new Error('网站未遵循 identity 编码请求，请人工核对');
      return { url: u.href, status: response.statusCode, headers: response.headers, data: Buffer.concat(chunks) };
    } finally { await agent.close(); }
  }
  async checkRobots(url, signal) {
    const u = validateUrl(url);
    let rules = this.robots.get(u.origin);
    if (!rules) {
      const r = await this.raw(`${u.origin}/robots.txt`, signal, 512 * 1024);
      if (r.status !== 404 && r.status !== 410 && (r.status < 200 || r.status >= 300)) throw new Error(`robots.txt 无法确认（HTTP ${r.status}），暂不抓取`);
      rules = robotsParser(`${u.origin}/robots.txt`, r.status < 300 ? r.data.toString('utf8') : '');
      this.robots.set(u.origin, rules);
    }
    if (rules.isAllowed(url, 'DSHPolicySearch') === false) throw new Error('来源 robots.txt 禁止抓取该路径');
  }
  async page(url, signal) {
    await this.checkRobots(url, signal);
    let r;
    for (let attempt = 0; attempt < 2; attempt++) {
      r = await this.raw(url, signal, this.maxBytes, 0, true);
      if (![429, 502, 503, 504].includes(r.status) || attempt === 1) break;
      await delay(1500, undefined, { signal });
    }
    if (r.status < 200 || r.status >= 300) throw new Error(`网页 HTTP ${r.status}，未提取正文`);
    let doc;
    const type = r.headers['content-type'] ?? '';
    if (type.includes('application/pdf') || r.data.subarray(0, 5).toString() === '%PDF-') {
      const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const task = getDocument({ data: new Uint8Array(r.data), useSystemFonts: true, isEvalSupported: false });
      try {
        const pdf = await task.promise;
        if (pdf.numPages > 60) throw new Error('PDF 超过 60 页处理上限，请缩小范围');
        let text = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          signal?.throwIfAborted();
          const page = await pdf.getPage(i), content = await page.getTextContent();
          text += content.items.map(x => x.str + (x.hasEOL ? '\n' : ' ')).join('') + '\n';
        }
        if (!normalize(text)) throw new Error('PDF 无可提取文本，可能为扫描件，需要 OCR/人工复核');
        doc = { title: decodeURIComponent(new URL(r.url).pathname.split('/').pop()), text: text.slice(0, 60000), truncated: text.length > 60000, links: [] };
      } finally { await task.destroy(); }
    } else {
      if (!/text\/|application\/xhtml/i.test(type)) throw new Error(`不支持的正文格式：${type || '未知'}`);
      const head = r.data.subarray(0, 2048).toString();
      const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(type + ' ' + head)?.[1] ?? 'utf-8';
      let html;
      try { html = new TextDecoder(charset).decode(r.data); } catch { throw new Error(`不支持的文字编码：${charset}`); }
      doc = extractHtml(html, r.url);
      if (doc.text.length < 60 || /验证码|访问验证|安全验证|Access Denied|Checking your browser/i.test(doc.title)) throw new Error('正文不足或网站需要交互验证，请人工查看来源');
    }
    return { ...doc, url: r.url, fetchedAt: new Date().toISOString(), sourceKind: sourceKind(r.url) };
  }
}

export function sourceKind(url) {
  const host = new URL(url).hostname;
  return host === 'gov.cn' || host.endsWith('.gov.cn') ? '政府域名（仍需核对发布机关）' : '公开网站（发布主体待核对）';
}

// DSH owns HTML/text retrieval. Its current web seam does not return binary PDF,
// so only explicit PDF reads use the existing bounded binary fetcher.
export async function readSource(web, url, format = 'auto', signal) {
  const target = validateUrl(url);
  signal?.throwIfAborted();
  if (format === 'pdf' || (format === 'auto' && /\.pdf$/i.test(target.pathname))) return new SafeFetcher().page(target.href, signal);
  if (!web) throw new Error('DSH 网页读取服务不可用；请启用宿主网页读取能力。办公制作不受影响。');
  const result = await web.fetch({ url: target.href }, signal);
  signal?.throwIfAborted();
  validateUrl(result.url);
  if (result.statusCode < 200 || result.statusCode >= 300) throw new Error(`网页 HTTP ${result.statusCode}，未提取正文`);
  const body = result.body;
  if (!['html', 'text'].includes(body.kind)) throw new Error('宿主未返回网页文本；PDF 请使用 format=pdf');
  const doc = body.kind === 'html' ? extractHtml(body.content, result.url) : { title: '', text: body.content.slice(0, 60000), truncated: body.content.length > 60000, links: [] };
  if (!normalize(doc.text) || /验证码|访问验证|安全验证|Access Denied|Checking your browser/i.test(doc.title)) throw new Error('正文为空或网站需要交互验证，请查看来源');
  return { ...doc, truncated: !!(doc.truncated || result.truncated), url: result.url, fetchedAt: new Date().toISOString(), sourceKind: sourceKind(result.url) };
}
