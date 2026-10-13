import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root = process.cwd(), version = JSON.parse(await readFile('package.json', 'utf8')).version;
await mkdir('dist', { recursive: true });
function run(cmd, args) { const r = spawnSync(cmd, args, { encoding: 'utf8', shell: false }); if (r.status !== 0) throw new Error(r.stderr || r.stdout || `命令失败：${cmd}`); return r.stdout; }
// npm_execpath avoids platform-specific .cmd shell quoting.
const npm = process.env.npm_execpath;
if (!npm) throw new Error('请通过 npm run pack:release 执行');
const packed = JSON.parse(run(process.execPath, [npm, 'pack', '--json', '--pack-destination', 'dist']));
const tarball = packed[0].filename;
const source = `dsh-policy-search-${version}-source.zip`;
run('git', ['archive', '--format=zip', `--prefix=dsh-policy-search-${version}/`, `--output=${path.join(root, 'dist', source)}`, 'HEAD']);
const examples = `dsh-policy-search-${version}-examples.zip`;
run('git', ['archive', '--format=zip', '--prefix=policy-office-samples/', `--output=${path.join(root, 'dist', examples)}`, 'HEAD', 'examples']);
const sums = [];
for (const file of [tarball, source, examples]) sums.push(`${createHash('sha256').update(await readFile(path.join('dist', file))).digest('hex')}  ${file}`);
await writeFile('dist/SHA256SUMS.txt', sums.join('\n') + '\n');
console.log(JSON.stringify({ version, files: [tarball, source, examples, 'SHA256SUMS.txt'], packageEntries: packed[0].entryCount, bytes: packed[0].size }));
