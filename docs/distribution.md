# 安装来源与分发

[← README](../README.md)

## GitHub 固定版本

在 DSH 官方插件管理器中使用：

```text
github:yintaocheng/dsh-github-harness#v0.3.1
```

这是插件源码仓库，不是[演示项目](https://github.com/yintaocheng/dsh-github-harness-demo)。安装后还需启用 bundle，具体步骤见[桌面指南](desktop.md)。本包没有构建或安装生命周期脚本，不需要放行安装脚本。

## npm 来源

npm 与 GitHub 标签是独立的分发渠道。**只有官方 registry 可查、可下载的版本才算已发布**；本地包清单或 GitHub 标签存在不能代替此检查。

先确认所需版本：

```sh
npm view dsh-github-harness@0.3.1 version dist.integrity --registry=https://registry.npmjs.org
```

如果查询不到该版本，使用上方 GitHub 固定标签，不要改用名字相近的包。版本可查后：

- 桌面插件管理器的 npm 来源填写 `dsh-github-harness@0.3.1`，然后按提示启用。
- 仅使用独立 CLI 时：

  ```sh
  npm install --global dsh-github-harness@0.3.1 --registry=https://registry.npmjs.org
  dsh-github-harness help
  ```

镜像可能延迟同步；可用性和 integrity 应与官方 registry 核对。不要关闭 TLS 校验，也不需要为安装本插件改动全局 registry 设置。

## CLI 与 Host 的依赖边界

| 入口 | 执行方式 | SDK 来源 |
| --- | --- | --- |
| CLI | 运行安装后的 `dsh-github-harness`，或 Node 调用 [CLI 入口](../src/cli.mjs) | 自身只用 Node 内置模块，不加载 Host SDK |
| DSH bundle / Host | 官方插件管理器安装并启用，注册 `github_harness` | 宿主提供 tools、sandbox、sandboxPolicy 等服务 |

推荐 DSH `0.2.1-rc.2`，同时支持 `0.2.0-rc.2`。[清单](../package.json)的 `engines.dsh`、SDK peers 和运行前版本预检保持一致；详见[版本与升级](compatibility.md)。Cordis 使用 `~4.0.4`，覆盖两个已验证宿主的版本。

宿主 peers 标为 optional，使纯 CLI 安装不强制下载另一套宿主；这**不豁免 Host 兼容检查**，也不移除必需注入或权限门。普通 Node 环境不能把包根的 Host 入口当 CLI import；不要手工复制 SDK、使用 `--force` 或版本豁免来掩盖不兼容。

## 包中包含什么

分发白名单只包含单 agent 运行源码、bundle patch、通用配置模板、Windows 凭据桥、许可证与使用文档。不包含多 agent / App 协作实现、目标仓库、任务状态、测试 profile、本地模型或账号配置、下载的运行时、`.harness/` 或 `.reference/`。

维护者的发布检查包括回归与重启恢复、打包内容及敏感数据检查、真实宿主安装和 native / PTC 调用、受限权限拒绝、实际任务验证。npm 发布后还需核对 registry tarball、integrity 和全新安装；不能只凭上传命令的输出宣布成功。[演示仓库](https://github.com/yintaocheng/dsh-github-harness-demo)记录具体任务证据，与插件自身回归的测试数分开。

## 许可证与发现

[MIT 许可证](../LICENSE)，Copyright (c) 2026 yintaocheng。再分发须保留版权及许可证文本。

GitHub topic 与 npm keyword 使用 `dsh-plugin`，方便发现插件，但不是 DeepSeek 官方背书，也不保证第三方目录立即收录。演示仓库不是安装包。
