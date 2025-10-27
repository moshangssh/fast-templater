import type { SettingsManager } from '@settings';
import { PresetImportError, PresetManager } from '@presets';
import {
	DEFAULT_SETTINGS,
	type FastTemplaterSettings,
	type FrontmatterPreset,
} from '@types';

const createManager = (presets: FrontmatterPreset[] = []) => {
	const settings: FastTemplaterSettings = {
		...DEFAULT_SETTINGS,
		frontmatterPresets: presets.map((preset) => ({
			...preset,
			fields: preset.fields.map((field) => ({ ...field })),
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

describe('PresetManager 预设ID生成', () => {
	it('应当根据名称生成易读的引用ID', () => {
		const { manager } = createManager();

		expect(manager.generateUniquePresetId('Project Template')).toBe('project-template');
	});

	it('应当在名称包含非ASCII字符时生成可读编码', () => {
		const { manager } = createManager();

		expect(manager.generateUniquePresetId('示例配置')).toBe('u793a-u4f8b-u914d-u7f6e');
	});

	it('应当为重复名称追加递增序号保证唯一性', () => {
		const existing: FrontmatterPreset = {
			id: 'project-template',
			name: 'Existing',
			fields: [],
		};
		const { manager } = createManager([existing]);

		expect(manager.generateUniquePresetId('Project Template')).toBe('project-template-2');
	});

	it('createPreset 在仅提供名称时应自动生成唯一ID并持久化', async () => {
		const { manager, settings, save } = createManager();

		const preset = await manager.createPreset({ name: '示例配置' });

		expect(preset.id).toBe('u793a-u4f8b-u914d-u7f6e');
		expect(settings.frontmatterPresets).toHaveLength(1);
		expect(settings.frontmatterPresets[0].id).toBe(preset.id);
		expect(save).toHaveBeenCalled();
	});
});

describe('PresetManager 导入导出', () => {
	const samplePreset: FrontmatterPreset = {
		id: 'sample',
		name: '示例',
		fields: [
			{
				key: 'title',
				type: 'text',
				label: '标题',
				default: '',
			},
		],
	};

	const buildExportJson = (presets: FrontmatterPreset[]) =>
		JSON.stringify({
			type: 'fast-templater-presets' as const,
			version: 1 as const,
			exportedAt: '2024-01-01T00:00:00.000Z',
			presets,
		});

	it('exportAllPresets 应返回包含全部预设的 JSON 字符串', () => {
		const additionalPreset: FrontmatterPreset = {
			id: 'another',
			name: '另一个',
			fields: [],
		};
		const { manager } = createManager([samplePreset, additionalPreset]);

		const json = manager.exportAllPresets();
		const parsed = JSON.parse(json);

		expect(parsed.type).toBe('fast-templater-presets');
		expect(parsed.presets).toHaveLength(2);
		expect(parsed.presets[0].id).toBe('sample');
		expect(parsed.presets[1].id).toBe('another');
	});

	it('importPresets 默认合并模式应追加预设', async () => {
		const { manager, settings, save } = createManager();
		const json = buildExportJson([samplePreset]);

		const result = await manager.importPresets(json);

		expect(result.strategy).toBe('merge');
		expect(result.appliedPresets).toHaveLength(1);
		expect(settings.frontmatterPresets).toHaveLength(1);
		expect(settings.frontmatterPresets[0].id).toBe('sample');
		expect(save).toHaveBeenCalled();
	});

	it('importPresets 合并模式遇到冲突时应自动重命名', async () => {
		const { manager, settings, save } = createManager([samplePreset]);
		const json = buildExportJson([samplePreset]);

		const result = await manager.importPresets(json, { strategy: 'merge' });

		expect(result.strategy).toBe('merge');
		expect(result.appliedPresets).toHaveLength(1);
		expect(result.appliedPresets[0].id).not.toBe('sample');
		expect(result.renamedPresets).toHaveLength(1);
		expect(result.renamedPresets[0].originalId).toBe('sample');
		expect(settings.frontmatterPresets).toHaveLength(2);
		expect(save).toHaveBeenCalled();
	});

	it('importPresets 替换模式应覆盖现有预设', async () => {
		const existingPreset: FrontmatterPreset = {
			id: 'legacy',
			name: '旧预设',
			fields: [],
		};
		const incomingPreset: FrontmatterPreset = {
			id: 'sample',
			name: '新预设',
			fields: [
				{
					key: 'category',
					type: 'select',
					label: '分类',
					default: '默认',
					options: ['默认'],
				},
			],
		};

		const { manager, settings, save } = createManager([existingPreset]);
		const json = buildExportJson([incomingPreset]);

		const result = await manager.importPresets(json, { strategy: 'replace' });

		expect(result.strategy).toBe('replace');
		expect(result.appliedPresets).toHaveLength(1);
		expect(settings.frontmatterPresets).toHaveLength(1);
		expect(settings.frontmatterPresets[0].id).toBe('sample');
		expect(settings.frontmatterPresets[0].fields[0].key).toBe('category');
		expect(save).toHaveBeenCalled();
	});

	it('importPresets 在 JSON 无效时应抛出 PresetImportError', async () => {
		const { manager } = createManager();

		await expect(manager.importPresets('{')).rejects.toBeInstanceOf(PresetImportError);
	});

	it('importPresets 在输入包含重复 ID 时应抛出 PresetImportError', async () => {
		const { manager } = createManager();
		const json = buildExportJson([
			samplePreset,
			{
				...samplePreset,
				name: '重复',
			},
		]);

		await expect(manager.importPresets(json)).rejects.toBeInstanceOf(PresetImportError);
	});
});
