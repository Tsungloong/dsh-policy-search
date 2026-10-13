import { mkdir, writeFile } from 'node:fs/promises';
import { SafeFetcher } from '../src/fetcher.js';
const urls = process.argv.slice(2);
if (!urls.length) throw new Error('传入要核实的官方政策网址');
const fetcher = new SafeFetcher({ dnsResolver: process.env.POLICY_DNS_RESOLVER ?? 'system' }), results = [];
for (const url of urls) {
  const start = Date.now();
  try { const page = await fetcher.page(url); results.push({ url, finalUrl: page.url, status: 'fetched', title: page.title, characters: page.text.length, fetchedAt: page.fetchedAt, seconds: (Date.now() - start) / 1000 }); }
  catch (error) { results.push({ url, status: 'failed', error: error.message, cause: error.cause?.message, seconds: (Date.now() - start) / 1000 }); }
}
await mkdir('output/verification', { recursive: true });
await writeFile('output/verification/live-fetch.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
