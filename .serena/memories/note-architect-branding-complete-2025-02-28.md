# Note Architect 品牌重命名完成要点
- 核心设置类型已更名为 `NoteArchitectSettings`，默认导出与 `SettingsManager` 等依赖均已同步更新。
- 旧的 `FastTemplaterSettingTab` 重命名为 `NoteArchitectSettingTab`，并迁移到 `src/ui/note-architect-setting-tab.ts`。
- frontmatter 标识 `fast-templater-config` 已改为 `note-architect-config`，配套工具文件重命名为 `src/utils/note-architect-config.ts`。
- 预设导入导出类型常量更新为 `note-architect-presets`，对应 JSON 文件默认名为 `note-architect-presets.json`。
- 所有 UI/CSS 类名前缀统一为 `note-architect-`，包含样式表与模态交互文本。
- Manifest `id` 仍保持 `fast-templater` 以兼容既有安装位置。