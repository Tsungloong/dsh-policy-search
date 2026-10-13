import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
for (const dir of ['src', 'public', 'scripts', 'test']) {
  for (const file of await readdir(dir)) if (file.endsWith('.js')) {
    const result = spawnSync(process.execPath, ['--check', `${dir}/${file}`], { stdio: 'inherit' }); if (result.status) process.exit(result.status);
  }
}
const lock = JSON.parse(await readFile('skills/policy-office/upstream-lock.json', 'utf8'));
for (const entry of lock.files) { const bytes = await readFile(entry.path); if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`上游技能校验失败：${entry.path}`); }
for (const skill of ['policy-office', 'policy-search']) { const content = await readFile(`skills/${skill}/SKILL.md`, 'utf8'); if (!content.startsWith(`---\nname: ${skill}\ndescription: `)) throw new Error('技能清单无效'); }
console.log('语法检查、技能清单与固定上游文件哈希通过。');
