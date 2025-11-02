# 预设重命名ID迁移功能
- 新增 RenamePresetModal，重命名预设时可选择保持ID或生成新ID。
- PresetManager.renamePresetWithIdChange 支持同时更新名称与ID，并返回是否更换ID。
- FastTemplaterSettingTab 在用户选择更新ID时，会先更新模板 frontmatter 中的 fast-templater-config，再写回设定；失败会回滚。
- 更新了 PresetManager 测试覆盖重命名与ID校验场景。