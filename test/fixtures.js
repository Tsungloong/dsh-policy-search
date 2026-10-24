// Fictional test fixtures only. This file is excluded from the installable package.
export const officeDocument = {
  title: '企业服务月度报告（测试材料）',
  summary: '本文件用于验证插件独立办公制作，不含真实业务数据。',
  sections: [{ heading: '工作概况', text: '本月完成政策咨询与材料整理。\n下一步：核对申报时间，整理企业反馈。' }],
  tables: [{ name: '费用明细', columns: ['项目', '金额（元）', '已核对'], rows: [['材料制作', 1200, true], ['会议服务', 800, false]] }],
  references: [{ title: '资料来源（测试）', url: 'https://example.com/source' }],
};
export const fixturePages = [
  { url: 'https://demo.invalid/policy/1', title: '示例市中小企业稳岗补贴申报通知（虚构）', text: '示例市中小企业稳岗补贴申报通知（虚构）\n发布机关：示例市人力资源和社会保障局。\n发布日期：2026年10月1日。\n支持示例市制造业中小企业稳岗补贴。申请条件：在示例市登记注册、依法缴纳社会保险且符合稳岗条件的制造业中小企业。\n补贴标准：符合条件的企业按实际缴纳失业保险费的60%返还。\n申报截止日期：2026年11月30日。\n本样例仅供软件演示，不是真实政策。', fetchedAt: '2026-10-13T00:00:00.000Z', sourceKind: '虚构演示', links: [] },
  { url: 'https://demo.invalid/policy/2', title: '示例园区小微企业场地减免办法（虚构）', text: '示例园区小微企业场地减免办法（虚构）\n发布机关：示例园区管理委员会。\n发布日期：2026年9月15日。\n面向示例市软件行业的场地减免。申请条件：入驻示例园区、独立核算的软件行业小微企业。\n补贴标准：经审核，减免三个月场地租金，每户最高2万元。\n申报时间另行通知。\n本样例仅供软件演示，不是真实政策。', fetchedAt: '2026-10-13T00:00:00.000Z', sourceKind: '虚构演示', links: [] },
];
export function fixtureExtract(page) {
  const first = page.url.endsWith('/1');
  const field = (value, evidence = value) => ({ value, evidence });
  return { isPolicy: true, fields: {
    name: field(page.title), issuer: field(first ? '示例市人力资源和社会保障局' : '示例园区管理委员会'),
    region: field('示例市'), level: field(first ? '市级' : '园区', first ? '示例市人力资源和社会保障局' : '示例园区管理委员会'),
    industry: field(first ? '制造业' : '软件'), policyType: field(first ? '稳岗补贴' : '场地减免'),
    eligibility: field(first ? '在示例市登记注册、依法缴纳社会保险且符合稳岗条件的制造业中小企业。' : '入驻示例园区、独立核算的软件行业小微企业。'),
    subsidy: field(first ? '符合条件的企业按实际缴纳失业保险费的60%返还。' : '经审核，减免三个月场地租金，每户最高2万元。'),
    deadline: first ? field('2026-11-30', '申报截止日期：2026年11月30日。') : field(null),
    publishedDate: field(first ? '2026-10-01' : '2026-09-15', first ? '发布日期：2026年10月1日。' : '发布日期：2026年9月15日。'),
    statusNote: field(first ? '本样例仅供软件演示，不是真实政策。' : '申报时间另行通知。'),
  } };
}
