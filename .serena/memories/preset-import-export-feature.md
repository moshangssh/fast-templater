2025-02-14：实现 Fast Templater 预设导入导出与剪贴板分享。
- PresetManager 新增 exportPreset/importPreset，包含格式校验与冲突处理（自动重命名或覆盖）。
- 设置页每个预设提供导出/复制按钮；列表头部新增“从文件导入”“从剪贴板粘贴”，并在冲突时弹窗询问策略。

2025-02-15：修复 frontmatter 预设文件导入被误判为“未选择文件”的问题。
- 设置页 `pickPresetFile` 允许 `.json,application/json`，同时在窗口重新聚焦时再次读取已选择的文件，确保导出文件能正常导入。
