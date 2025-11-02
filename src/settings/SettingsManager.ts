import type NoteArchitect from "@core/plugin";
import { handleError } from "@core/error";
import { DEFAULT_SETTINGS } from "@types";
import type {
	NoteArchitectSettings,
	FrontmatterField,
	FrontmatterPreset,
} from "@types";

export interface SaveSettingsOptions {
	onAfterSave?: () => void;
	reloadTemplates?: () => Promise<unknown>;
}

type PartialSettings = Partial<NoteArchitectSettings>;

const VALID_FIELD_TYPES: FrontmatterField["type"][] = ["text", "select", "date", "multi-select"];

export class SettingsManager {
	private readonly plugin: NoteArchitect;
	private settings: NoteArchitectSettings;

	constructor(plugin: NoteArchitect) {
		this.plugin = plugin;
		this.settings = { ...DEFAULT_SETTINGS };
	}

	getSettings(): NoteArchitectSettings {
		return this.settings;
	}

	async load(): Promise<NoteArchitectSettings> {
		try {
			const rawData = await this.plugin.loadData();
			this.settings = this.normalizeSettings(rawData as PartialSettings);
		} catch (error) {
			handleError(error, {
				context: "SettingsManager.load",
				userMessage: "Note Architect: 加载设置失败，使用默认设置",
			});
			this.settings = { ...DEFAULT_SETTINGS };
		}

		return this.settings;
	}

	async save(settings: NoteArchitectSettings = this.settings, options: SaveSettingsOptions = {}): Promise<NoteArchitectSettings> {
		this.settings = this.normalizeSettings(settings);

		try {
			await this.plugin.saveData(this.serializeSettings(this.settings));

			options.onAfterSave?.();
			if (options.reloadTemplates) {
				await options.reloadTemplates();
			}
		} catch (error) {
			handleError(error, {
				context: "SettingsManager.save",
				userMessage: "Note Architect: 保存设置失败",
			});
		}

		return this.settings;
	}

	private migrateSettingsData(data: PartialSettings): PartialSettings {
		if (!data || typeof data !== "object") {
			return {};
		}

		const sanitizedData: PartialSettings = {
			...data,
			frontmatterPresets: Array.isArray(data.frontmatterPresets) ? data.frontmatterPresets : [],
		};

		if (typeof data.defaultDateFormat === "string") {
			const trimmed = data.defaultDateFormat.trim();
			if (trimmed) {
				sanitizedData.defaultDateFormat = trimmed;
			} else {
				delete sanitizedData.defaultDateFormat;
			}
		}

		return sanitizedData;
	}

	private normalizeSettings(data: PartialSettings): NoteArchitectSettings {
		const migrated = this.migrateSettingsData(data);

		return {
			...DEFAULT_SETTINGS,
			...migrated,
			defaultDateFormat: this.normalizeDefaultDateFormat(migrated.defaultDateFormat),
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

				if (field.useTemplaterTimestamp === true) {
					sanitized.useTemplaterTimestamp = true;
				}

				return sanitized;
			});
	}

	private serializeSettings(settings: NoteArchitectSettings): NoteArchitectSettings {
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
					...(field.useTemplaterTimestamp ? { useTemplaterTimestamp: true } : {}),
				})),
			})),
			defaultDateFormat: this.normalizeDefaultDateFormat(settings.defaultDateFormat),
			recentlyUsedTemplates: settings.recentlyUsedTemplates,
			enableDynamicPresetSelection: settings.enableDynamicPresetSelection,
		};
	}

	private normalizeDefaultDateFormat(value: PartialSettings["defaultDateFormat"]): string {
		if (typeof value !== "string") {
			return DEFAULT_SETTINGS.defaultDateFormat;
		}

		const trimmed = value.trim();
		return trimmed || DEFAULT_SETTINGS.defaultDateFormat;
	}
}
