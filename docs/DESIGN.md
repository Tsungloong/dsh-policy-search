# 纯 DSH 插件架构

## 宿主负责分析，插件提供确定性操作

```text
DSH：原有对话、当前模型、搜索与网页读取、工具执行与取消
└── dsh-policy-search
    ├── src/index.js       工具及 Skill 注册；原文/结果文件保存
    ├── src/search.js      调用宿主搜索，返回候选
    ├── src/fetcher.js     宿主网页结果解析；文字 PDF 下载解析
    ├── src/policy.js      字段证据、日期、去重、筛选；政策转文档内容
    ├── src/export.js      独立 XLSX / DOCX / PDF / JSON 生成
    ├── skills/policy-search
    ├── skills/policy-office
    └── assets             中文字体及许可
```

只有 tools 是启动依赖；技能服务可用时注册 Skills。插件加载不创建数据文件、不启动 HTTP 服务、不要求模型和 web 就绪。各工具仅在调用时访问自己的依赖。办公格式库在办公调用时加载。

## 数据流

1. `policy_search({query, limit?, filters?})` 调用宿主搜索。filters 包含 region、industry、policyType、level、from、to。日期搜索仅帮助发现候选，最终日期筛选以原文提取为准。
2. `policy_read({url, format?})` 获取原文并保存不可变快照，返回 sourceId 与正文。format 默认 auto，支持 web/pdf。
3. 当前会话根据原文生成 `{isPolicy, fields}`；插件没有第二个模型或 agent。
4. `policy_check({query?, items:[{sourceId, extraction}], filters?, failures?})` 重新读取保存的原文核对证据，去重和筛选，保存结果并返回 id。failures 记录本次读取失败的 URL 和原因；仅核验指定来源，不隐式联网。
5. `policy_office({format, document})` 独立制作文件；或 `policy_office({format, id})` 将政策结果映射为内容后导出。二者互斥。action 默认 export，guide 返回对应参考。filename 可选，只接受文件名，已有文件不覆盖。

工具直接返回结构化对象。工具取消信号传给宿主网络调用、PDF 请求和文件 I/O；不保留后台任务队列。取消后再次调用由 DSH 对话决定。

## 独立文档内容

```json
{
  "title": "月度报告",
  "summary": "本月情况",
  "sections": [{"heading": "进展", "text": "已完成资料整理。"}],
  "tables": [{"name": "费用明细", "columns": ["项目", "金额"], "rows": [["材料", 1200]]}],
  "references": [{"title": "来源", "url": "https://example.com/source"}]
}
```

title 必填，其余内容按需要提供。表格单元格支持文字、数字、布尔值和 null，不接受公式对象。字符串以文本保存。章节、表格、参考链接可单独或组合使用，不要求政策字段。

export.js 不依赖任务、网络、宿主模型或政策字段。policy.js 负责把政策内容转换为对应文档；宽政策表保留在 Excel，Word/PDF 用逐条政策与证据的形式表达。

## 存储与边界

默认根目录为 `$DSH_HOME/policy-search`：
- `sources/<sourceId>.json`：读取的原文快照。
- `<id>.json`：校验结果；旧版历史任务继续原位读取。
- `exports/*`：新生成文件。

这些 ID 是保存内容的引用，不是后台任务。模型提交的摘录与保存的原文匹配，不能通过改传正文制造“已匹配”证据。字段语义与政策效力仍由当前会话分析和用户核对。

只保存调用产生的资料，不索引用户目录、不保存凭据、不做后台监控。文件由宿主工具移动到用户指定目录；插件仅写自己的数据目录。

HTML/text 使用宿主安全读取入口；PDF 因宿主 web 接口无二进制类型而保留局部下载器。公开来源访问与“官方来源身份”分开：非政府域名可以读取，但不自动认证为园区官网。

## 接口迁移

0.2.0 明确取消工作台和后台任务接口，不假称与旧 policy_search 返回值兼容。policy_office 的历史 id 导出保留；旧 dataDir 保留用于访问原数据。没有端口、域名列表、DNS 或模型选项。
