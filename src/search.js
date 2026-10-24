import { canonicalUrl, dateValue } from './policy.js';
import { validateUrl, sourceKind } from './fetcher.js';

export function validateFilters(filters = {}) {
  for (const key of ['from', 'to']) {
    if (filters[key] && (dateValue(filters[key]) !== filters[key])) throw new Error(`${key} 须为有效的 YYYY-MM-DD 日期`);
  }
  if (filters.from && filters.to && filters.from > filters.to) throw new Error('开始日期不能晚于结束日期');
  return filters;
}

export async function searchPolicies(web, { query, limit = 8, filters = {} }, signal) {
  if (!query.trim()) throw new Error('请提供检索主题');
  if (!Number.isInteger(limit) || limit < 1 || limit > 30) throw new Error('limit 须为 1–30 的整数');
  validateFilters(filters);
  if (!web) throw new Error('DSH 搜索服务不可用；请在宿主配置搜索服务，或直接用 policy_read 读取已知网址。');
  signal?.throwIfAborted();
  const terms = [query, ...['region', 'industry', 'level', 'policyType'].map(k => filters[k]).filter(Boolean), '政策 政府 园区 申报'];
  if (filters.from) terms.push(`after:${filters.from}`);
  if (filters.to) terms.push(`before:${filters.to}`);
  const result = await web.search({ query: terms.join(' '), maxResults: limit }, signal);
  signal?.throwIfAborted();
  const seen = new Set(), sources = [], rejected = [];
  for (const source of result.sources) {
    try {
      const url = canonicalUrl(validateUrl(source.url).href);
      if (seen.has(url)) continue;
      seen.add(url);
      sources.push({ ...source, url, sourceKind: sourceKind(url) });
    } catch (error) { rejected.push({ url: source.url, reason: error.message }); }
  }
  return { query, filters, sources: sources.slice(0, limit), rejected, truncated: result.truncated,
    coverage: '宿主搜索返回的候选来源；日期与发布主体需在原文中核对，不代表穷尽全部政策。' };
}
