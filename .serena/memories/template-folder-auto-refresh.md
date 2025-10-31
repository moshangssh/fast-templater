## 模板文件夹自动刷新
- 为 `TemplateManager` 新增监听 Vault 文件事件的机制，通过节流触发 `reloadTemplates`，当模板目录内的文件新增、修改、删除、重命名时自动刷新缓存。
- 在插件 `onload` 时启动监听，并在 `onunload` 时调用 `dispose` 清理监听，避免事件泄漏。
- 当前监听路径会随 `loadTemplates` 的执行更新，确保在设置中切换模板文件夹后立即生效。