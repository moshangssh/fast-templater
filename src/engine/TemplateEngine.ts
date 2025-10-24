import { App, Editor, MarkdownView } from 'obsidian';
import * as yaml from 'js-yaml';
import type FastTemplater from '@core/plugin';
import type {
	FrontmatterPreset,
	NoteMetadata,
	ParsedTemplateContent,
	Pos,
	Template,
	TemplateInsertionResult,
	TemplateProcessingResult
} from '@types';
import type { TemplaterPort } from './TemplaterPort';
import { ObsidianTemplaterAdapter } from './ObsidianTemplaterAdapter';

export async function processTemplateContent(app: App, plugin: FastTemplater, template: Template): Promise<TemplateProcessingResult> {
	let processedContent = template.content;
	let usedTemplater = false;
	let error: string | undefined;

	if (plugin.settings.enableTemplaterIntegration) {
		const templater: TemplaterPort = new ObsidianTemplaterAdapter(app);
		if (templater.isAvailable()) {
			try {
				processedContent = await templater.processTemplate(template);
				usedTemplater = true;
			} catch (templaterError) {
				console.warn('Fast Templater: Templater 处理失败，使用原始模板内容', templaterError);
				error = 'Templater 处理失败，使用原始模板内容';
			}
		}
	}

	return { content: processedContent, usedTemplater, error };
}

export function parseTemplateContent(content: string): ParsedTemplateContent {
	const frontmatterRegex = /^---\n([\s\S]+?)\n---/;
	const match = content.match(frontmatterRegex);

	if (match) {
		try {
			const frontmatterText = match[1];
			const frontmatter = (yaml.load(frontmatterText) || {}) as Record<string, unknown>;
			const body = content.replace(frontmatterRegex, '').trim();

			return { frontmatter, body };
		} catch (error) {
			console.warn('Fast Templater: Frontmatter 解析失败', error);
			return { frontmatter: {}, body: content };
		}
	}

	return { frontmatter: {}, body: content };
}

export function mergeFrontmatterWithUserInput(
	app: App,
	preset: FrontmatterPreset,
	templateFrontmatter: Record<string, unknown>,
	userFrontmatter: Record<string, unknown>
): Record<string, unknown> {
	const noteMetadata = getNoteMetadata(app);
	const presetDefaults = extractPresetDefaults(preset);
	const noteOverridesPreset = mergeFrontmatters(presetDefaults, noteMetadata.frontmatter);
	const templateOverridesNote = mergeFrontmatters(noteOverridesPreset, templateFrontmatter);
	const finalResult = mergeFrontmatters(templateOverridesNote, userFrontmatter);

	delete finalResult['fast-templater-config'];

	return finalResult;
}

export function convertFormDataToFrontmatter(
	preset: FrontmatterPreset,
	formData: Record<string, unknown>,
): Record<string, unknown> {
	const frontmatter: Record<string, unknown> = {};

	preset.fields.forEach((field) => {
		const value = formData[field.key];

		if (value === undefined || value === null || value === '') {
			frontmatter[field.key] = '';
			return;
		}

		switch (field.type) {
			case 'date': {
				const date = new Date(value as string);
				if (!isNaN(date.getTime())) {
					frontmatter[field.key] = date.toISOString().split('T')[0];
				} else {
					throw new Error(`字段 "${field.label}" 的日期格式无效`);
				}
				break;
			}

			case 'multi-select': {
				if (Array.isArray(value) && value.length > 0) {
					frontmatter[field.key] = value;
				} else {
					frontmatter[field.key] = '';
				}
				break;
			}

			case 'text':
			case 'select':
			default: {
				if (typeof value === 'string') {
					const trimmedValue = value.trim();
					frontmatter[field.key] = trimmedValue || '';
				} else {
					frontmatter[field.key] = value;
				}
				break;
			}
		}
	});

	return frontmatter;
}

