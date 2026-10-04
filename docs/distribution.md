# 分发与发布状态

[← README](../README.md)

## 当前：GitHub 固定版本

使用官方插件管理器的 Git 安装来源：

```text
github:yintaocheng/dsh-github-harness#v0.3.0
```

该标签指向插件源码，不是[演示项目](https://github.com/yintaocheng/dsh-github-harness-demo)。具体桌面安装与启用步骤见[桌面文档](desktop.md)。本包无需构建或安装生命周期脚本，可使用 `--ignore-scripts`。

## npm：暂缓，不宣称已经上架

按维护者当前决定，暂停 npm 登录与发布。`package.json` 已准备 `name/version/license/repository/keywords/publishConfig`，但**元数据准备不等于 npm 发布**。

当前不要以包名 `dsh-github-harness@0.3.0` 从 npm 或镜像安装。未来恢复发布时，需要先验证官方 registry 上的版本、可下载 tarball 与 integrity，再核验镜像是否同步；不能用 GitHub 安装成功替代这些检查。没有修改全局 npm registry、关闭 TLS 或将 token 放进仓库。

## CLI 与 Host 的依赖边界

| 入口 | 执行方式 | SDK 来源 |
| --- | --- | --- |
| CLI | Node 运行 `src/cli.mjs`；配置指向目标仓库及 headless 命令 | 自身仅用 Node 内置模块，不加载 Host SDK |
| DSH bundle / Host | 官方插件管理器安装并启用，注册 `github_harness` | 宿主提供 tools、sandbox、sandboxPolicy 等服务 |

[包清单](../package.json)保留 Cordis `~4.0.4` 与 DSH SDK `0.2.0-rc.2` 的兼容范围。宿主 peers 在 npm 元数据中为 optional，使纯 CLI 安装不强制下载另一套宿主；**不放宽 Host 版本要求**，也不移除 tools / sandboxPolicy 必要注入或审批机制。

未挂载宿主 SDK 的普通 Node 环境不能把包根 Host 入口当作 CLI 来 import。不要用 `--force`、版本豁免或复制 runtime 来掩盖不兼容。

## 内容与验证

分发 allowlist 仅包含运行源码、bundle patch、通用配置模板、Windows 凭据桥、许可证和使用文档。不包含目标仓库、任务状态、测试临时目录、本地配置、`.harness/`、`.reference/` 或具体演示证据。

维护者应在发布前分别检查：

1. 插件回归测试与相对文档链接。
2. 分发文件清单与敏感内容。
3. 官方 CLI 在隔离 profile 中安装准确标签。
4. 真实 Loader 注册、受限策略拒绝、显式目标目录的工具调用。
5. 上传后的固定 SHA、许可证和对应 CI，而不只检查本地文件。

[演示仓库](https://github.com/yintaocheng/dsh-github-harness-demo)保存具体运行与安装验证证据；本页定义分发方式，不混入个别任务的测试计数。

## 许可证与发现

[MIT 许可证](../LICENSE)，Copyright (c) 2026 yintaocheng。再分发须保留版权及许可证文本。

主仓库已设置 [`dsh-plugin`](https://github.com/topics/dsh-plugin) GitHub topic，npm keywords 也包含该值。标签帮助插件发现，但不是 DeepSeek 官方背书，也不保证所有第三方目录即时收录。演示仓库不打 `dsh-plugin` 标签，避免被误当作安装包。
