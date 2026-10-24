# 0.2.0 交付验证

日期：2026-10-18。目标：纯 DSH 插件，政策检索与办公制作可独立使用或组合，不提供前端工作台和演示程序。

## 可安装包

- 文件：`dist/dsh-policy-search-0.2.0.tgz`，20,788,599 字节。
- 宿主基线：DSH 0.2.1-rc.2；Windows Node 24.14.0，Linux Node 24.19.0。
- 从最终 TGZ 通过 npm 安装到独立临时 profile，运行时依赖正常安装；未改用户真实 DSH profile。
- 官方 `loadProfileDirectory` 识别 bundle，`skippedBundles` 为 0；`readProfilePlugins` 返回版本 0.2.0、bundle=true、enabled=true；兼容检查无豁免通过。
- 按包内 patch 的空配置挂载官方 Cordis/Tools/Skills 服务，四个工具与两个 Skills 可用。
- 从已安装包执行独立 XLSX、DOCX、PDF 生成，以及搜索来源夹具 → 读取 → 证据校验 → 三格式导出；PDF 中文正文可读回。没有安装或调用额外模型服务。
- 安装包只含五个业务源码文件、Skills、字体/许可、安装文档及依赖，不含 public、HTTP server、CLI、任务引擎、演示入口、测试夹具或历史输出。

安装验证使用 npm 加官方 profile 加载接口；未操作 DSH 桌面插件页或完整 CLI 安装流程。

## 功能检查

Windows 与 Linux 各 29 项测试全部通过，覆盖：

- 无模型、无 web 服务时加载和独立办公制作。
- 官方宿主工具执行管线、搜索/网页服务注册、结构化参数与返回值。
- 检索、保存原文、核验字段与导出组合流程。
- 缺失/伪造摘录、金额改写、日期角色、多批次歧义、去重和筛选。
- 来源访问边界、非政府来源标示、网页错误、截断和取消。
- 文字 PDF 的实际中文提取、短 PDF 及无可提取文本的错误。
- 文件名越界拒绝、同名文件不覆盖、原始历史 JSON 不重写。
- XLSX 数字保留、公式样式字符串不执行、多工作表命名。

Linux 工作区最初复用了 Windows 安装的 node_modules，缺少 Linux Canvas 原生可选依赖。补齐临时验证环境后测试通过；最终 TGZ 的隔离安装可通过 PDF.js 的正常依赖链使用 Linux 原生模块，不需插件配置。

## 文件与渲染

- 独立办公、政策组合的六个文件及分页 PDF，共七个文件通过结构检查。
- DOCX XML 额外核对标题、章节、表格、金额、日期、来源失败信息及页脚。
- Excel 实际只读打开两份工作簿并导出 PDF：独立办公 3 个工作表、政策结果 4 个工作表。检查其渲染页面，文字与表格可读。
- 实际渲染并检查独立 PDF、三页政策 PDF，以及六页长内容/跨页表格 PDF 的关键页面。90 条表格行和最终 END-OF-CONTENT 标记均可从生成 PDF 读回。
- Word COM 自动化阻塞，未完成 Word 实机分页检查；本次创建的自动化实例和脚本已关闭。DOCX 的结构与内容检查通过，Word/WPS 的实际分页仍未验证。

## 实网边界

- 搜索和网页集成检查使用官方 DSH 服务接口及固定来源夹具；未调用真实搜索提供商或付费模型，真实会话的端到端效果未验证。
- 对中国政府网的二进制请求通道进行联网检查时，系统 DNS 返回非公网目标，连接被安全检查拒绝；没有绕过该限制。当前网络下的 PDF 直链下载未实网通过。正常文字 PDF 解析及文件制作已分别验证。
- 扫描 PDF、登录/验证码网页和旧 Office 文件无损编辑不在本版能力内。

## 证据位置

`output/verification-0.2.0/` 包含 tests-linux.log、tests-windows.log、installed-package.json、install.log、package.log、package-files.txt、docx-content.json、excel-render.json，以及生成文件和渲染图片。

源码检查：`npm run check`。测试：`npm test`。验证文件生成脚本：`scripts/verify-artifacts.js`。已安装包复测脚本：`scripts/verify-package.js <隔离 profile 目录>`。这些检查脚本不随插件安装包分发。
