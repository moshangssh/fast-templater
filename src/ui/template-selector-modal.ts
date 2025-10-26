import { App, Editor, MarkdownView, Modal } from 'obsidian';
import type FastTemplater from '@core/plugin';
import { TemplateManager } from '@templates';
import { TemplateLoadStatus } from '@types';
import type { Template, TemplateLoadResult } from '@types';
import * as TemplateEngine from '@engine';
import { ObsidianTemplaterAdapter } from '@engine';
import { FrontmatterManagerModal } from './frontmatter-manager-modal';
import { debounce } from '@utils/timing';
import { notifyError, notifyInfo, notifySuccess, notifyWarning } from '@utils/notify';
import { handleError } from '@core/error';
import { TemplateSelectorLayout, type TemplateSelectorLayoutRefs } from './template-selector/template-selector-layout';
import { TemplateSearchView } from './template-selector/template-search-view';
import { TemplateListView, type TemplateListStatus } from './template-selector/template-list-view';
import { TemplatePreviewPanel } from './template-selector/template-preview-panel';

export class TemplateSelectorModal extends Modal {
	private readonly plugin: FastTemplater;
	private readonly templateManager: TemplateManager;
	private templates: Template[];
	private searchQuery = '';
	private filteredTemplates: Template[] = [];
	private readonly scheduleSearchUpdate = debounce((query: string) => this.applySearchUpdate(query), 300);
	private selectedTemplate: Template | null = null;
	private readonly schedulePreviewUpdate = debounce((template: Template | null) => this.renderPreview(template), 200);
	private templateLoadStatus: TemplateLoadResult;
	private activeIndex = -1;
	private highlightActive = false;

	private layout: TemplateSelectorLayout | null = null;
	private layoutRefs: TemplateSelectorLayoutRefs | null = null;
	private searchView: TemplateSearchView | null = null;
	private listView: TemplateListView | null = null;
	private previewPanel: TemplatePreviewPanel | null = null;

	constructor(app: App, plugin: FastTemplater) {
		super(app);
		this.plugin = plugin;
		this.templateManager = plugin.templateManager;
		this.templates = this.templateManager.getTemplates();
		this.filteredTemplates = [...this.templates];
		this.templateLoadStatus = this.templateManager.getTemplateLoadStatus();
	}

	private clearActiveHighlight() {
		this.highlightActive = false;
		this.activeIndex = -1;
	}

	private resetActiveIndex() {
		if (this.filteredTemplates.length === 0) {
			this.activeIndex = -1;
			return;
		}
		this.activeIndex = this.highlightActive ? 0 : -1;
	}

