# Orca DAG — 个人工作流分支

交互式群组看板支持 **群组讨论规格 → DAG 规划 → Preview → 受监督实现 → 渐进改进**，并保留原生 Orca 历史视图。个人源码位于 [marshyunlee/Orca-Orchestration](https://github.com/marshyunlee/Orca-Orchestration)，基于 [ZinkLu/Orca-Orchestration](https://github.com/ZinkLu/Orca-Orchestration)，保留 MIT 许可。上游 npm 包不包含此定制。

## 使用流程

1. 创建群组标签页，立即获得可编辑 Run 根节点。在 Manage sessions 中选择现有会话和协调者。
2. 输入请求并选择 Discuss with group。协调者运行有限轮次的讨论，发布有来源的成员意见与规格。用户满意后点击 Approve spec。
3. Generate tasks 生成任务和依赖。检查器可修改 Prompt、Plan、Design 和执行者；拖动节点、连接端点、选中节点或边后删除。
4. Review graph / Update preview 生成预期交付物、示例和验收条件，不执行实现。Start 同时接受当前 Preview 并授权执行。
5. 通过 Pause、Send guidance、Stop and rerun 或原生问题回复介入。编辑运行中任务会暂停下游启动。审阅指导后的结果，明确接受其适用于新版本，再更新 Preview 并 Resume。
6. 全部工作结算后使用 New increment，保存旧交付历史并保留群组、Run 根和规格。

协调者通过打包的 `boardctl` 执行原生操作。服务器保存编辑、串行准入并观察结果；不获取协调者身份或消费邮箱。现有成员保留身份和会话。未知结果保持可见，需按原始请求核对，不能盲目重发。旧任务和尝试证据不可改写。

Implementation 面板读取真实工作区文件，支持文本或统一 diff。Save file draft 只存草稿，Apply 才明确写入；写入前检查原始摘要和路径，有活动写入者时拒绝 Apply。冲突比较保留用户草稿。Preview 展示文本和受限的 PNG/JPEG/WebP/GIF 模型图，图片通过受保护的看板制品读取，不执行 agent HTML。

## 构建与启动

需要 Node.js 20+ 和运行中的 Orca。原生编排前读取安装版本的 `orca skills get orchestration`。

```sh
npm ci --registry=https://registry.npmjs.org --ignore-scripts
npm run build:npm
ORCA_DAG_NO_SKILL=1 NO_OPEN=1 node dist-npm/bin/orca-dag.mjs
```

打开 `http://127.0.0.1:8787`。服务仅监听 loopback。`PORT` 修改端口，`WORKSPACE_DIR` 指定查看器配置目录而非任务工作区，`NO_OPEN=1` 不自动打开浏览器，`ORCA_DAG_NO_SKILL=1` 或 `--no-skill` 关闭自动技能安装。

utils 安装使用 `node ~/.orca/orca-dag/start.mjs`，并提供 `ORCA_GROUP_HELPER`、`ORCA_WORK_CONTEXT_HELPER` 与 `ORCA_BOARD_ROOT`。默认数据目录为 `~/work-vault/sessions/orca-boards`。独立安装须配置群组帮助器和现有会话解析器。无法确认的会话身份不可以标签名猜测。

看板及证据在重启后保留；私密令牌位于同步目录之外的 `~/.local/state/orca-board`。同一数据目录只允许一个活动写入服务。`ORCA_CLI_COMMAND` 统一选择原生命令，开发环境可用 `ORCA_BOARD_DEV_ORIGIN` 指定准确 Vite origin。重新构建后只需重启查看器，不必重启 Orca。

## 历史、接口和验证

Native run history 保持只读，显示原生规格、结果、依赖与尝试身份。完成任务过滤保留活动工作的已完成祖先和未解决决策；计数始终涵盖整个 Run。刷新失败时保留旧数据并显示错误。布局和所选 Run 保存到配置；旧模型/并发字段保留但不控制执行。原生完成不表示用户验收。

原生 GET `/api/health`、`/api/runs`、`/api/dag?run=<id>` 与配置接口保留。看板通过 `/api/boards` 及版本检查的 `/api/boards/:id/edit` 变更。私密文件、集成、会话和写入接口需要本地令牌；写入也检查 origin。不支持的接口返回 404，没有任意 shell 执行接口。CLI 位于 `dist-npm/bin/boardctl.mjs`。

```sh
npm test
./node_modules/.bin/tsc -p server/tsconfig.json --noEmit
npm run build:npm
node scripts/check-skill.mjs
```

测试使用 Node runner 与 tsx；打包包含前端类型检查及构建。可选二进制构建需要 Bun。不要提交生成文件。卸载支持 `--dry-run`，`--purge` 额外删除所选偏好文件；保留符号链接后的仓库文件。卸载不是活动 worker 的清理方式。

先推送个人 fork，再更新 utils 子模块与逐字一致的技能镜像。保留 MIT 声明，不发布 npm 包或 release tag。

## Collaborate component integration

Start or resume the same UI board from chat with the packaged `boardctl create` / `resume` commands. Component tasks use one expandable node. Select the component master and its collaborate manifest in the task panel; the master retains its registered feature workspace and native Run.

The panel displays the exact gate package, implementation/review/repair history, saved briefs/reports, launch journals and selected-result evidence. Approve each concrete gate once in chat or UI. Gate or scope changes invalidate that approval. Guidance, stop preparation and question answers route to the component master. Pause blocks future restricted child launches, including reviews and repairs. Unknown receipts require reconciliation, never blind retries.

The utils launcher also supplies `ORCA_FEATURE_WORKTREE_HELPER` and `ORCA_COLLABORATE_LEDGER_HELPER`. Standalone installations configure these existing collaborate/worktree helpers for component support. `ORCA_COLLABORATE_ROOT`, `ORCA_COLLABORATE_BULK_ROOT`, and `ORCA_BOARD_RUNTIME` can isolate fixture directories. Private tokens stay outside work-vault. See the packaged skill and `boardctl --help` for exact JSON examples and recovery commands.

New human steps for component execution: select a master/manifest, approve its concrete gate when presented, and review changed gates before continuing. Direct task controls retain their existing workflow.
