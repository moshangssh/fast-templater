# 2025-02-16 构建修复
- 清理 src/core/UiRegistrar.ts 与 src/ui/template-preset-binding-modal.ts 中遗留的 "\t" 字面量缩进导致的 TypeScript 构建报错，统一改为空格缩进。
- 为 FrontmatterPreset/FrontmatterField 补充可选 description 字段，FastTemplaterSettings 补充 enableDynamicPresetSelection 属性，保持动态预设选择相关功能类型一致。
- 重新运行 `npm run build` 已通过。