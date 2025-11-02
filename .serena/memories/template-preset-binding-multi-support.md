# TemplatePresetBindingModal 多重綁定支援
- TemplatePresetBindingModal 現在接受 existingIds 陣列，綁定後不會關閉視窗並即時刷新按鈕狀態與解除綁定按鈕的可用性。
- UiRegistrar 讀寫 fast-templater-config 時統一使用 normalizeConfigIds，並將結果寫回 string[] 以支援多重綁定與去重。
- 已加入針對多重綁定與清除流程的 Jest 測試（ui/template-preset-binding-modal 與 core/UiRegistrar）。