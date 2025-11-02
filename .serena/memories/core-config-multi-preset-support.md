# 2025-02-18 Core Config Multi-Preset Support
- `fast-templater-config` frontmatter 鍵現已支援 `string[]`，會依序收集所有對應的預設。
- 合併邏輯集中於 `src/utils/fast-templater-config.ts` 與 `src/ui/frontmatter/preset-field-merger.ts`，標準化 ID 與欄位合併皆可重用。
- `FrontmatterManagerModal` 以合併後的預設陣列啟動，`tags` 欄位會強制升級為 multi-select 並整合選項。