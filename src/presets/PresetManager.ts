import type { SaveSettingsOptions, SettingsManager } from '@settings';
import type {
	FastTemplaterSettings,
	FrontmatterField,
	FrontmatterPreset,
} from '@types';

export type PresetImportStrategy = 'merge' | 'replace';

export interface ImportPresetsOptions {
	strategy?: PresetImportStrategy;
	saveOptions?: SaveSettingsOptions;
}

export interface ImportPresetsResult {
	strategy: PresetImportStrategy;
	appliedPresets: FrontmatterPreset[];
	renamedPresets: Array<{ originalId: string; newId: string }>;
}

export interface PresetCollectionExportPayload {
	type: 'fast-templater-presets';
	version: 1;
	exportedAt: string;
	presets: FrontmatterPreset[];
}

export class PresetImportError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PresetImportError';
	}
}

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
			return '预设ID不能为空';
		}

		if (id.length < 2) {
			return '预设ID长度至少为2个字符';
		}

		if (id.length > 50) {
			return '预设ID长度不能超过50个字符';
		}

		if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id)) {
			return '预设ID只能包含字母、数字、连字符和下划线，且必须以字母开头';
		}

		return null;
	}

	getPresets(): FrontmatterPreset[] {
		return this.presets;
	}

	getPresetById(presetId: string): FrontmatterPreset | undefined {
		return this.presets.find((preset) => preset.id === presetId);
	}

	exportAllPresets(): string {
		const payload: PresetCollectionExportPayload = {
			type: 'fast-templater-presets',
			version: 1,
			exportedAt: new Date().toISOString(),
			presets: this.presets.map((preset) => ({
				id: preset.id,
				name: preset.name,
				fields: preset.fields.map((field) => ({
					key: field.key,
					type: field.type,
					label: field.label,
					default: field.default,
					...(Array.isArray(field.options) && field.options.length > 0
						? { options: [...field.options] }
						: {}),
					...(field.useTemplaterTimestamp ? { useTemplaterTimestamp: true } : {}),
				})),
			})),
		};

		return JSON.stringify(payload, null, 2);
	}

	async importPresets(
		jsonString: string,
		options: ImportPresetsOptions = {},
	): Promise<ImportPresetsResult> {
		const sanitizedPresets = this.parseImportedPresets(jsonString);
		if (sanitizedPresets.length === 0) {
			throw new PresetImportError('导入失败：未找到任何预设定义');
		}

		const strategy: PresetImportStrategy = options.strategy ?? 'merge';
		const renamedPresets: Array<{ originalId: string; newId: string }> = [];
		let appliedPresets: FrontmatterPreset[] = [];

		if (strategy === 'replace') {
			const clonedPresets = sanitizedPresets.map((preset) => ({
				id: preset.id,
				name: preset.name,
				fields: preset.fields.map((field) => ({ ...field })),
			}));

			this.settings.frontmatterPresets.length = 0;
			this.settings.frontmatterPresets.push(...clonedPresets);
			appliedPresets = clonedPresets.map((preset) => ({
				id: preset.id,
				name: preset.name,
				fields: preset.fields.map((field) => ({ ...field })),
			}));
		} else {
			const newlyAdded: FrontmatterPreset[] = [];
			const existingIds = new Set(this.presets.map((preset) => preset.id));

			sanitizedPresets.forEach((preset) => {
				let targetId = preset.id;
				if (existingIds.has(targetId)) {
					let generatedId = this.generateUniquePresetId(preset.name);
					while (existingIds.has(generatedId)) {
						generatedId = this.generateUniquePresetId(`${preset.name}-${Date.now()}`);
					}
					renamedPresets.push({ originalId: preset.id, newId: generatedId });
					targetId = generatedId;
				}

				const newPreset: FrontmatterPreset = {
					id: targetId,
					name: preset.name,
					fields: preset.fields.map((field) => ({ ...field })),
				};

				this.presets.push(newPreset);
				existingIds.add(targetId);

				newlyAdded.push({
					id: newPreset.id,
					name: newPreset.name,
					fields: newPreset.fields.map((field) => ({ ...field })),
				});
			});

			appliedPresets = newlyAdded;
		}

		await this.persist(options.saveOptions);

		return {
			strategy,
			appliedPresets,
			renamedPresets,
		};
	}

	validateFormData(
		preset: FrontmatterPreset,
		formData: Record<string, unknown>,
	): { isValid: boolean; errors: string[] } {
		const errors: string[] = [];

		preset.fields.forEach((field) => {
			const value = formData[field.key];

			if (field.type === 'date') {
				if (field.useTemplaterTimestamp) {
					return;
				}

				if (value && typeof value === 'string' && value.trim() !== '') {
					const date = new Date(value as string);
					if (isNaN(date.getTime())) {
						errors.push(`字段 "${field.label}" 的日期格式无效`);
					}
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
			throw new Error('预设名称不能为空');
		}

		let presetId = payload.id?.trim();

		if (presetId) {
			const validation = this.validatePresetId(presetId);
			if (!validation.isValid) {
				throw new Error(validation.error ?? '预设ID无效');
			}
		} else {
			presetId = this.generateUniquePresetId(trimmedName);
			const validation = this.validatePresetId(presetId);
			if (!validation.isValid) {
				throw new Error(validation.error ?? '预设ID无效');
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
			throw new Error('预设名称不能为空');
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

	private parseImportedPresets(jsonString: string): FrontmatterPreset[] {
		let rawData: unknown;

		try {
			rawData = JSON.parse(jsonString);
		} catch {
			throw new PresetImportError('导入失败：无法解析 JSON 数据');
		}

		const payload = this.extractPresetsPayload(rawData);
		if (!Array.isArray(payload)) {
			throw new PresetImportError('导入失败：数据格式无效');
		}

		const sanitizedPresets = payload.map((preset, index) => this.sanitizeImportedPreset(preset, index));

		const seenIds = new Set<string>();
		for (const preset of sanitizedPresets) {
			if (seenIds.has(preset.id)) {
				throw new PresetImportError(`导入失败：存在重复的预设 ID "${preset.id}"`);
			}
			seenIds.add(preset.id);
		}

		return sanitizedPresets;
	}

	private extractPresetsPayload(rawData: unknown): unknown {
		if (Array.isArray(rawData)) {
			return rawData;
		}

		if (!rawData || typeof rawData !== 'object') {
			throw new PresetImportError('导入失败：数据格式无效');
		}

		if ('presets' in rawData) {
			const structured = rawData as Partial<PresetCollectionExportPayload> & { presets?: unknown };
			if (structured.type && structured.type !== 'fast-templater-presets') {
				throw new PresetImportError('导入失败：JSON 类型标识不匹配');
			}
			if (!Array.isArray(structured.presets)) {
				throw new PresetImportError('导入失败：缺少有效的预设列表');
			}
			return structured.presets;
		}

		if ('preset' in rawData) {
			const legacy = rawData as { preset?: unknown };
			return legacy.preset ? [legacy.preset] : [];
		}

		return [rawData];
	}

	private sanitizeImportedPreset(data: unknown, presetIndex: number): FrontmatterPreset {
		if (!data || typeof data !== 'object') {
			throw new PresetImportError(`导入失败：第 ${presetIndex + 1} 个预设数据格式无效`);
		}

		const { id, name, fields } = data as Partial<FrontmatterPreset>;

		if (typeof id !== 'string' || !id.trim()) {
			throw new PresetImportError(`导入失败：第 ${presetIndex + 1} 个预设缺少有效的 ID`);
		}

		const trimmedId = id.trim();
		if (!this.isPresetIdFormatValid(trimmedId)) {
			throw new PresetImportError(`导入失败：第 ${presetIndex + 1} 个预设的 ID "${trimmedId}" 格式无效`);
		}

		if (typeof name !== 'string' || !name.trim()) {
			throw new PresetImportError(`导入失败：第 ${presetIndex + 1} 个预设缺少名称`);
		}

		if (!Array.isArray(fields)) {
			throw new PresetImportError(`导入失败：第 ${presetIndex + 1} 个预设的字段数据格式无效`);
		}

		const sanitizedFields = fields.map((field, fieldIndex) =>
			this.sanitizeImportedField(field, presetIndex, fieldIndex),
		);

		return {
			id: trimmedId,
			name: name.trim(),
			fields: sanitizedFields,
		};
	}

	private sanitizeImportedField(field: unknown, presetIndex: number, fieldIndex: number): FrontmatterField {
		if (!field || typeof field !== 'object') {
			throw new PresetImportError(
				`导入失败：第 ${presetIndex + 1} 个预设的第 ${fieldIndex + 1} 个字段格式无效`,
			);
		}

		const candidate = field as Partial<FrontmatterField>;
		const key = candidate.key?.trim();
		const label = candidate.label?.trim();

		if (!key) {
			throw new PresetImportError(
				`导入失败：第 ${presetIndex + 1} 个预设的第 ${fieldIndex + 1} 个字段缺少键名`,
			);
		}

		if (!label) {
			throw new PresetImportError(
				`导入失败：第 ${presetIndex + 1} 个预设的第 ${fieldIndex + 1} 个字段缺少显示名称`,
			);
		}

		const type = candidate.type ?? 'text';
		if (!['text', 'select', 'date', 'multi-select'].includes(type)) {
			throw new PresetImportError(
				`导入失败：第 ${presetIndex + 1} 个预设的字段 "${key}" 类型不受支持`,
			);
		}

		const defaultValue = typeof candidate.default === 'string' ? candidate.default : '';
		const sanitizedField: FrontmatterField = {
			key,
			type,
			label,
			default: defaultValue,
		};

		if (Array.isArray(candidate.options) && candidate.options.length > 0) {
			sanitizedField.options = candidate.options.map((option) => String(option));
		}

		if (candidate.useTemplaterTimestamp === true) {
			sanitizedField.useTemplaterTimestamp = true;
		}

		return sanitizedField;
	}
}