	private searchTemplates(query: string): Template[] {
		if (!query || query.trim() === '') {
			return [...this.templates];
		}

		const normalizedQuery = query.toLowerCase().trim();
		return this.templates
			.filter(template =>
				template.name.toLowerCase().includes(normalizedQuery) ||
				template.content.toLowerCase().includes(normalizedQuery)
			)
			.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { sensitivity: 'base' }));
	}

	private applySearchUpdate(query: string) {
		this.filteredTemplates = this.searchTemplates(query);
		this.resetActiveIndex();
		this.updateTemplateList();
	}

	private handleSearchInput = (value: string) => {
		this.searchQuery = value;
		const trimmedQuery = value.trim();

		if (trimmedQuery === '') {
			this.scheduleSearchUpdate.cancel();
			this.filteredTemplates = [...this.templates];
			this.resetActiveIndex();
			this.updateTemplateList();
			return;
		}

		this.scheduleSearchUpdate(trimmedQuery);
	};

	private handleSearchClear = () => {
		this.searchQuery = '';
		this.filteredTemplates = [...this.templates];
		this.clearActiveHighlight();
		this.updateTemplateList();
		this.renderPreview(this.selectedTemplate);
	};

	private handleKeyDown = (event: KeyboardEvent) => {
		const listView = this.listView;
		if (!listView) return;

		const total = listView.getAllTemplateCount();
		if (total === 0) return;

		switch (event.key) {
			case 'ArrowDown': {
				this.highlightActive = true;
				this.activeIndex = (this.activeIndex + 1 + total) % total;
				listView.setActiveIndex(this.activeIndex);
				this.handleTemplateHoverFromList(this.activeIndex);
				event.preventDefault();
				break;
			}
			case 'ArrowUp': {
				this.highlightActive = true;
				if (this.activeIndex <= 0) {
					this.activeIndex = total - 1;
				} else {
					this.activeIndex = (this.activeIndex - 1 + total) % total;
				}
				listView.setActiveIndex(this.activeIndex);
				this.handleTemplateHoverFromList(this.activeIndex);
				event.preventDefault();
				break;
			}
			case 'Enter': {
				let targetIndex = this.activeIndex;
				if (targetIndex < 0) {
					targetIndex = 0;
				}
				const template = listView.getTemplateAt(targetIndex);
				if (template) {
					if (this.activeIndex !== targetIndex) {
						this.activeIndex = targetIndex;
						this.highlightActive = true;
						listView.setActiveIndex(this.activeIndex);
						this.handleTemplateHoverFromList(this.activeIndex);
					}
					this.handleTemplateClick(template);
				}
				event.preventDefault();
				break;
			}
			case 'Escape': {
				// 交给 Obsidian 处理关闭行为
				break;
			}
		}
	};

	private handleTemplateHover(template: Template) {
		if (this.selectedTemplate && this.selectedTemplate.id === template.id) {
			return;
		}
		this.schedulePreviewUpdate(template);
	}

	private handleTemplateHoverFromList(index: number) {
		const template = this.listView?.getTemplateAt(index);
		if (template) {
			this.handleTemplateHover(template);
		}
	}

	private async autoReloadTemplates() {
		if (!this.listView) return;

		this.listView.renderLoading('正在扫描模板', '请稍候，正在重新扫描模板文件夹...');

		const result = await this.templateManager.reloadTemplates(false);

		this.templates = this.templateManager.getTemplates();
		this.filteredTemplates = [...this.templates];
		this.templateLoadStatus = result;
		this.resetActiveIndex();

		this.updateTemplateList();
	}

	private async reloadTemplatesWithFeedback(): Promise<TemplateLoadResult> {
		const result = await this.templateManager.reloadTemplates(true);
		this.templates = this.templateManager.getTemplates();
		this.filteredTemplates = [...this.templates];
		this.templateLoadStatus = result;
		this.resetActiveIndex();
		this.updateTemplateList();
		return result;
	}

	private openPluginSettings() {
		this.close();
		this.plugin.openSettings();
	}

	private updateTemplateList() {
		const listView = this.listView;
		if (!listView) return;

		const errorStatus = this.getErrorStatusInfo();
		if (errorStatus && this.filteredTemplates.length === 0) {
			listView.renderStatus(errorStatus);
			return;
		}

		if (this.filteredTemplates.length === 0) {
			const status = this.searchQuery.trim() === ''
				? this.getEmptyStateInfo()
				: this.getNoResultsStateInfo();
			listView.renderStatus(status);
			return;
		}

		const recentTemplateIds = this.plugin.settings.recentlyUsedTemplates;
		const recentTemplates: Template[] = recentTemplateIds
			.map(id => this.templateManager.getTemplateById(id))
			.filter((template): template is Template => Boolean(template))
			.filter(template => this.filteredTemplates.some(filtered => filtered.id === template.id));

		const recentIdSet = new Set(recentTemplateIds);
		const allOtherTemplates = this.filteredTemplates.filter(template => !recentIdSet.has(template.id));

		if (allOtherTemplates.length === 0 && recentTemplates.length === 0) {
			listView.renderStatus(this.getNoResultsStateInfo());
			return;
		}

		if (allOtherTemplates.length === 0) {
			this.activeIndex = -1;
		} else {
			if (this.activeIndex >= allOtherTemplates.length) {
				this.activeIndex = allOtherTemplates.length - 1;
			}
			if (this.highlightActive && this.activeIndex < 0) {
				this.activeIndex = 0;
			}
		}

		listView.renderTemplates({
			recentTemplates,
			allTemplates: allOtherTemplates,
			selectedTemplateId: this.selectedTemplate?.id ?? null,
			activeIndex: this.activeIndex,
			highlightActive: this.highlightActive,
			onHover: template => this.handleTemplateHover(template),
			onClick: template => this.handleTemplateClick(template),
			onActiveChange: index => {
				this.activeIndex = index;
			}
		});
	}

	private getErrorStatusInfo(): TemplateListStatus | null {
		if (!this.templateLoadStatus || this.templateLoadStatus.status === TemplateLoadStatus.SUCCESS) {
			return null;
		}

		const status = this.templateLoadStatus.status;
		const openSettings = () => this.openPluginSettings();
		const retryScan = async () => await this.reloadTemplatesWithFeedback();

		switch (status) {
			case TemplateLoadStatus.ERROR: {
				const message = this.templateLoadStatus.message || '加载失败';
				if (message.includes('未设置')) {
					return {
						icon: '',
						title: '模板路径未设置',
						message: '您需要先设置模板文件夹路径才能使用此功能。',
						actions: [
							{ text: '设置路径', action: openSettings, primary: true },
							{ text: '稍后再说', action: () => this.close() }
						]
					};
				} else if (message.includes('无效或不存在')) {
					return {
						icon: '',
						title: '模板文件夹不存在',
						message: '指定的模板文件夹路径无效或不存在，请检查路径设置。',
						actions: [
							{ text: '修正路径', action: openSettings, primary: true },
							{ text: '重新扫描', action: retryScan, busyText: '扫描中…' }
						]
					};
				} else {
					return {
						icon: '',
						title: '加载失败',
						message: '加载模板时发生错误，请稍后重试或检查设置。',
						actions: [
							{ text: '重新扫描', action: retryScan, primary: true, busyText: '扫描中…' },
							{ text: '检查设置', action: openSettings }
						]
					};
				}
			}
			case TemplateLoadStatus.EMPTY:
				return this.getEmptyFolderStatusInfo();
			default:
				return null;
		}
	}

	private getEmptyStateInfo(): TemplateListStatus {
		return {
			icon: '📋',
			title: '暂无可用模板',
			message: '未找到可用模板，请检查模板文件夹设置。',
			actions: [
				{ text: '重新扫描', action: async () => await this.reloadTemplatesWithFeedback(), busyText: '扫描中…' },
				{ text: '打开设置', action: () => this.openPluginSettings() }
			]
		};
	}

	private getEmptyFolderStatusInfo(): TemplateListStatus {
		return {
			icon: '',
			title: '暂无模板',
			message: '模板文件夹中还没有找到任何 .md 模板文件。您可以创建一些模板文件，或者选择其他文件夹。',
			actions: [
				{
					text: '创建模板',
					action: () => {
						notifyInfo('请在模板文件夹中创建 .md 文件作为模板。');
						this.openPluginSettings();
					},
					primary: true
				},
				{ text: '更改路径', action: () => this.openPluginSettings() }
			]
		};
	}

	private getNoResultsStateInfo(): TemplateListStatus {
		return {
			icon: '',
			title: '搜索无结果',
			message: `未找到包含 "${this.searchQuery}" 的模板。`,
			containerClass: 'fast-templater-no-results'
		};
	}

	private handleTemplateClick(template: Template) {
		this.selectedTemplate = template;
		this.renderPreview(template);
		this.updateTemplateList();

		const templateFM = TemplateEngine.parseTemplateContent(template.content).frontmatter;
		const configId = templateFM['fast-templater-config'] as string;

		if (configId) {
			const preset = this.plugin.settings.frontmatterPresets.find(p => p.id === configId);
			if (preset) {
				new FrontmatterManagerModal(this.app, this.plugin, template, preset).open();
				this.close();
				return;
			} else {
				notifyWarning(`引用的预设 "${configId}" 不存在，将使用默认插入方式`);
			}
		}

		this.insertTemplate(template);
	}

	private getActiveEditor(): Editor | null {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView || !activeView.editor) {
			notifyError('无法获取当前编辑器，请确保在 Markdown 文件中使用此功能。');
			return null;
		}
		return activeView.editor;
	}

	private formatInsertionDetails(...segments: Array<string | undefined | null>): string {
		const parts = segments.filter((segment): segment is string => Boolean(segment && segment.trim()));
		return parts.length > 0 ? `（${parts.join('，')}）` : '';
	}

	private async insertTemplate(template: Template) {
		try {
			const editor = this.getActiveEditor();
			if (!editor) return;

			if (this.plugin.settings.enableFrontmatterMerge) {
				await this.insertTemplateWithFrontmatterMerge(template, editor);
			} else {
				await this.insertTemplateWithoutFrontmatterMerge(template, editor);
			}

			await this.plugin.addRecentTemplate(template.id);
			this.close();
		} catch (error) {
			handleError(error, {
				context: 'TemplateSelectorModal.insertTemplate',
				userMessage: '插入模板失败，请稍后重试。'
			});
		}
	}

	private async insertTemplateWithFrontmatterMerge(template: Template, editor: Editor) {
		const {
			content: processedContent,
			usedTemplater,
			error: templaterNotice
		} = await TemplateEngine.processTemplateContent(this.app, this.plugin, template);

		if (templaterNotice) {
			notifyWarning(`${templaterNotice}，继续尝试 frontmatter 合并`);
		}

		const { frontmatter: templateFM, body: templateBody } = TemplateEngine.parseTemplateContent(processedContent);
		const hasFrontmatter = Object.keys(templateFM).length > 0;

		if (!hasFrontmatter) {
			editor.replaceSelection(processedContent);
			const details = this.formatInsertionDetails(
				'模板无 frontmatter，直接插入',
				usedTemplater ? '并使用 Templater 处理' : undefined
			);
			notifySuccess(`模板 "${template.name}" 已插入${details}。`);
			return;
		}

		try {
			const { frontmatter: noteFM, position: notePosition } = TemplateEngine.getNoteMetadata(this.app);
			const mergedFM = TemplateEngine.mergeFrontmatters(noteFM, templateFM);

			TemplateEngine.updateNoteFrontmatter(editor, mergedFM, notePosition);

			if (templateBody.trim()) {
				editor.replaceSelection(templateBody);
			}

			const details = this.formatInsertionDetails(
				usedTemplater ? '并使用 Templater 处理' : undefined,
				`已合并 ${Object.keys(templateFM).length} 个 frontmatter 字段`
			);
			notifySuccess(`模板 "${template.name}" 已插入${details}。`);
		} catch (error) {
			handleError(error, {
				context: 'TemplateSelectorModal.insertTemplateWithFrontmatterMerge'
			});
			notifyWarning('Frontmatter 合并失败，回退到普通插入');
			editor.replaceSelection(template.content);
		}
	}

	private async insertTemplateWithoutFrontmatterMerge(template: Template, editor: Editor) {
		const { content: processedContent, usedTemplater, error } = await TemplateEngine.processTemplateContent(this.app, this.plugin, template);

		editor.replaceSelection(processedContent);

		const templater = new ObsidianTemplaterAdapter(this.app);
		if (usedTemplater) {
			notifySuccess(`模板 "${template.name}" 已插入，并使用 Templater 处理。`);
		} else if (this.plugin.settings.enableTemplaterIntegration && !templater.isAvailable()) {
			notifyWarning(`模板 "${template.name}" 已插入（未检测到 Templater 插件）。`);
		} else if (error) {
			notifyWarning(`模板 "${template.name}" 已插入（${error}）。`);
		} else {
			notifySuccess(`模板 "${template.name}" 已插入。`);
		}
	}

	private renderPreview(template: Template | null) {
		this.previewPanel?.render(template);
	}

	onOpen() {
		this.modalEl.style.width = '85vw';
		this.modalEl.style.maxWidth = '1000px';

		this.layout = new TemplateSelectorLayout(this.contentEl);
		this.layoutRefs = this.layout.mount();

		this.searchView = new TemplateSearchView(this.layoutRefs.searchHostEl, {
			onInput: this.handleSearchInput,
			onKeyDown: this.handleKeyDown,
			onClear: this.handleSearchClear,
			initialQuery: this.searchQuery
		});
		this.searchView.mount();

		this.listView = new TemplateListView(this.layoutRefs.listContainerEl);
		this.previewPanel = new TemplatePreviewPanel(this.layoutRefs.previewContentEl);
		this.renderPreview(null);

		const closeBtn = this.layoutRefs.footerEl.createEl('button', {
			text: '关闭',
			cls: 'fast-templater-ghost-button'
		});
		closeBtn.type = 'button';
		closeBtn.onclick = () => this.close();

		void this.autoReloadTemplates();

		setTimeout(() => this.searchView?.focus(), 100);
	}

	onClose() {
		this.scheduleSearchUpdate.cancel();
		this.schedulePreviewUpdate.cancel();

		this.clearActiveHighlight();

		this.searchView?.unmount();
		this.listView?.destroy();
		this.previewPanel?.destroy();
		this.layout?.destroy();

		this.searchView = null;
		this.listView = null;
		this.previewPanel = null;
		this.layout = null;
		this.layoutRefs = null;
	}
}
