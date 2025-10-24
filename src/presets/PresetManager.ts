import type { SaveSettingsOptions, SettingsManager } from "@settings";
import type {
	FastTemplaterSettings,
	FrontmatterField,
	FrontmatterPreset,
} from "@types";

export interface PresetIdValidationResult {
	isValid: boolean;
	error?: string;
}

export interface CreatePresetPayload {
	id?: string;
	name: string;
	fields?: FrontmatterField[];
}

export class PresetManager {
	private saveOptionsFactory?: () => SaveSettingsOptions | undefined;

	constructor(
		private readonly settingsManager: SettingsManager,
		saveOptionsFactory?: () => SaveSettingsOptions | undefined,
	) {
		this.saveOptionsFactory = saveOptionsFactory;
	}

	private get settings(): FastTemplaterSettings {
		return this.settingsManager.getSettings();
	}

	private get presets(): FrontmatterPreset[] {
		return this.settings.frontmatterPresets;
	}

	setSaveOptionsFactory(factory?: () => SaveSettingsOptions | undefined): void {
		this.saveOptionsFactory = factory;
	}

	generateUniquePresetId(name: string): string {
		const baseId = this.buildBasePresetId(name);

		if (this.isPresetIdFormatValid(baseId) && !this.getPresetById(baseId)) {
			return baseId;
		}

		let suffix = 2;
		const normalizedBase = baseId;

		while (suffix < 10000) {
			const suffixText = `-${suffix}`;
			const availableLength = 50 - suffixText.length;
			let truncatedBase = normalizedBase.slice(0, availableLength).replace(/-+$/g, '');

			if (!truncatedBase) {
				truncatedBase = 'preset';
			}

			const candidate = `${truncatedBase}${suffixText}`;

			if (this.isPresetIdFormatValid(candidate) && !this.getPresetById(candidate)) {
				return candidate;
			}

			suffix++;
		}

		const timestampId = `preset-${Date.now()}`;
		return this.isPresetIdFormatValid(timestampId) && !this.getPresetById(timestampId)
			? timestampId.slice(0, 50)
			: `preset-${Date.now().toString(36)}`.slice(0, 50);
	}

	private buildBasePresetId(name: string): string {
		const trimmedName = name.trim();
		if (!trimmedName) {
			return 'preset';
		}

		const normalized = trimmedName.normalize('NFKD');
		const slugParts: string[] = [];

		for (const char of normalized) {
			const codePoint = char.codePointAt(0);
			if (codePoint === undefined) {
				continue;
			}

			if (/[a-zA-Z0-9]/.test(char)) {
				slugParts.push(char.toLowerCase());
				continue;
			}

			if (char === '-' || char === '_' || /\s/.test(char)) {
				slugParts.push('-');
				continue;
			}

			if (codePoint >= 0x0300 && codePoint <= 0x036f) {
				continue;
			}

			if (codePoint < 128) {
				slugParts.push('-');
				continue;
			}

			slugParts.push(`-u${codePoint.toString(16)}`);
			slugParts.push('-');
		}

		let sanitized = slugParts.join('');
		sanitized = sanitized.replace(/-+/g, '-');
		sanitized = sanitized.replace(/^-+|-+$/g, '');

		if (!sanitized) {
			return 'preset';
		}

		if (!/^[a-z]/.test(sanitized)) {
			sanitized = `preset-${sanitized}`;
			sanitized = sanitized.replace(/-+/g, '-');
			sanitized = sanitized.replace(/^-+|-+$/g, '');
		}

		if (sanitized.length > 50) {
			sanitized = sanitized.slice(0, 50).replace(/-+$/g, '');
			if (!sanitized) {
				return 'preset';
			}
		}

		if (sanitized.length < 2) {
			return 'preset';
		}

		return sanitized;
	}

	private isPresetIdFormatValid(id: string): boolean {
		return this.getPresetIdFormatError(id) === null;
	}

