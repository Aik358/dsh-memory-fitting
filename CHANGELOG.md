# Changelog

All notable changes to this project are documented here.

## [0.1.0] — 2026-09-16

首次发布。把 SSVEP 脑机接口项目的「意图拟合」环节移植为 DSH 插件。

### 新增

**拟合机制**
- 拟合生命周期：预判方向 → 批量提问 → 轮间思考 → 收敛提案 → 用户确认 → 归档。
- `memory_fit_start` / `memory_fit_ask` / `memory_fit_archive` / `memory_fit_history` 四个模型可见工具（默认不注册）。
- 走 `ctx.userQuestions.ask()` 一次问一批问题，不经过模型、不占 tool-call 轮次。
- 轮数上限护栏（默认 4 轮），防止"问上瘾"。
- 用户中途取消时降级返回，已答内容保留。

**界面**
- 右下角悬窗：设置页（默认）· 留档浏览 · 发起拟合。
- 独立列布局：FAB 位于 `right:16 bottom:16`，面板位于 `right:472`，与 dsh-cua / Ark9Canvas 所在的那一列完全错开。
- 窄屏（<900px）降级为居中浮层。
- 留档详情含完整事件流回放；支持改名、删除（二次确认）、手动归档。
- 提示条通知；开关点击即时回显。

**存储**
- 本地 JSONL append-only 留档（`~/.dsh/memory-fitting/sessions/`），索引可重建。
- 三级降级归档：auto-memory → 其它记忆插件 → 仅本地。
- 训练就绪的 `fit/feedback` 三元组采集（context / modelDid / userSaid / verdict / preference）。

**安全**
- `sanitize.js`：写入记忆插件前对用户原话做**字符级改写**，防止锚点击穿记忆文件。所有归档文本强制过 `guard()`。
- node 侧零外部包依赖；client 侧零 `require`。
- 路由全部由 `guard()` 包裹 —— 与宿主共享进程，绝不让异常逃逸。

**开关（默认全关）**
- `injectContext` / `writeMemory` / `exposeTools` 默认 `false`；`localArchive` 默认 `true`。

### 修复（发布前自查）
- 路由注册签名对齐 `WebRoute` 真实契约（只有 `path` / `handler`，无 `method` 字段），改为单 prefix 入口 + 内部分发。
- 面板位置不再与 dsh-cua 面板重叠。
- 构建加 `charset: 'utf8'`，产物保留中文原文。

### 验证
- 51 项回归全绿（`npm test`）。
- 产物依赖面与六份关键文件的安全自检通过（`npm run verify`）。
