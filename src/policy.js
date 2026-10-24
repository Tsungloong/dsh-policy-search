import { createHash } from 'node:crypto';

export const FIELD_LABELS = {
  name: '政策名称', issuer: '发布机关', region: '地区', level: '层级', industry: '行业',
  policyType: '扶持类型', eligibility: '申请条件', deadline: '申报截止日期',
  subsidy: '补贴标准', publishedDate: '发布日期', validUntil: '有效期至', statusNote: '效力说明',
};
export const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
export const hash = value => createHash('sha256').update(value).digest('hex');
export const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());

export function dateValue(text) {
  const m = String(text ?? '').match(/(20\d{2})\s*[-年/.]\s*(\d{1,2})\s*[-月/.]\s*(\d{1,2})\s*日?/);
  if (!m) return null;
  const v = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.valueOf()) && d.toISOString().startsWith(v) ? v : null;
}

export function canonicalUrl(raw) {
  const u = new URL(raw);
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|spm$|from$)/i.test(k)) u.searchParams.delete(k);
  return u.href;
}

export function validateExtraction(raw, page, asOf = today()) {
  if (!raw || typeof raw !== 'object' || typeof raw.isPolicy !== 'boolean') throw new Error('模型输出缺少 isPolicy 布尔值');
  if (!raw.isPolicy) return null;
  const body = normalize(page.text), fields = {}, warnings = [];
  for (const key of Object.keys(FIELD_LABELS)) {
    const field = raw.fields?.[key];
    const value = typeof field?.value === 'string' ? normalize(field.value).slice(0, 2000) : '';
    const evidence = typeof field?.evidence === 'string' ? normalize(field.evidence).slice(0, 3000) : '';
    if (!value || !evidence || !body.includes(evidence)) {
      fields[key] = { value: null, evidence: null, verified: false };
      if (value) warnings.push(`${FIELD_LABELS[key]}缺少可在正文定位的证据，已置空`);
      continue;
    }
    // Dates and amounts/conditions remain extractive. No model-computed amounts or dates.
    if (['deadline', 'publishedDate', 'validUntil'].includes(key)) {
      const valueDate = dateValue(value);
      const allDates = evidence.match(/20\d{2}\s*[-年/.]\s*\d{1,2}\s*[-月/.]\s*\d{1,2}\s*日?/g) ?? [];
      if (!valueDate || dateValue(evidence) !== valueDate || new Set(allDates.map(dateValue)).size !== 1 || (key === 'deadline' && !/截止|申报.*[至到]|受理.*[至到]/.test(evidence))) {
        fields[key] = { value: null, evidence, verified: false };
        warnings.push(`${FIELD_LABELS[key]}无法唯一确认完整年月日`);
        continue;
      }
      fields[key] = { value: valueDate, evidence, verified: true };
    } else if (['subsidy', 'eligibility', 'statusNote', 'name', 'issuer'].includes(key) && !evidence.includes(value)) {
      fields[key] = { value: evidence, evidence, verified: true };
      warnings.push(`${FIELD_LABELS[key]}已用原文摘录替代模型改写`);
    } else {
      fields[key] = { value, evidence, verified: true };
    }
  }
  if (!fields.name.value) {
    warnings.push('政策名称未获模型证据，使用页面标题，需复核');
    fields.name = { value: page.title || '未命名政策', evidence: null, verified: false };
  }
  const deadline = fields.deadline.value, validUntil = fields.validUntil.value;
  // This is a deadline hint, never an assertion of current legal effectiveness.
  const deadlineStatus = deadline ? (deadline < asOf ? '已过申报截止日期' : '尚未到申报截止日期') : '期限待核实';
  const expiryWarning = validUntil && validUntil < asOf ? '原文有效期已过，须核实续期文件' : null;
  if (expiryWarning) warnings.push(expiryWarning);
  if (page.truncated) warnings.push('正文超出处理上限，仅提取前段，需核对全文');
  const id = hash(canonicalUrl(page.url)).slice(0, 20);
  return {
    id, fields, sourceUrl: page.url, fetchedAt: page.fetchedAt, contentHash: hash(page.text),
    text: page.text, deadlineStatus, asOf, warnings,
    reviewStatus: '待人工复核', sourceKind: page.sourceKind ?? '发布主体待核对',
  };
}

