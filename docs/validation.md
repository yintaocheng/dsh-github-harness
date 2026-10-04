# 测试与证据索引

[← README](../README.md)

插件的自动回归测试位于本仓库：

```sh
node --test test/*.test.mjs
```

CI 测试、包内容检查与宿主接口检查用于维护插件本身，不把它们混算成目标任务的验收结果。

**具体演示过程、Issue / PR / 提交 / session / 测试计数与 CI 链接，已迁至[独立演示仓库](https://github.com/yintaocheng/dsh-github-harness-demo)。**

- [分离前的历史记录](https://github.com/yintaocheng/dsh-github-harness-demo/blob/main/evidence/history-before-separation.md)：保留原插件仓库的事实链接，明确不是新演示仓库的执行。
- 新目标项目的任务与结果由演示仓库维护；不转移原 PR、不改写历史、不自动合并。
- [分发说明](distribution.md)：npm 包、镜像源和宿主兼容要求；发布状态必须以实际 registry 结果为准。
- [项目与任务模型](project-model.md)：跨项目隔离、旧任务兼容和未来参与者边界。
