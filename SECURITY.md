# 安全策略

## 支持范围

WebRemaster 目前处于 `0.1.x` 阶段，仅对最新发布版本提供安全修复。

## 报告安全问题

请不要在公开 Issue 中披露可利用细节。优先使用 GitHub 的私密报告通道：

- 仓库 **Security** 标签页 → **Report a vulnerability**（GitHub Security Advisory）

报告中请尽量包含：受影响的包（`bridge` / `compiler` / `extension` / `store`）、复现步骤、影响面评估，以及你希望公开的时间线。

我们会在 7 个工作日内确认收到，并在修复发布后于 CHANGELOG 中致谢（如你愿意署名）。

## 本项目的安全边界

理解以下设计前提，有助于判断什么是漏洞、什么是有意为之：

1. **皮肤脚本拥有目标站点的完整权限。** 用户在 Tampermonkey / Chrome 中安装某个皮肤，等价于信任该皮肤的代码。请只安装来自本仓库 `skins/` 目录或官方 Release 的产物。
2. **隐身原站不影响原站鉴权。** `OriginManager` 通过保持原 DOM 存活来保留 Cookie、CSRF Token 与 `__VIEWSTATE`，它不会绕过目标站点的登录或权限校验。
3. **编译期抓取会发起真实网络请求。** `wr inspect` 使用 Playwright 访问目标 URL，请只对你拥有授权或公开可访问的站点运行。
4. **LLM 网关使用你自己的 Key。** `compiler` 的 BYOK 配置只从本地环境变量 / `.env` 读取，不会上传到本项目任何服务器。
5. **运行时零上报。** 浏览器 SDK 不包含遥测端点；`storageState.json`、`.wr-cache/` 属于本地缓存，已在 `.gitignore` 中排除。

## 不在范围内的内容

- 目标站点自身的安全问题（请直接联系该站点）
- 用户自行修改皮肤源码后引入的问题
- 需要物理接触设备才能利用的问题
