import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
for (const dir of ['src', 'scripts', 'test']) {
  for (const file of await readdir(dir)) if (file.endsWith('.js')) {
    const result = spawnSync(process.execPath, ['--check', `${dir}/${file}`], { stdio: 'inherit' });
    if (result.status) process.exit(result.status);
  }
}
for (const skill of ['policy-office', 'policy-search']) {
  const content = await readFile(`skills/${skill}/SKILL.md`, 'utf8');
  if (!content.startsWith(`---\nname: ${skill}\ndescription: `)) throw new Error('技能清单无效');
}
console.log('语法与 Skill 清单检查通过。');
