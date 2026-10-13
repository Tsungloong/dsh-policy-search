export async function listDshModels(llm) {
  if (!llm) return [];
  const out = [];
  for (const provider of llm.listProviders()) {
    const models = await llm.listModels(provider.id);
    out.push(...models.map(m => ({ provider: provider.id, id: m.id, name: `${provider.name} / ${m.name || m.id}` })));
  }
  return out;
}
export async function generateDsh(llm, { provider, model, prompt, signal }) {
  if (!llm) throw new Error('DSH 模型服务尚未就绪');
  let text = '', finish;
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(120000)]);
  for await (const chunk of llm.stream({ provider, model, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }], maxTokens: 6000, signal: timeout })) {
    if (chunk.type === 'text-delta') text += chunk.text;
    if (text.length > 50000) throw new Error('模型输出超过长度上限');
    if (chunk.type === 'finish') finish = chunk.reason;
  }
  if (!finish || finish.kind !== 'stop') throw new Error(`模型未完整结束：${finish?.failure?.message || finish?.kind || '缺少结束事件'}`);
  return text;
}
