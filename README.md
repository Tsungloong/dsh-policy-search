# 政策寻源 · DSH 原生插件

在 DSH 对话中检索政策、核对原文，或独立制作 Excel、Word、PDF。

- “查广东制造业扶持政策，列出申请条件、补贴标准和原文证据。”
- “把刚才的政策整理成 Excel，再生成 Word 简报。”
- “不用搜索，把下面这份材料做成 Word 和 PDF。”

**0.2.0 是纯插件**：没有前端工作台、监听端口、演示程序或独立模型配置。分析由 DSH 当前会话完成，插件负责搜索、读取、证据匹配和文件生成。

## 安装

适用基线：**DSH 0.2.1-rc.2，Node.js ≥ 22.19**。

在 DSH 插件页通过本地包入口安装 `dsh-policy-search-0.2.0.tgz`，随后重启该 profile。也可用宿主命令：

```sh
dsh plugin --profile web add /absolute/path/dsh-policy-search-0.2.0.tgz
```

Windows 路径含空格时加引号。安装依赖时需要联网。插件配置保持 `{}` 即可；模型、搜索与网页读取沿用 DSH 设置。

已经安装 0.1.x 时，在同一 profile 卸载旧插件、安装新包并重启。不要删除原来的 `policy-search` 数据目录。

## 四个原生工具，两种独立能力

| 工具 | 输入与结果 |
|---|---|
| `policy_search` | 主题及可选筛选条件 → 候选网址；使用宿主搜索 |
| `policy_read` | 网址 → 正文、抓取信息与 sourceId；可单独读取指定网址 |
| `policy_check` | sourceId 和当前会话提取的字段 → 已校验证据的政策结果与 id |
| `policy_office` | 自带内容 document，或政策结果 id → XLSX / DOCX / PDF / JSON |

`policy-search` 与 `policy-office` 两个 Skill 随安装注册。办公制作不依赖检索、网络或插件内模型调用。搜索失败不会阻止办公制作。

政策链路：检索 → 读取 → 当前会话提取/分析 → 证据校验 → 按需导出。已知网址直接从读取开始；只想看结论时无需生成文件。

## 文件与内容

- XLSX：支持多张表、文字/数字/布尔单元格、筛选、冻结表头。政策导出包含说明、汇总、字段证据、未完成来源。
- DOCX：可编辑标题、章节、表格和来源链接。
- PDF：嵌入中文字体，带页码；宽表或长单元格转成逐项内容，避免缩小到无法阅读。
- JSON：保存文档内容，或完整政策结果与原文快照，便于后续复用。

默认保存到 `$DSH_HOME/policy-search/exports`；未设置 DSH_HOME 时为用户主目录下 `.dsh/policy-search/exports`。工具返回绝对路径，不覆盖已有文件。需要移到其他目录时，让 DSH 使用宿主文件工具完成。

制作范围是新建文件、修改结构化内容后重新生成；不提供任意旧 Office 文件的无损编辑或转换。读取政策支持 HTML、文本与文字型 PDF；扫描件需要另行 OCR。

## 来源和模型

HTML/文本读取、搜索复用 DSH 的 `web` 服务。当前宿主接口不返回 PDF 二进制，因此文字 PDF 复用插件已有的安全下载和解析器；无 .pdf 后缀的 PDF 地址指定 `format: "pdf"`。PDF 下载使用系统网络，保留公网目标、重定向、大小及 robots 检查，不提供自定义 DNS 配置。

非 gov.cn 的园区网站可直接读取，不需逐站填写白名单；这类来源明确标为“发布主体待核对”。候选、发布时间和发布机关仍须核对原文。

政策资料由当前会话模型分析，沿用 DSH 的模型与计费安排。插件不读取密钥、不再自行发起额外模型会话。原文快照和政策结果保存在本机；搜索和网页服务仍按宿主配置访问网络。

## 从 0.1.x 迁移

这是明确的工具接口更新：
- 移除 `policy_workbench` 和 `policy_job`。
- `policy_search` 接受结构化参数并直接返回候选，不再返回后台任务 ID。
- 模型提取交给当前会话；新增 `policy_read`、`policy_check`。
- `policy_office` 保留 `action=guide/export`，新增独立 document 输入；旧任务 id 仍可导出。
- 移除 port、allowedHosts、dnsResolver。原 dataDir 仅为已有历史目录保留兼容，新安装不需要设置。

历史 JSON 不迁移、不重写、不自动清理。0.1.x 的演示结果再次导出时仍标明虚构，未完成旧任务仍显示阶段快照。

[架构与接口](docs/DESIGN.md) · [安装与使用](docs/DEPLOYMENT.md) · [第三方许可](NOTICE.md)
