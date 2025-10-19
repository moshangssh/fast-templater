import type { SettingsManager } from "@settings";
import { PresetManager } from "@presets";
import {
	DEFAULT_SETTINGS,
	type FastTemplaterSettings,
	type FrontmatterPreset,
} from "@types";

const createManager = (presets: FrontmatterPreset[] = []) => {
	const settings: FastTemplaterSettings = {
		...DEFAULT_SETTINGS,
		frontmatterPresets: presets.map((preset) => ({
			...preset,
			fields: [...preset.fields],
		})),
	};

	const save = jest.fn().mockResolvedValue(settings);
	const settingsManager = {
		getSettings: () => settings,
		save,
	} as unknown as SettingsManager;

	return {
		manager: new PresetManager(settingsManager),
		settings,
		save,
	};
};

describe("PresetManager 预设ID生成", () => {
	it("应当根据名称生成易读的引用ID", () => {
		const { manager } = createManager();

		expect(manager.generateUniquePresetId("Project Template")).toBe("project-template");
	});

	it("应当在名称包含非ASCII字符时生成可读编码", () => {
		const { manager } = createManager();

		expect(manager.generateUniquePresetId("示例配置")).toBe("u793a-u4f8b-u914d-u7f6e");
	});

	it("应当为重复名称追加递增序号保证唯一性", () => {
		const existing: FrontmatterPreset = {
			id: "project-template",
			name: "Existing",
			fields: [],
		};
		const { manager } = createManager([existing]);

		expect(manager.generateUniquePresetId("Project Template")).toBe("project-template-2");
	});

	it("createPreset 在仅提供名称时应自动生成唯一ID并持久化", async () => {
		const { manager, settings, save } = createManager();

		const preset = await manager.createPreset({ name: "示例配置" });

		expect(preset.id).toBe("u793a-u4f8b-u914d-u7f6e");
		expect(settings.frontmatterPresets).toHaveLength(1);
		expect(settings.frontmatterPresets[0].id).toBe(preset.id);
		expect(save).toHaveBeenCalled();
	});
});
