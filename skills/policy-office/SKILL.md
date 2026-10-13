---
name: policy-office
description: 将 DSH 政策搜索结果制作、导出和核验为 Excel XLSX、Word DOCX、PDF 简报。用于政策清单、可编辑简报、固定版式交付及其证据检查。
---

# 政策办公制作

本技能适配自 MIT 许可的 magnus919/agent-skills documents 技能。来源固定为
`2e8fb962819b2b01b270620f92f0cc7213d77ef1`，原始资料保存在 `upstream/`，许可见 `LICENSE.upstream.md`。
仅以本目录为资源根目录；上游提到的其他技能、PPTX 和 Python 生成依赖不属于本插件的安装要求。

## 使用

1. 用 `policy_job` 读取用户选定的任务。检查任务状态、覆盖范围、未完成来源和虚构演示标记。
2. 按目标格式调用 `policy_office(action="guide", format="xlsx" | "docx" | "pdf")`，按需阅读格式参考。
3. 调用 `policy_office(action="export", format=..., id=任务ID)`。导出器从同一个结构化结果生成真实文件，返回绝对路径。也可在工作台点击导出按钮。
4. 核对政策数量、名称、申报条件、日期、金额、证据和来源是否一致。缺少信息写“待核实”，不得补造日期或把最高补贴改成保证金额。
5. 如需保留完整抓取正文、模型输入输出和失败记录，一并导出 JSON。JSON 可能含用户的检索主题，按用户要求分享。

## 格式规则与资源

- XLSX：使用阅读说明、政策汇总、字段证据、未完成来源四张表；冻结标题、筛选、日期文本、合理列宽；正文不能变成公式。参考 [Excel](upstream/references/excel.md)。
- DOCX：用标题样式和分段证据形成可编辑简报，保留原文超链接和页码。参考 [Word](upstream/references/word.md)。
- PDF：嵌入随包 Noto CJK 字体，保持可选中文本、连续分页及完整证据。参考 [PDF](upstream/references/pdf.md)。
- 通用质量检查：[output-quality](upstream/references/output-quality.md)。结构化内容与版式分离；不要通过更改数据修复版式。

插件内置 Node 导出器，不需要另行安装 Python/Office。开发验收时，如有 Python 3，可运行上游只依赖标准库的校验器：

```text
python scripts/validate-documents.py --json 文件.xlsx 文件.docx 文件.pdf
```

上述脚本实际位于本技能目录下 `upstream/scripts/validate-documents.py`。可用时加 `--render-check`；该选项依赖 Poppler/LibreOffice，返回 unavailable 时只表示结构检查完成，不得报告已检查排版。导出器可运行不代表政策语义已被人工复核。