export function deduplicate(records) {
  const seenUrls = new Set(), seenText = new Map(), out = [];
  for (const record of records) {
    const url = canonicalUrl(record.sourceUrl);
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);
    if (seenText.has(record.contentHash)) {
      seenText.get(record.contentHash).alternateSources.push(url);
      continue;
    }
    const item = { ...record, alternateSources: [] };
    out.push(item); seenText.set(item.contentHash, item);
  }
  return out.sort((a, b) => (b.fields.publishedDate.value ?? '').localeCompare(a.fields.publishedDate.value ?? ''));
}

export function filterRecords(records, filters = {}) {
  return records.filter(r => {
    for (const key of ['region', 'industry', 'policyType', 'level']) {
      if (filters[key] && !normalize(r.fields[key]?.value).includes(filters[key])) return false;
    }
    const d = r.fields.publishedDate.value;
    if (filters.from && (!d || d < filters.from)) return false;
    if (filters.to && (!d || d > filters.to)) return false;
    return true;
  });
}

export function policyDocument(result, format) {
  const value = field => field?.value ?? '未明确 / 待核实';
  const records = result.records;
  if (!Array.isArray(records)) throw new Error('政策结果缺少 records');
  const errors = result.errors ?? [], keys = Object.keys(FIELD_LABELS);
  const title = `${result.request?.mode === 'demo' ? '【旧版虚构样例】' : ''}企业扶持政策简报`;
  const summary = `检索主题：${result.query ?? result.request?.query ?? ''}\n核对基准日：${result.asOf}\n${result.coverage ?? ''}\n${records.length} 条政策；${errors.length} 项未完成来源。证据匹配表示摘录存在，申报条件及最新效力仍需核对原文。${result.status === 'running' ? '\n旧任务尚未完成，以下为阶段快照。' : ''}`;
  if (format === 'xlsx') return { title, summary, tables: [
    { name: '政策汇总', columns: [...Object.values(FIELD_LABELS), '期限提示', '来源', '抓取时间', '复核提醒'], rows: records.map(r => [...keys.map(k => value(r.fields[k])), r.deadlineStatus, r.sourceUrl, r.fetchedAt, r.warnings.join('；')]) },
    { name: '字段证据', columns: ['政策名称', '字段', '提取值', '原文证据', '匹配状态', '来源'], rows: records.flatMap(r => keys.map(k => [value(r.fields.name), FIELD_LABELS[k], value(r.fields[k]), r.fields[k].evidence ?? '', r.fields[k].verified ? '原文匹配，语义待复核' : '待核实', r.sourceUrl])) },
    { name: '未完成来源', columns: ['阶段', '来源', '原因'], rows: errors.map(e => [e.stage, e.url ?? '', e.message]) },
  ] };
  return { title, summary, sections: [
    ...records.map((r, i) => ({ heading: `${i + 1}. ${value(r.fields.name)}`, text: [r.deadlineStatus,
      ...keys.map(k => `${FIELD_LABELS[k]}：${value(r.fields[k])}${r.fields[k].evidence ? `\n原文证据：${r.fields[k].evidence}` : ''}`),
      `来源：${r.sourceUrl}`, `抓取时间：${r.fetchedAt}`, ...r.warnings].join('\n\n') })),
    ...(errors.length ? [{ heading: '未完成来源', text: errors.map(e => `${e.stage}：${e.url ?? ''}\n${e.message}`).join('\n\n') }] : []),
  ], references: records.map(r => ({ title: value(r.fields.name), url: r.sourceUrl })) };
}
