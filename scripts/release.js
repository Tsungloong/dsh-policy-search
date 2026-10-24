import { spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
await mkdir('dist', { recursive: true });
const npm = process.env.npm_execpath;
if (!npm) throw new Error('请通过 npm run pack:release 执行');
const result = spawnSync(process.execPath, [npm, 'pack', '--json', '--pack-destination', 'dist'], { encoding: 'utf8', shell: false });
if (result.status !== 0) throw new Error(result.stderr || result.stdout);
const [packed] = JSON.parse(result.stdout);
const paths = packed.files.map(file => file.path);
for (const file of paths) {
  if (/^(public\/|examples\/|test\/|output\/|Start-Demo|start-demo|src\/(cli|demo|server|engine|dsh-adapter)\.js)/.test(file)) throw new Error(`安装包含已移除的入口：${file}`);
}
for (const required of ['src/index.js', 'src/search.js', 'src/export.js', 'cordis.patch.yml', 'assets/NotoSansCJKsc-Regular.otf', 'skills/policy-office/SKILL.md', 'skills/policy-search/SKILL.md']) {
  if (!paths.includes(required)) throw new Error(`安装包缺少：${required}`);
}
console.log(JSON.stringify({ version, file: `dist/${packed.filename}`, bytes: packed.size, packageEntries: packed.entryCount }, null, 2));
