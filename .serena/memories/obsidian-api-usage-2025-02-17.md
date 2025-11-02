# 2025-02-17 Obsidian API 使用核查
- FastTemplater 插件核心类 `FastTemplater` 仅依赖官方 `obsidian` 包（插件生命周期、StatusBar、Vault 监听等）。
- 辅助功能依赖本地模块与 `yaml` 库（取代旧的 js-yaml），未发现使用非官方 Obsidian 内部接口。