export async function insertTemplateWithUserInput(
	app: App,
	plugin: FastTemplater,
	template: Template,
	preset: FrontmatterPreset,
	userFrontmatter: Record<string, unknown>,
): Promise<TemplateInsertionResult> {
	const activeView = app.workspace.getActiveViewOfType(MarkdownView);
	if (!activeView || !activeView.editor) {
		throw new Error('无法获取当前编辑器，请确保在 Markdown 文件中使用此功能');
	}

	const editor = activeView.editor;
	const {
		content: processedContent,
		usedTemplater,
		error: templaterError,
	} = await processTemplateContent(app, plugin, template);

	const { frontmatter: templateFM, body: templateBody } = parseTemplateContent(processedContent);
	const mergedFrontmatter = mergeFrontmatterWithUserInput(
		app,
		preset,
		templateFM,
		userFrontmatter,
	);

	const noteMetadata = getNoteMetadata(app);
	const trimmedBody = templateBody.trim();
	let templateBodyInserted = false;

	try {
		if (trimmedBody) {
			editor.replaceSelection(templateBody);
			templateBodyInserted = true;
		}

		updateNoteFrontmatter(editor, mergedFrontmatter, noteMetadata.position);

		return {
			usedTemplater,
			templaterError,
			mergedFrontmatter,
			mergeCount: Object.keys(mergedFrontmatter).length,
			frontmatterUpdated: true,
			templateBodyInserted,
			fallbackToBodyOnly: false,
		};
	} catch (error) {
		console.error('Fast Templater: 插入操作失败', error);

		try {
			editor.replaceSelection(templateBody);
			templateBodyInserted = trimmedBody.length > 0;

			return {
				usedTemplater,
				templaterError,
				mergedFrontmatter,
				mergeCount: Object.keys(mergedFrontmatter).length,
				frontmatterUpdated: false,
				templateBodyInserted,
				fallbackToBodyOnly: true,
			};
		} catch (fallbackError) {
			console.error('Fast Templater: 回退插入也失败', fallbackError);
			throw new Error('模板插入完全失败，请手动复制模板内容');
		}
	}
}

export function mergeFrontmatters(baseFrontmatter: Record<string, unknown>, overrideFrontmatter: Record<string, unknown>): Record<string, unknown> {
	const merged: Record<string, unknown> = { ...baseFrontmatter };

	for (const [key, overrideValue] of Object.entries(overrideFrontmatter)) {
		if (key === 'tags') {
			const baseTags = Array.isArray(merged[key]) ? merged[key] as unknown[] : (merged[key] ? [merged[key]] : []);
			const overrideTags = Array.isArray(overrideValue) ? overrideValue as unknown[] : (overrideValue ? [overrideValue] : []);
			const allTags = [...baseTags, ...overrideTags];
			merged[key] = [...new Set(allTags)];
		} else {
			merged[key] = overrideValue;
		}
	}

	return merged;
}

export function getNoteMetadata(app: App): NoteMetadata {
	const activeFile = app.workspace.getActiveFile();
	if (!activeFile) {
		return { frontmatter: {}, position: null };
	}

	const fileCache = app.metadataCache.getFileCache(activeFile);
	if (!fileCache || !fileCache.frontmatter) {
		return { frontmatter: {}, position: null };
	}

	return {
		frontmatter: fileCache.frontmatter || {},
		position: (fileCache.frontmatterPosition as Pos) ?? null
	};
}

export function updateNoteFrontmatter(editor: Editor, newFrontmatter: Record<string, unknown>, position: Pos | null): void {
	try {
		const newYamlString = yaml.dump(newFrontmatter, {
			indent: 2,
			lineWidth: -1,
			noRefs: true,
			sortKeys: false
		});

		if (position && position.start && position.end) {
			const startPos = { line: position.start.line, ch: 0 };
			const endPos = { line: position.end.line + 1, ch: 0 };
			editor.replaceRange(`---\n${newYamlString}---\n\n`, startPos, endPos);
		} else {
			const startPos = { line: 0, ch: 0 };
			editor.replaceRange(`---\n${newYamlString}---\n\n`, startPos);
		}
	} catch (error) {
		console.error('Fast Templater: 更新 frontmatter 失败', error);
		throw error;
	}
}

function extractPresetDefaults(preset: FrontmatterPreset): Record<string, unknown> {
	const defaults: Record<string, unknown> = {};

	preset.fields.forEach(field => {
		if (field.default && field.default.trim() !== '') {
			if (field.type === 'multi-select') {
				if (field.options && field.options.includes(field.default)) {
					defaults[field.key] = [field.default];
				}
			} else {
				defaults[field.key] = field.default;
			}
		}
	});

	return defaults;
}
