import { Notice } from "obsidian";
import type FastTemplater from "@core/plugin";
import { DEFAULT_SETTINGS } from "@types";
import type {
	FastTemplaterSettings,
	FrontmatterField,
	FrontmatterPreset,
} from "@types";

export interface SaveSettingsOptions {
	onAfterSave?: () => void;
	reloadTemplates?: () => Promise<unknown>;
}

type PartialSettings = Partial<FastTemplaterSettings>;

const VALID_FIELD_TYPES: FrontmatterField["type"][] = ["text", "select", "date", "multi-select"];

export class SettingsManager {
	private readonly plugin: FastTemplater;
	private settings: FastTemplaterSettings;

	constructor(plugin: FastTemplater) {
		this.plugin = plugin;
		this.settings = { ...DEFAULT_SETTINGS };
	}

	getSettings(): FastTemplaterSettings {
		return this.settings;
	}

	async load(): Promise<FastTemplaterSettings> {
		try {
			const rawData = await this.plugin.loadData();
			this.settings = this.normalizeSettings(rawData as PartialSettings);
		} catch (error) {
			console.error("Fast Templater: 加载设置失败", error);
			new Notice("Fast Templater: 加载设置失败，使用默认设置");
			this.settings = { ...DEFAULT_SETTINGS };
		}

		return this.settings;
	}

	async save(settings: FastTemplaterSettings = this.settings, options: SaveSettingsOptions = {}): Promise<FastTemplaterSettings> {
		this.settings = this.normalizeSettings(settings);

		try {
			await this.plugin.saveData(this.serializeSettings(this.settings));

			options.onAfterSave?.();
			if (options.reloadTemplates) {
				await options.reloadTemplates();
			}
		} catch (error) {
			console.error("Fast Templater: 保存设置失败", error);
			new Notice("Fast Templater: 保存设置失败");
		}

		return this.settings;
	}

	private migrateSettingsData(data: PartialSettings): PartialSettings {
		if (!data || typeof data !== "object") {
			return {};
		}

		return {
			...data,
			frontmatterPresets: Array.isArray(data.frontmatterPresets) ? data.frontmatterPresets : [],
		};
	}

	private normalizeSettings(data: PartialSettings): FastTemplaterSettings {
		const migrated = this.migrateSettingsData(data);

		return {
			...DEFAULT_SETTINGS,
			...migrated,
			frontmatterPresets: this.sanitizeFrontmatterPresets(migrated.frontmatterPresets),
		};
	}

	private sanitizeFrontmatterPresets(presets: FrontmatterPreset[] | undefined): FrontmatterPreset[] {
		if (!Array.isArray(presets)) {
			return [];
		}

		const normalizedPresets = presets
			.filter((preset) => {
				return Boolean(
					preset &&
					typeof preset === "object" &&
					preset.id &&
					preset.name &&
					Array.isArray(preset.fields)
				);
			})
			.map((preset) => ({
				...preset,
				fields: this.sanitizeFrontmatterFields(preset.fields),
			}));
		// 允许创建后再配置字段，因此不再过滤空字段预设
		return normalizedPresets;
	}

	private sanitizeFrontmatterFields(fields: FrontmatterField[]): FrontmatterField[] {
		return fields
			.filter((field) => {
				return Boolean(
					field &&
					typeof field === "object" &&
					field.key &&
					field.type &&
					field.label &&
					typeof field.default === "string"
				);
			})
			.map((field) => {
				const type = VALID_FIELD_TYPES.includes(field.type) ? field.type : "text";
				const sanitized: FrontmatterField = {
					key: field.key,
					type,
					label: field.label,
					default: field.default,
				};

				if (Array.isArray(field.options) && field.options.length > 0) {
					sanitized.options = field.options;
				}

				return sanitized;
			});
	}

	private serializeSettings(settings: FastTemplaterSettings): FastTemplaterSettings {
		return {
			templateFolderPath: settings.templateFolderPath,
			enableTemplaterIntegration: settings.enableTemplaterIntegration,
			enableFrontmatterMerge: settings.enableFrontmatterMerge,
			frontmatterPresets: settings.frontmatterPresets.map((preset) => ({
				id: preset.id,
				name: preset.name,
				fields: preset.fields.map((field) => ({
					key: field.key,
					type: field.type,
					label: field.label,
					default: field.default,
					...(Array.isArray(field.options) && field.options.length > 0 ? { options: field.options } : {}),
				})),
			})),
		};
	}
}
