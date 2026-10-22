# DSH 版本与升级

[← README](../README.md)

## 支持的版本

推荐 **DSH 0.2.1-rc.2**；同时支持 **0.2.0-rc.2**。这是两个分别验证的精确版本，不是“所有更新版本均兼容”的承诺。Node.js 需要 22+。

`doctor` 先执行 `--version`，只有版本在支持列表中才继续执行 `--help`；它返回实际版本和失败原因。未知版本不会加载其 profile。`run` 在获取 GitHub 凭据或改动仓库前只做版本预检，真正的 headless 启动在任务锁内进行；未知版本、无法识别的版本、启动失败或超时都会停止。`status` 不启动 DSH，可离线排查；本地记录损坏或冲突时仍会明确拒绝。

桌面宿主版本与配置中的 headless 命令版本可能不同，**两者都要核对**。更新了桌面，但仍指向旧的 CLI 路径，不代表任务已经使用新版。

## 如何升级

1. 从 [DSH 官方页面](https://www.deepseek.com/harness)更新桌面，并按提示完全退出后重新启动。
2. 若单独使用 npm CLI，安装明确版本：

   ```sh
   npm install --global @deepseek-ai/dsh@0.2.1-rc.2
   dsh --version
   dsh headless --version
   ```

3. 检查目标项目配置中的 `dsh.command` 是否指向预期安装，然后运行 `doctor`。
4. 用同一目标目录和 Issue 再次运行。正常升级不需要重新创建分支、PR 或任务缓存。

模型凭据和路由仍需单独验证；版本检查通过不等于模型可用。不要通过版本豁免、手工复制 SDK 或关闭 TLS 校验绕过问题。插件的 SDK peers 由宿主提供，不要另行安装 SDK 的 `latest` 来“修复”它。

## 不要重建已有 profile

**不要把 `--from-default-profile` 放进任务启动命令。** DSH 0.2.1 的该选项会替换已有自定义 profile，包括依赖和用户 patch，即使同时指定 `--help` 或配置导出。插件会拒绝这样的命令。

该选项只适合确认不存在的、一次性测试 profile。升级现有安装应按官方升级指南进行，不要把初始化命令当更新命令。

## 工作目录与会话

- 工具的相对 `workdir` 仍相对会话原始工作区，不跟随 DSH 后续切换的执行目录；绝对路径始终指定明确目标。
- 续跑需要原本的根会话、持久化历史和工作目录。子会话、fork 会话、未知 ID 或目录不匹配不能当作新任务静默继续。
- 当前执行的根会话凭据必须与同一 `runId` 绑定日志的 NDJSON 开头一致；重新启动时也检查这一绑定。请完整保留任务状态与对应日志，不要只删除日志而留下凭据文件。
- 冲突记录会保留并标记为拒绝，下一次调用不能把它当作旧记录继续。先核对原会话、本地状态和日志，不要复制其他任务缓存、清掉错误记录后盲目重建，或手工改 ID 强行通过。
- 旧格式凭据仅在与已有任务状态或经认证的 PR / Issue 检查点身份一致时可继续。只有旧凭据、没有独立身份记录时，需人工核对，不能静默推断根会话。

## 验证边界

在 Windows 上分别安装两个版本的真实宿主，验证了插件 Loader、native 与 PTC 的规范输出、项目隔离、受限策略下的拒绝，以及卸载时取消进行中的调用。自动回归还覆盖版本检查、根会话恢复和发布前验证约束。

隔离的 CLI / Host 验证不代表已经替用户在运行中的桌面 GUI 完成更新。支持声明基于明确版本和实际验证，不把公开源码标签与桌面安装包的每个字节视为相同。

参考：[0.2.1-rc.2 官方发布](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2) · [profile 替换行为](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/docs/upgrade-guide/v0.2.1-alpha.2/from-default-profile-replaces-target/guide.md) · [插件版本声明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/docs/upgrade-guide/v0.2.1-alpha.3/plugin-engines-dsh/guide.md)
