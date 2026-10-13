import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { exportBrief, FORMATS } from './export.js';
import { SOURCES } from './sources.js';

async function bodyJson(req) {
  let bytes = 0; const chunks = [];
  for await (const part of req) { bytes += part.length; if (bytes > 32768) throw new Error('请求超过 32KB'); chunks.push(part); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('请求不是有效 JSON'); }
}
function sameToken(actual, expected) {
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function startWorkbench({ engine, models = async () => [], port = 0 } = {}) {
  const token = randomBytes(32).toString('hex'); let activeExports = 0;
  const staticFiles = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'");
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    try {
      const expectedHost = `127.0.0.1:${server.address().port}`;
      if (req.headers.host !== expectedHost) return send(403, { error: '不接受此 Host' });
      if (req.headers.origin && req.headers.origin !== `http://${expectedHost}`) return send(403, { error: '不接受跨站请求' });
      const u = new URL(req.url, `http://${expectedHost}`);
      if (u.pathname === '/favicon.ico' && req.method === 'GET') { res.writeHead(204); res.end(); return; }
      if (u.pathname === '/font.otf' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'font/otf', 'Cache-Control': 'public, max-age=86400' }); res.end(await readFile(new URL('../assets/NotoSansCJKsc-Regular.otf', import.meta.url))); return; }
      if (req.method === 'GET' && staticFiles[u.pathname]) {
        const [file, type] = staticFiles[u.pathname]; res.writeHead(200, { 'Content-Type': type }); res.end(await readFile(new URL(`../public/${file}`, import.meta.url))); return;
      }
      if (!sameToken(req.headers.authorization ?? '', `Bearer ${token}`)) return send(401, { error: '工作台访问凭据缺失或已失效，请重新获取工作台链接' });
      if (u.pathname === '/api/info' && req.method === 'GET') return send(200, { sources: SOURCES, models: await models(), demo: engine.demo, allowedHosts: engine.fetcher.allowedHosts });
      if (u.pathname === '/api/jobs' && req.method === 'GET') return send(200, engine.list());
      if (u.pathname === '/api/jobs' && req.method === 'POST') return send(202, await engine.start(await bodyJson(req)));
      const match = /^\/api\/jobs\/([a-f0-9-]{36})(?:\/(cancel|export))?$/.exec(u.pathname);
      if (match) {
        const job = engine.get(match[1]);
        if (match[2] === 'cancel' && req.method === 'POST') { engine.cancel(job.id); return send(200, { status: 'cancelling' }); }
        if (match[2] === 'export' && req.method === 'GET') {
          const format = u.searchParams.get('format');
          if (!Object.hasOwn(FORMATS, format)) return send(400, { error: '格式无效' });
          if (activeExports >= 2) return send(429, { error: '导出正在处理，请稍后重试' });
          activeExports++;
          try {
            const data = await exportBrief(job, format);
            res.writeHead(200, { 'Content-Type': FORMATS[format], 'Content-Disposition': `attachment; filename="policy-brief-${job.id.slice(0, 8)}.${format}"` }); res.end(data); return;
          } finally { activeExports--; }
        }
        if (!match[2] && req.method === 'GET') return send(200, engine.summary(job));
      }
      send(404, { error: '接口不存在' });
    } catch (err) { if (!res.headersSent) send(400, { error: err.message }); else res.destroy(); }
  });
  server.requestTimeout = 30000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return {
    url: `http://127.0.0.1:${server.address().port}/#${token}`, token,
    close: async () => { await engine.close(); await new Promise(resolve => server.close(resolve)); },
  };
}
