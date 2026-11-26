# 端到端示例：从零生成第二个皮肤

这个目录不是"上架皮肤"，而是 `compiler` 的可复现回归现场：一个 1998 风格的静态页面，用来自证「`wr scaffold` 生成的模板能直接过六重门禁」。

## 为什么需要它

仓库里 `skins/hackernews` 是手工精作，很容易被质疑"编译器只是陪衬"。`demo1998` 的整条链路（inspect → scaffold → build → verify）不写一行业务代码，产出的 `.user.js` 在真实运行的页面上跑通 6/6 门禁、数据对齐 100%。

`05_verification.json` 是实测报告：`passed: true`、`dataParityRatio: 1`、`title / url` 两个字段 `tier=1 hits=40 misses=0`。

## 复现（约 3 分钟）

```bash
# 1. 起本地"老站"
node examples/local-1998/server.cjs        # http://127.0.0.1:4190/

# 2. 测绘 DOM，产出 01_snapshot.json + before.png
pnpm wr inspect http://127.0.0.1:4190/ --id demo1998 --out-dir ./skins-tmp

# 3. 生成皮肤骨架（选择器从快照的最大重合组推导）
pnpm wr scaffold demo1998 --url http://127.0.0.1:4190/ --skins-dir ./skins-tmp --archetype news-feed

# 4. 打包 + 六重门禁（真实访问 127.0.0.1，不依赖外网）
pnpm wr build-skin demo1998 --skins-dir ./skins-tmp
pnpm wr verify-skin demo1998 --no-vlm --skins-dir ./skins-tmp
```

预期最后一行：`六重门禁（demo1998）—— 全部通过`，`数据对齐率：100.0%（原始 20 项 → 重制 20 项）`。

## 这份示例同时钉住了四个坑

| 坑 | 表现 | 现在的做法 |
| :--- | :--- | :--- |
| 模板导出假 API | `mountShadowApp` / `createReactiveStore` 在 `bridge` 里根本不存在，`build-skin` 直接 TS2305 | 模板改为真实协议：`export default function mountSkin(context)` + `createOriginStore` |
| 模板没有默认导出 | wrapper 只认 default `mountSkin`，产物自检必红 | 同上 |
| 快照选择器是绝对路径 | `html > body > table.list > tr.item` 在 body 被搬进 `#wr-origin-wrapper` 后匹配 0 项 | scaffold 落盘前去掉 `html / body` 前缀 |
| CSS 没扫描 ui-kit | 渲染区 0×0、"白底黑字"判失败 | `skin.css` 生成时带上 `@source "../../../packages/ui-kit/src"`，容器自带底色 |

> 如果你只是想要一个自己的皮肤，不需要复制这里的代码——`wr scaffold` 生成的就是同一份模板。
