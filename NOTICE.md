# 第三方来源与许可

本仓库用于用户的私密交付；新编写的插件代码未对外授予开源许可。下列第三方材料保留各自许可，私密仓库设置不会改变它们的许可。

| 组件 | 来源 / 固定版本 | 使用方式与许可 |
|---|---|---|
| 政策检索参考 | dongwei6688/policy-search-china-skill，`7cf075676b7d9738b881bb7d17b32ed9d236216b` | 参考功能和原文溯源思路，未复制执行代码或缓存；原项目 MIT |
| documents 办公技能 | magnus919/agent-skills，`2e8fb962819b2b01b270620f92f0cc7213d77ef1` | 保留所需上游文件，MIT；版权和许可在 `skills/policy-office/LICENSE.upstream.md` |
| Noto Sans CJK SC | notofonts/noto-cjk；固定提交见 `assets/font-source.json` | PDF 嵌入字体；SIL Open Font License 1.1，原文在 `assets/FONT-LICENSE.txt` |
| DSH / Cordis 接口 | deepseek-ai/deepseek-harness；测试 npm 0.2.0-rc.2 / Cordis 4.0.4 | 通过 npm 使用官方接口；各包自带许可 |
| ExcelJS / docx / PDFKit | package-lock.json 固定版本 | 办公文件生成；各依赖保留原包许可证 |
| PDF.js / Cheerio / Undici / robots-parser / ipaddr.js | package-lock.json 固定版本 | 正文解析、安全请求及来源检查；各依赖保留原包许可证 |

上游办公技能未被原地改写，`upstream-lock.json` 记录其逐文件 SHA-256。新增 DSH 入口限定政策场景、用 Node 导出器替代 Python 生成依赖，并明确区分结构验证与渲染验证。上游总入口仅作为来源记录，不是插件的活动技能入口；PPTX、其他关联技能和 fixtures 未集成。

字体未作修改，不单独销售。文件随包交付用于离线生成中文 PDF。原始用户 DOCX 未放入仓库，仓库仅记录功能需求映射。
