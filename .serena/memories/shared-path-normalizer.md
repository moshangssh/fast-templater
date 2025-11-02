## 通用路径规范化工具
- 新增 `src/utils/path.ts` 导出 `normalizePath` 函数，统一处理正反斜杠与首尾斜杠。
- `TemplateManager` 与 `UiRegistrar` 改为复用该函数，确保模板目录检测在跨平台场景下保持一致。