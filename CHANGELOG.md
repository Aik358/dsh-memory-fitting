# Changelog

All notable changes to this project are documented here.

## [0.1.9] — 2026-09-16

文档与测试补齐。

### 新增

- README（中/英）新增「这些数据将来能干什么」小节：纠正率怎么读、怎么一键导出、导出格式长什么样。
- 回归测试从 51 项扩到 **57 项**，覆盖新增的统计 / 导出 / 配置迁移端点与双语 UI。

### 说明

本版没有功能变更，只是把前几版新增的能力在文档与测试里补齐。

## [0.1.8] — 2026-09-16

配置迁移。

### 新增

- `GET /api/memory-fitting/config-export` / `POST /api/memory-fitting/config-import`。
- 设置页新增「配置迁移」区：**导出配置**（复制 JSON 到剪贴板）与**导入配置**。

### 设计说明

导入走**白名单**：只接受已知的配置字段，多余的一律丢弃。这样即使粘贴了别的东西进来，也不会把脏数据写进配置文件。

## [0.1.7] — 2026-09-16

悬窗 UI 双语化。

### 新增

- 悬窗完整双语（中/英），与 `README` / `USER-GUIDE` 的双语体系对齐。
- 标题栏新增语言切换按钮（`EN` / `中`），选择持久化在 `localStorage`。
- 首次使用按 `navigator.language` 自动判断，中文环境默认中文。

### 设计说明

UI 语言**存在 localStorage，不进插件配置** —— 改语言不该触发服务端写盘，也不该和"污染面开关"混在一起。

## [0.1.6] — 2026-09-16

被拒提案开始记录「错在哪」。

### 新增

- `memory_fit_archive` 增加 `rejectedReason` 参数。当用户**拒绝**提案时，模型必须说明错在哪：
  - 用户选了另一个方向 → 这是明确的纠错信号
  - 用户说"都不对" → 说明预设方向本身跑偏了，信号更强
- 被拒时自动写入一条 `verdict: "corrected"` 的 `fit/feedback`，带上 `rejectedReason`。

### 为什么这是最高价值的信号

`docs/TRAINING.md` 里写过：**拟合数据的含金量不取决于条数，取决于纠正率。**

「用户直接接受」的样本里，模型本来就猜对了 —— 几乎不含信息。
「用户纠正了」的样本才是偏好对的天然来源：**同样的输入，模型给了 X，正确答案是 Y。**

0.1.2 加了字段但没人填；这一版把它接进了实际流程。

## [0.1.5] — 2026-09-16

留档页可以一键导出训练数据。

### 新增

- `GET /api/memory-fitting/export`：把留档导出为偏好对（与 `scripts/export-training.mjs` 同一套逻辑）。
- 悬窗「留档」页新增 **「导出偏好对」** 按钮 —— 点一下把 JSONL 复制到剪贴板，可以直接粘进训练脚本。

### 说明

命令行版（`npm run export`）适合写进流水线；悬窗版适合随手取用。两者产出格式完全一致。

## [0.1.4] — 2026-09-16

留档页显示「这批数据有没有用」。

### 新增

- `GET /api/memory-fitting/stats`：统计留档的题目数、已答数、verdict 分布与**纠正率**。
- 悬窗「留档」页顶部新增统计卡：`已答 N 题 · 纠正率 X%`，并给出一句判断 —— 纠正率 ≥20% 说明样本有信息量，偏低则说明模型大多猜对、样本信息量有限。

### 为什么加这个

拟合留档不只是日志，它是训练样本（见 `docs/TRAINING.md`）。而**判断数据值不值得训**的关键指标就是纠正率：

- 纠正率高 → 模型经常猜错，样本含金量高
- 纠正率低 → 模型本来就猜对，样本几乎是噪声

把这个数字摆在用户眼前，比在文档里说一遍有用。

## [0.1.3] — 2026-09-16

训练数据导出（`docs/TRAINING.md` 阶段 1 第三项待补项）。

### 新增

- **`scripts/export-training.mjs`**：把拟合留档导出为**偏好对**格式。
  - 输出 JSONL，每行 `{ prompt, chosen, rejected, verdict, scope, meta }`
  - `--intent-only`：只导出 `scope=intent`（训练时必用，防止学到用户的事实性错误）
  - `--out <file>`：指定输出路径
  - 顺带打印 **verdict 分布与纠正率** —— 纠正率越高，样本越有信息量
- `npm run export` / `npm run release` 两个快捷脚本。

### 设计说明

导出的两种样本：
1. **每轮问答**：prompt = 触发语 + 问题；chosen = 用户实际选择；rejected = 其余选项
2. **收敛结论**：prompt = 触发语 + "判断用户最终想要哪个方向"；chosen = 收敛方向；rejected = 落选方向

第二种是最有价值的样本 —— 它直接对应"模型面对同样的模糊输入，应该收敛到哪个方向"。

## [0.1.2] — 2026-09-16

训练就绪字段补全（对齐 `docs/TRAINING.md` 阶段 1 的待补项）。

### 新增

- `fit/feedback` 增加三个字段：
  - **`scope`**：`intent`（可进画像）或 `fact`（只走纠正通道）。训练时**只取 `intent`** —— 否则会把用户的事实性错误学成偏好，变成谄媚。
  - **`rejectedReason`**：提案被拒时"错在哪"。比单纯的 `rejected` 更有信息量。
  - **`deliberate`**：用户是深思熟虑还是随手一点，用于样本质量分层。
- 发布助手 `scripts/release.mjs`：一条命令走完 bump → 构建 → 测试 → 提交 → 推送 → tag → npm。

### 说明

这三个字段现在只是**在采集**，尚未被任何训练流程消费。它们的价值在于：等端侧模型可训练时，不必回头重采。

## [0.1.1] — 2026-09-16

文档发布。

### 新增

- **双语 README**：`README.md`（中文）与 `README_EN.md`（English），顶部带按钮式语言切换。
- **双语用户手册**：`USER-GUIDE.md` / `USER-GUIDE_EN.md` —— 覆盖「什么时候用 / 三分钟跑通 / 三个页签 / 开关怎么设 / 两种发起方式 / 留档结构 / FAQ / 数据与隐私」。
- **训练路线图**：`docs/TRAINING.md` / `docs/TRAINING_EN.md` —— 说明如何从当前的上下文拟合，过渡到未来的偏好训练（LoRA / DPO），含数据量分界、三阶段路线，以及"意图层拟合 / 事实层绝不拟合"的边界约束。
- 宣传横幅 `docs/promo/banner.svg`。

### 变更

- npm 包 `files` 增加 `docs` 与两份 README / 手册。

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
- 训练就绪的 `fit/feedback` 四元组采集（context / modelDid / userSaid / verdict / preference）。

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
