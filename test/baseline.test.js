import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { evaluatePluginCompatibility, getDshRuntimeVersion } from '@deepseek-ai/dsh-app-boot';

const baseline = '0.2.1-rc.2';
const readJson = async relative => JSON.parse(await readFile(new URL(relative, import.meta.url), 'utf8'));

test('plugin manifest and installed DSH interfaces use the verified 0.2.1-rc.2 baseline', async () => {
  const manifest = await readJson('../package.json');
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-tools'], baseline);
  for (const name of ['dsh-tools', 'dsh-llm', 'dsh-skill', 'dsh-web', 'dsh-system-prompt', 'dsh-app-boot']) {
    const id = `@deepseek-ai/${name}`;
    assert.equal(manifest.devDependencies[id], baseline, `${id} test dependency`);
    assert.equal((await readJson(`../node_modules/${id}/package.json`)).version, baseline, `${id} installed version`);
  }
  assert.equal((await readJson('../node_modules/@deepseek-ai/cordis/package.json')).version, '4.0.5');
});

test('lockfile retains the same host peer requirement', async () => {
  const lock = await readJson('../package-lock.json');
  assert.equal(lock.packages[''].peerDependencies['@deepseek-ai/dsh-tools'], baseline);
  assert.equal(lock.packages['node_modules/@deepseek-ai/dsh-tools'].version, baseline);
});

test('official DSH compatibility gate accepts the new package and rejects the old baseline without exemptions', async () => {
  const manifest = await readJson('../package.json');
  assert.equal(getDshRuntimeVersion(), baseline);
  const previous = { ...manifest, version: '0.1.0', peerDependencies: { '@deepseek-ai/dsh-tools': '0.2.0-rc.2' } };
  const issue = evaluatePluginCompatibility(previous);
  assert.deepEqual(issue.requirements, { '@deepseek-ai/dsh-tools': '0.2.0-rc.2' });
  assert.equal(issue.exempted, false);
  assert.equal(evaluatePluginCompatibility(manifest), undefined);
  assert.ok(evaluatePluginCompatibility(manifest, {}, '0.2.0-rc.2'));
});