	private getPresetIdFormatError(id: string): string | null {
		if (!id) {
			return "预设ID不能为空";
		}

		if (id.length < 2) {
			return "预设ID长度至少为2个字符";
		}

		if (id.length > 50) {
			return "预设ID长度不能超过50个字符";
		}

		if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id)) {
			return "预设ID只能包含字母、数字、连字符和下划线，且必须以字母开头";
		}

		return null;
	}

	getPresets(): FrontmatterPreset[] {
		return this.presets;
	}

	getPresetById(presetId: string): FrontmatterPreset | undefined {
		return this.presets.find((preset) => preset.id === presetId);
	}

	validateFormData(
		preset: FrontmatterPreset,
		formData: Record<string, unknown>,
	): { isValid: boolean; errors: string[] } {
		const errors: string[] = [];

		preset.fields.forEach((field) => {
			const value = formData[field.key];

			if (field.type === 'date' && value && (typeof value === 'string' && value.trim() !== '')) {
				const date = new Date(value as string);
				if (isNaN(date.getTime())) {
					errors.push(`字段 "${field.label}" 的日期格式无效`);
				}
			}
		});

		return {
			isValid: errors.length === 0,
			errors,
		};
	}

	validatePresetId(id: string): PresetIdValidationResult {
		const trimmedId = id.trim();

		const formatError = this.getPresetIdFormatError(trimmedId);
		if (formatError) {
			return { isValid: false, error: formatError };
		}

		const existingPreset = this.getPresetById(trimmedId);
		if (existingPreset) {
			return {
				isValid: false,
				error: `预设ID "${trimmedId}" 已存在，请使用其他ID`,
			};
		}

		return { isValid: true };
	}

	async createPreset(
		payload: CreatePresetPayload,
		options?: SaveSettingsOptions,
	): Promise<FrontmatterPreset> {
		const trimmedName = payload.name.trim();
		if (!trimmedName) {
			throw new Error("预设名称不能为空");
		}

		let presetId = payload.id?.trim();

		if (presetId) {
			const validation = this.validatePresetId(presetId);
			if (!validation.isValid) {
				throw new Error(validation.error ?? "预设ID无效");
			}
		} else {
			presetId = this.generateUniquePresetId(trimmedName);
			const validation = this.validatePresetId(presetId);
			if (!validation.isValid) {
				throw new Error(validation.error ?? "预设ID无效");
			}
		}

		const newPreset: FrontmatterPreset = {
			id: presetId,
			name: trimmedName,
			fields: payload.fields?.map((field) => ({ ...field })) ?? [],
		};

		this.presets.push(newPreset);
		await this.persist(options);

		return newPreset;
	}

	async renamePreset(
		presetId: string,
		newName: string,
		options?: SaveSettingsOptions,
	): Promise<FrontmatterPreset> {
		const trimmedName = newName.trim();
		if (!trimmedName) {
			throw new Error("预设名称不能为空");
		}

		const preset = this.getPresetById(presetId);
		if (!preset) {
			throw new Error(`未找到 ID 为 "${presetId}" 的预设`);
		}

		if (preset.name === trimmedName) {
			return preset;
		}

		preset.name = trimmedName;
		await this.persist(options);

		return preset;
	}

	async deletePreset(
		presetId: string,
		options?: SaveSettingsOptions,
	): Promise<void> {
		const presetIndex = this.presets.findIndex((preset) => preset.id === presetId);
		if (presetIndex === -1) {
			throw new Error(`未找到 ID 为 "${presetId}" 的预设`);
		}

		this.presets.splice(presetIndex, 1);
		await this.persist(options);
	}

	async updatePresetFields(
		presetId: string,
		fields: FrontmatterField[],
		options?: SaveSettingsOptions,
	): Promise<FrontmatterPreset> {
		const preset = this.getPresetById(presetId);
		if (!preset) {
			throw new Error(`未找到 ID 为 "${presetId}" 的预设`);
		}

		preset.fields = fields.map((field) => ({ ...field }));
		await this.persist(options);

		return preset;
	}

	private async persist(
		options?: SaveSettingsOptions,
	): Promise<FastTemplaterSettings> {
		const defaultOptions = this.saveOptionsFactory?.() ?? {};
		const mergedOptions: SaveSettingsOptions = {
			...defaultOptions,
			...options,
		};

		return this.settingsManager.save(undefined, mergedOptions);
	}
}
