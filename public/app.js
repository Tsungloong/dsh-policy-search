const $ = id => document.getElementById(id);
const incoming = location.hash.slice(1);
if (incoming) { sessionStorage.setItem('policy-token', incoming); history.replaceState(null, '', '/'); }
const token = sessionStorage.getItem('policy-token') || '';
let info, current, polling;
const labels = { name: '政策名称', issuer: '发布机关', region: '地区', level: '层级', industry: '行业', policyType: '扶持类型', eligibility: '申请条件', deadline: '申报截止', subsidy: '补贴标准', publishedDate: '发布日期', validUntil: '有效期至', statusNote: '效力说明' };
const statuses = { running: '处理中', completed: '已完成', partial: '部分完成', failed: '未完成', cancelled: '已取消', interrupted: '任务中断' };
const message = text => { $('message').textContent = text; $('message').hidden = !text; };
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers } });
  if (!response.ok) { const data = await response.json(); throw new Error(data.error || '请求失败'); }
  return response;
}
function el(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
async function historyList() {
  const jobs = await (await api('/api/jobs')).json(); $('history').replaceChildren();
  if (!jobs.length) $('history').append(el('p', '还没有检索记录', 'hint'));
  for (const j of jobs) { const b = el('button', j.query); b.append(el('small', `${j.mode === 'demo' ? '演示 · ' : ''}${statuses[j.status]} · ${j.count} 篇`)); b.addEventListener('click', () => loadJob(j.id)); $('history').append(b); }
}
function detail(record) {
  const root = $('detail-body'); root.replaceChildren(el('h3', record.fields.name.value));
  const link = el('a', '打开官方原文 ↗'); link.href = record.sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; root.append(link);
  root.append(el('p', `${record.deadlineStatus}；待人工复核。原文匹配仅说明证据存在，不保证模型分类语义正确。`));
  const dl = el('dl');
  for (const [key, label] of Object.entries(labels)) { const f = record.fields[key], wrap = el('div', undefined, 'field'); wrap.append(el('dt', label), el('dd', f.value ?? '未明确 / 待核实')); wrap.append(el('blockquote', f.evidence ?? '未找到可核对的原文证据')); dl.append(wrap); }
  root.append(dl, el('p', `抓取：${record.fetchedAt}\n内容摘要：${record.contentHash}`));
  if (record.warnings.length) root.append(el('p', record.warnings.join('；')));
  $('detail').showModal();
}
function render(job) {
  current = job; $('results').hidden = false; $('initial').hidden = true;
  $('result-heading').textContent = `${job.request.mode === 'demo' ? '【虚构演示】' : ''}${job.request.query}`;
  $('job-status').textContent = statuses[job.status]; $('job-status').className = `badge${job.status === 'completed' ? '' : ' warning'}`;
  $('progress').textContent = job.error || job.progress; $('coverage').textContent = job.coverage;
  $('cancel').hidden = job.status !== 'running'; $('count').textContent = job.records.length;
  $('unknown').textContent = job.records.filter(r => !r.fields.deadline.value).length; $('failures').textContent = job.errors.length;
  $('rows').replaceChildren(); $('empty').hidden = job.records.length > 0 || job.status === 'running';
  for (const r of job.records) {
    const tr = el('tr'), name = el('td', r.fields.name.value); name.append(el('small', r.fields.issuer.value ?? '发布机关待核实'));
    const source = el('a', '查看原文 ↗'); source.href = r.sourceUrl; source.target = '_blank'; source.rel = 'noopener noreferrer'; name.append(source);
    const kind = el('td', r.fields.policyType.value ?? '类型待核实'); kind.append(el('small', r.fields.region.value ?? '地区待核实'));
    const deadline = el('td', r.fields.deadline.value ?? '待核实'); deadline.append(el('small', r.deadlineStatus));
    const subsidy = el('td', r.fields.subsidy.value ?? '原文未明确');
    const action = el('td'), button = el('button', '逐字段核对 ↗', 'evidence-button'); button.addEventListener('click', () => detail(r)); action.append(button);
    tr.append(name, kind, deadline, subsidy, action); $('rows').append(tr);
  }
  $('error-panel').hidden = !job.errors.length; $('errors').replaceChildren(...job.errors.map(e => el('li', `${e.stage}：${e.url ?? ''} ${e.message}`)));
  document.querySelectorAll('[data-export]').forEach(b => { b.disabled = !job.records.length && b.dataset.export !== 'json'; });
}
async function loadJob(id) {
  clearTimeout(polling);
  try { const job = await (await api(`/api/jobs/${id}`)).json(); render(job); if (job.status === 'running') polling = setTimeout(() => loadJob(id), 1800); else await historyList(); } catch (e) { message(e.message); }
}
async function start(mode) {
  message(''); $('submit').disabled = true; $('demo').disabled = true;
  try {
    const selected = info.models.find(m => `${m.provider}\n${m.id}` === $('model').value);
    const input = { query: $('query').value, limit: Number($('limit').value), mode, provider: selected?.provider, model: selected?.id,
      urls: $('urls').value.split(/\r?\n/).map(x => x.trim()).filter(Boolean), sources: [...document.querySelectorAll('#sources input:checked')].map(x => x.value),
      filters: Object.fromEntries(['region', 'industry', 'policyType', 'from', 'to'].map(k => [k, $(k).value])) };
    if (mode === 'demo') { input.urls = []; input.filters = {}; }
    const job = await (await api('/api/jobs', { method: 'POST', body: JSON.stringify(input) })).json();
    await loadJob(job.id); await historyList(); $('results').scrollIntoView({ behavior: 'instant', block: 'start' });
  } catch (e) { message(e.message); } finally { $('submit').disabled = !info?.models.length; $('demo').disabled = false; }
}
$('search-form').addEventListener('submit', event => { event.preventDefault(); start('live'); });
$('demo').addEventListener('click', () => start('demo'));
$('new-search').addEventListener('click', () => { $('query').focus(); $('search-heading').scrollIntoView(); });
$('refresh-history').addEventListener('click', () => historyList().catch(e => message(e.message)));
$('close-detail').addEventListener('click', () => $('detail').close());
$('cancel').addEventListener('click', async () => { try { await api(`/api/jobs/${current.id}/cancel`, { method: 'POST', body: '{}' }); await loadJob(current.id); } catch (e) { message(e.message); } });
document.querySelectorAll('[data-export]').forEach(button => button.addEventListener('click', async () => {
  if (!current) return; button.disabled = true; message('');
  try { const format = button.dataset.export; const response = await api(`/api/jobs/${current.id}/export?format=${format}`); const blob = await response.blob(), url = URL.createObjectURL(blob), link = el('a'); link.href = url; link.download = `政策简报-${current.id.slice(0, 8)}.${format}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  catch (e) { message(e.message); } finally { button.disabled = false; }
}));
try {
  info = await (await api('/api/info')).json();
  $('model').replaceChildren(...(info.models.length ? info.models.map(m => { const o = el('option', m.name); o.value = `${m.provider}\n${m.id}`; return o; }) : [el('option', '未配置模型，请在 DSH 中设置')]));
  for (const [i, s] of info.sources.entries()) { const label = el('label'), input = el('input'); input.type = 'checkbox'; input.value = s.id; input.checked = i === 0; label.append(input, document.createTextNode(s.name)); $('sources').append(label); }
  $('connection').textContent = info.models.length ? `已连接 ${info.models.length} 个 DSH 模型 · 搜索可能使用已配置服务额度` : '未连接 DSH 模型；可体验演示，真实检索需在 DSH 中配置模型。';
  $('submit').disabled = !info.models.length; $('demo').hidden = !info.demo; await historyList();
} catch (e) { message(e.message); $('connection').textContent = '工作台连接失败'; $('submit').disabled = true; }
