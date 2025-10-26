import type { App } from 'obsidian';
import { mergeFrontmatterWithUserInput } from './TemplateEngine';
import type { FrontmatterPreset } from '@types';

describe('mergeFrontmatterWithUserInput frontmatter 顺序控制', () => {
	const createMockApp = (): App => {
		return {
			// 仅需最小结构即可让 getNoteMetadata 返回空 frontmatter
			workspace: {
				getActiveFile: () => null
			},
			metadataCache: {
				getFileCache: () => null
			}
		} as unknown as App;
	};

	const preset: FrontmatterPreset = {
		id: 'test',
		name: '测试预设',
		fields: [
			{ key: 'tags', type: 'multi-select', label: '标签', default: '', options: ['A', 'B'] },
			{ key: 'status', type: 'select', label: '状态', default: '', options: ['未开始', '进行中'] },
			{ key: 'create-data', type: 'text', label: '创建日期', default: '<% now() %>' },
			{ key: 'modifieddata', type: 'date', label: '修改日期', default: '' }
		]
	};

	it('应按照预设字段顺序输出 frontmatter', () => {
		const app = createMockApp();
		const templateFrontmatter = {};
		const userFrontmatter = {
			tags: ['A'],
			status: '进行中',
			'create-data': '20240101',
			modifieddata: '20240102'
		};

		const result = mergeFrontmatterWithUserInput(app, preset, templateFrontmatter, userFrontmatter);

		expect(Object.keys(result)).toEqual(['tags', 'status', 'create-data', 'modifieddata']);
	});

	it('应保留预设外字段并将其附加在末尾', () => {
		const app = createMockApp();
		const templateFrontmatter = { custom: 'value' };
		const userFrontmatter = {
			tags: ['B'],
			status: '未开始',
			'create-data': '20240301',
			modifieddata: '',
			extra: 'after'
		};

		const result = mergeFrontmatterWithUserInput(app, preset, templateFrontmatter, userFrontmatter);

		expect(Object.keys(result)).toEqual(['tags', 'status', 'create-data', 'modifieddata', 'custom', 'extra']);
		expect(result.custom).toBe('value');
		expect(result.extra).toBe('after');
	});
});
