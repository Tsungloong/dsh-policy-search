---
name: policy-office
description: 独立制作 Excel XLSX、Word DOCX、PDF，或将政策核验结果导出为办公文件；支持文字、章节、表格和来源链接。
---

# Excel、Word、PDF 制作

用户给出材料时直接制作文件，不必先搜索政策。已有 policy_check 的结果时可直接按 id 导出。使用随包 Node 生成器，不安装 Python、Office、浏览器或额外模型。

## 独立制作

调用 policy_office，format 为 xlsx、docx、pdf 或 json，document 示例：

```json
{
  "title": "月度报告",
  "summary": "本月工作与费用汇总",
  "sections": [{"heading": "进展", "text": "已完成资料整理。\n下一步核对申报时间。"}],
  "tables": [{"name": "费用明细", "columns": ["项目", "金额（元）"], "rows": [["材料", 1200], ["会议", 800]]}],
  "references": [{"title": "原始资料", "url": "https://example.com/source"}]
}
```

title 必填；其他部分按材料提供。每行单元格数须与 columns 一致。数字保留数字类型，正文文字保持字符串，不提交公式对象。只有文字也能生成 Excel（说明表）；只有表格也能生成 Word/PDF。

需要修改时调整 document 后生成新文件；不覆盖原文件。不承诺对用户已有 Office 文件做无损编辑转换。

## 政策组合

传 `{"format":"xlsx","id":"policy_check 返回的 ID"}`。Word/PDF 更换 format 即可，同一结果重复使用，不重新检索。document 与 id 二选一。

旧版任务 id 也可读取；保留原有虚构标记、未完成状态与错误。JSON 返回完整政策结果，包括来源正文；按用户要求分享，避免不必要披露资料。

## 文件交付

action 默认为 export。可用 filename 指定带扩展名的文件名，不接受目录。同名已有文件会报错，应换新名称。工具返回 file 绝对路径、格式和字节数；用宿主可识别的文件路径交付。需要另存目录时由 DSH 原有文件工具移动。

- XLSX：表头冻结、筛选、多工作表。正文不会解释成公式。
- DOCX：可编辑标题、章节、表格与来源链接。
- PDF：内嵌中文字体、分页及页码。超过六列或单元格过长的表格按条目展开，保留全部内容。
- JSON：可重新使用的结构化内容；政策模式保留完整证据结果。

不要把原文匹配说成已经人工核定政策效力，不要把写出文件说成已经在 Word/WPS 中检查全部分页。

## 格式参考

需要格式方法时可用 `policy_office(action="guide", format=...)` 按需读取 Excel、Word、PDF 参考。参考来自 MIT 的 magnus919/agent-skills documents 技能，固定版本与许可随包保留；上游 Python 示例是参考资料，不是此插件的运行要求。PPTX 未集成。
