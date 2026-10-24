import { mkdir, writeFile } from 'node:fs/promises';
import { exportDocument } from '../src/export.js';
import { policyDocument, validateExtraction } from '../src/policy.js';
import { fixturePages, fixtureExtract, officeDocument } from '../test/fixtures.js';

const dir = 'output/verification-0.2.0';
await mkdir(dir, { recursive: true });
const policy = { query: '测试政策材料', asOf: '2026-10-18', status: 'partial', coverage: '仅使用虚构测试材料，未执行真实政策检索。',
  records: fixturePages.map(page => validateExtraction(fixtureExtract(page), page, '2026-10-18')),
  errors: [{ stage: 'read', url: 'https://example.com/unavailable', message: '测试：来源不可访问' }] };
for (const format of ['xlsx', 'docx', 'pdf']) {
  await writeFile(`${dir}/standalone.${format}`, await exportDocument(officeDocument, format));
  await writeFile(`${dir}/policy.${format}`, await exportDocument(policyDocument(policy, format), format));
}
const pagination = { title: '分页与长内容检查', sections: [{ heading: '长段落', text: '这是一段用于检查中文自动换行和分页的文字，内容不得被截断。'.repeat(120) }],
  tables: [{ name: '跨页表格', columns: ['序号', '材料', '备注'], rows: Array.from({ length: 90 }, (_, i) => [i + 1, `第 ${i + 1} 项材料`, '逐项检查表格文字完整性。']) },
    { name: '长单元格', columns: ['内容'], rows: [['长单元格正文。'.repeat(160) + '结束标记：END-OF-CONTENT']] }] };
await writeFile(`${dir}/pagination.pdf`, await exportDocument(pagination, 'pdf'));
console.log(`验证文件：${dir}，仅用于测试，不随安装包分发。`);
