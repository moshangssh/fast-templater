# 2025-02-20 SimpleConfirmModal 组件化
- 将通用确认模态框从 `fast-templater-setting-tab.ts` 抽离至 `src/ui/simple-confirm-modal.ts`，可在多处复用。
- 新文件导出 `SimpleConfirmModal` 与配置接口，原设置页通过导入使用。
- 构建已通过 `npm run build` 验证。