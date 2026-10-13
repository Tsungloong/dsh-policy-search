# 0.1.0 验证记录

日期：2026-10-13。数据演示与真实网络测试分开；以下结果不等于已经验证任意外部模型的提取准确率。

## 运行与自动化检查

- Linux：Ubuntu / WSL，Node 24.19.0；Windows：Node 24.14.0。
- 两个平台分别执行完整 20 项 Node 测试，均通过。覆盖日期角色、不存在的证据、金额改写、多个截止批次、非政策排除、去重筛选、私网和伪装域名拒绝、HTML 清理、部分失败、取消、持久化失败、模型流失败、API 鉴权与跨站请求、三格式导出、Excel 文本公式边界。
- 使用真实 `@deepseek-ai/cordis@4.0.4` 和 DSH `0.2.0-rc.2` 的 Tools / Skills / LLM 服务加载插件：4 个工具、2 个技能注册成功；读取办公指南、导出 DOCX、卸载关闭监听器通过。
- 模型调用使用可重复的测试 Adapter 接入官方 LLM 服务。未调用用户的真实付费模型，也未在其正在使用的 DSH Desktop 配置中安装插件。
- `npm run check`：JavaScript 语法、技能入口和固定上游文件哈希通过。
- 打包后的 TGZ 在临时 npm 消费项目安装成功，模块导出和 CLI 帮助可运行；包内 ExcelJS 4.4.0 使用 uuid 11.1.1。安装后 `npm audit --omit=dev` 为 0 项已知漏洞（这是检查当天 npm 数据库结果，不保证永久无漏洞）。

## 真实官网抓取

下列请求使用插件实际抓取器、robots 检查、公共地址校验和 HTTPS 验证完成；未调用模型。

| 页面 | 结果 |
|---|---|
| [国家税务总局：失业保险支持企业稳岗扩岗通知](https://fgk.chinatax.gov.cn/zcfgk/c100013/c5250797/content.html) | 成功解析正文 2,191 字符 |
| [福建省人社厅：落实失业保险支持企业稳岗扩岗通知](https://rst.fujian.gov.cn/zw/zfxxgk/zfxxgkml/zyywgz/jycj/202609/t20260916_7214247.htm) | 成功解析正文 1,767 字符 |
| [中国政府网最新政策目录](https://www.gov.cn/zhengce/zuixin/) | 成功解析目录 491 字符 |

本机系统 DNS 把网站解析到 `198.18.*`，默认模式按设计拒绝该非公共地址。显式启用 `dnsResolver: alidns` 后上述请求成功，未更改系统 DNS、放行私网或关闭证书验证。单次三页成功不代表所有政府网站均可抓取。

## 文档与界面

- 两条**虚构演示**政策生成真实 XLSX、DOCX、PDF 和 JSON；上游 MIT 校验器对三种办公格式的结构检查均通过。
- PDF：PyMuPDF 渲染 2 页，中文可提取、字体内嵌，文本边界未超出页面；检查两页画面。
- DOCX：LibreOffice WASM 引擎渲染 3 页，未报告缺少字体；检查中文、证据段落、来源链接及页码。
- XLSX：同一 LibreOffice 引擎渲染政策汇总与阅读说明；4 个工作表存在。单元格声明随包 Noto 字体；引擎仍对工作簿默认样式报告 Calibri 缺失，实际内容使用 Noto 显示。编辑器可能发生字体替换，PDF 适合固定版式交付。
- 上游校验器的 `--render-check` 在缺少系统 LibreOffice/Poppler 时返回 unavailable。上面的渲染由单独的 LibreOffice WASM / PyMuPDF 完成，未把 unavailable 写成通过。
- Chromium 实际操作示例生成、字段证据面板和 XLSX/DOCX/PDF 下载；界面使用随包中文字体。桌面和窄屏截图保留在本目录 `images/`。

## 尚未验证及明确限制

未验证真实外部模型完整提取、真实搜索提供商覆盖率、DSH Desktop 内的最终用户安装、扫描 PDF OCR、需登录/JavaScript 的网站、macOS 或其他 DSH 版本。没有全国政策穷尽率、法律效力自动判断或长期可用性保证。

发布包含可安装 TGZ、源码 ZIP、虚构办公示例和 SHA-256。原始需求 DOCX、用户密钥、检索历史和真实政策原文快照不在发布内容内。
