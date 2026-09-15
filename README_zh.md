# Orca DAG — 个人工作流分支

本分支使用 **group 讨论形成规格 → 受监督实现 → 渐进改进** 的工作流。源代码位于 [marshyunlee/Orca-Orchestration](https://github.com/marshyunlee/Orca-Orchestration)，基于 [ZinkLu/Orca-Orchestration](https://github.com/ZinkLu/Orca-Orchestration)，保留 MIT 许可。上游 npm 发布不包含本分支的定制。

## 工作流

1. 用户选择现有会话参加 group 讨论，在 work-vault 中维护一份交付规格。简单任务也可直接与协调者讨论。
2. 用户接受经过检查的文档后，协调者逐字节保存 accepted-spec.md，并在实现简报中记录摘要和决策来源。代理达成共识不等于用户授权实现。
3. 获得实现授权后创建独立的实现 Run，引用设计 Run 与已接受的规格，不重新进行完整设计访谈。
4. viewer 只显示原生任务、依赖、规格、结果和实际 Dispatch/终端标识。执行、问题、决策及清理由协调者会话负责。
5. 修复遵循现有契约；行为变化修改相关规格；独立交付建立新 Run。小迭代保留原有历史。

## 安装与使用

需要支持 Run/Task/Dispatch 的 Orca 和 Node.js 20 或更高版本。协调工作前读取当前版本的 `orca skills get orchestration`。

```sh
npm ci --registry=https://registry.npmjs.org --ignore-scripts
npm run build:npm
ORCA_DAG_NO_SKILL=1 NO_OPEN=1 node dist-npm/bin/orca-dag.mjs
```

在 Orca 浏览器打开 `http://127.0.0.1:8787`。服务器仅监听回环地址。`PORT` 更改端口；`WORKSPACE_DIR` 指定偏好文件目录，不控制 worker 位置。`NO_OPEN=1` 禁止自动打开浏览器；`ORCA_DAG_NO_SKILL=1` 或 `--no-skill` 禁止自动安装 skill。

utils 安装使用 `node ~/.orca/orca-dag/start.mjs`。构建后只需重启 viewer，无需重启 Orca。保留 Claude/Codex 的 SSOT 链接。

选择 Run 后点击节点查看详情。默认启用 **Show completed tasks**；关闭后隐藏无关的已完成历史，但保留活动任务的已完成祖先和未决 gate 需要的节点。总计仍反映整个 Run，并单独显示隐藏数量。刷新失败会标明数据可能过时；切换 Run 会清除旧选择并拒绝旧请求的迟到结果。

viewer 没有创建 Run、执行、停止、解决 gate、模型选择或清空任务按钮，也不接管协调者或消费其邮箱。gate 显示问题、选项、状态和结果；用户在协调者会话中回复。任务完成不等于用户接受交付。

布局与选中的 Run 会保存。旧的 harness/model/并发偏好被保留，但不会影响执行或身份显示。历史开关在页面重载时恢复默认。

## API 与验证

可用接口：GET `/api/health`、GET `/api/runs`、GET `/api/dag?run=<id>`、GET `/api/config`、PUT `/api/config`。旧执行和编排变更接口返回 404；无 work-vault 文件读取接口。

```sh
npm test
./node_modules/.bin/tsc -p server/tsconfig.json --noEmit
npm run build:npm
node scripts/check-skill.mjs
```

测试使用现有 tsx 和 Node 测试运行器。`build:npm` 包含前端类型检查、构建和包暂存。`npm run dev` 启动 Vite/API；可选的 `build:binary` 需要 Bun。

`uninstall --dry-run` 预览卸载，`--purge` 删除所选偏好文件。卸载保留目录符号链接指向的仓库，可清理旧版本遗留的协调者终端；它不属于观察或 worker 清理流程。安装与卸载保持对称。

先推送个人 fork，再更新 utils 子模块指针和内容完全一致的 skill 镜像。保留 MIT 版权信息，不在个人安装流程中发布 npm 包或 release tag。文件职责与完整英文说明见 [README.md](README.md)。
