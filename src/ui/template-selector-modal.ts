import { App, Component, Editor, MarkdownRenderer, MarkdownView, Modal } from 'obsidian';
import type FastTemplater from '@core/plugin';
import { TemplateManager } from '@templates';
import { TemplateLoadStatus } from '@types';
import type { Template, TemplateLoadResult } from '@types';
import * as TemplateEngine from '@engine';
import { ObsidianTemplaterAdapter } from '@engine';
import { FrontmatterManagerModal } from './frontmatter-manager-modal';
import { renderStatusBlock } from './ui-utils';
import { debounce } from '@utils/timing';
import { notifyError, notifyInfo, notifySuccess, notifyWarning } from '@utils/notify';
import { handleError } from '@core/error';

export class TemplateSelectorModal extends Modal {
	private readonly plugin: FastTemplater;
	private readonly templateManager: TemplateManager;
	private templates: Template[];
	private searchQuery = ''; // 搜索查询字符串
	private filteredTemplates: Template[] = []; // 过滤后的模板列表
	private readonly scheduleSearchUpdate = debounce((query: string) => this.applySearchUpdate(query), 300); // 搜索防抖
	private selectedTemplate: Template | null = null; // 当前选中的模板
	private previewContainer: HTMLElement | null = null; // 预览容器引用
	private readonly schedulePreviewUpdate = debounce((template: Template | null) => this.updatePreview(template), 200); // 预览防抖
	private templateLoadStatus: TemplateLoadResult; // 模板加载状态
	private activeIndex = 0; // 用于键盘导航
	private listEl: HTMLElement | null = null; // 模板列表元素
	private searchInputEl: HTMLInputElement | null = null; // 搜索输入框引用，用于移除事件监听器

	constructor(app: App, plugin: FastTemplater) {
		super(app);
		this.plugin = plugin;
		this.templateManager = plugin.templateManager;
		this.templates = this.templateManager.getTemplates();
		this.filteredTemplates = [...this.templates]; // 初始化时显示所有模板
		this.templateLoadStatus = this.templateManager.getTemplateLoadStatus();
	}

	/**
	 * 搜索模板，根据搜索词过滤模板列表（不区分大小写）
	 * 搜索范围包括：模板名称和模板内容
	 */
	private searchTemplates(query: string): Template[] {
		if (!query || query.trim() === '') {
			return [...this.templates];
		}

		const normalizedQuery = query.toLowerCase().trim();
		const filteredTemplates = this.templates.filter(template =>
			template.name.toLowerCase().includes(normalizedQuery) ||
			template.content.toLowerCase().includes(normalizedQuery)
		);

		// 搜索结果也按字母顺序排序
		return filteredTemplates.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { sensitivity: 'base' }));
	}

	/**
	 * 触发搜索结果刷新
	 */
	private applySearchUpdate(query: string) {
		this.filteredTemplates = this.searchTemplates(query);
		this.updateTemplateList();
	}

	/**
	 * 处理搜索输入事件（带防抖功能）
	 */
	private handleSearchInput = (event: Event) => {
		const target = event.target as HTMLInputElement;
		this.searchQuery = target.value;

		// 控制清空按钮的显示/隐藏
		const clearButtonEl = this.contentEl.querySelector('.fast-templater-search-clear') as HTMLElement;
		if (clearButtonEl) {
			clearButtonEl.style.display = this.searchQuery ? 'block' : 'none';
		}

		const trimmedQuery = this.searchQuery.trim();

		// 对于空搜索，立即更新
		if (trimmedQuery === '') {
			this.scheduleSearchUpdate.cancel();
			this.filteredTemplates = [...this.templates];
			this.updateTemplateList();
			return;
		}

		this.scheduleSearchUpdate(trimmedQuery);
	}

	/**
	 * 处理键盘导航事件
	 */
	private handleKeyDown = (event: KeyboardEvent) => {
		// 获取所有模板列表中的"所有模板"部分
		const allTemplates = this.filteredTemplates.filter(t => !this.plugin.settings.recentlyUsedTemplates.includes(t.id));

		if (allTemplates.length === 0) return;

		switch (event.key) {
			case 'ArrowDown': {
				this.activeIndex = (this.activeIndex + 1) % allTemplates.length;
				this.updateActiveDescendant();
				event.preventDefault();
				break;
			}
			case 'ArrowUp': {
				this.activeIndex = (this.activeIndex - 1 + allTemplates.length) % allTemplates.length;
				this.updateActiveDescendant();
				event.preventDefault();
				break;
			}
			case 'Enter': {
				if (this.activeIndex >= 0 && this.activeIndex < allTemplates.length) {
					this.handleTemplateClick(allTemplates[this.activeIndex]);
				}
				event.preventDefault();
				break;
			}
			case 'Escape': {
				// 让 Obsidian 处理默认的 Escape 行为（关闭模态窗口）
				// 不阻止事件冒泡，允许 Obsidian 的默认模态窗口关闭行为生效
				break;
			}
		}
	};

	/**
	 * 更新活动后代（用于键盘导航和无障碍性）
	 */
	private updateActiveDescendant() {
		// 确保 this.listEl 指向的是"所有模板"的 <ul> 元素
		if (!this.listEl) return;

		// 移除之前的活动状态
		const activeEl = this.listEl.querySelector('.fast-templater-template-item-active');
		if (activeEl) {
			activeEl.classList.remove('fast-templater-template-item-active');
		}

		// 添加新的活动状态
		const newActiveEl = this.listEl.children[this.activeIndex] as HTMLElement;
		if (newActiveEl) {
			newActiveEl.classList.add('fast-templater-template-item-active');
			newActiveEl.scrollIntoView({ block: 'nearest' });
			// 获取对应的模板并更新预览
			const allTemplates = this.filteredTemplates.filter(t => !this.plugin.settings.recentlyUsedTemplates.includes(t.id));
			if (this.activeIndex >= 0 && this.activeIndex < allTemplates.length) {
				this.handleTemplateHover(allTemplates[this.activeIndex]);
			}
		}
	}

	/**
	 * 渲染增强的状态消息容器
	 * 使用统一的 renderStatusBlock 工具
	 */
	private renderStatusContainer(containerEl: HTMLElement, status: {
		icon: string;
		title: string;
		message: string;
		actions?: Array<{
			text: string;
			action: () => void | Promise<unknown>;
			primary?: boolean;
			busyText?: string;
		}>;
	}) {
		renderStatusBlock(containerEl, {
			icon: status.icon,
			title: status.title,
			items: [
				{
					label: '',
					content: status.message,
					type: 'text'
				}
			],
			actions: status.actions?.map(action => ({
				text: action.text,
				onClick: action.action,
				cls: action.primary ? 'mod-cta' : '',
				busyText: action.busyText
			})),
			containerClass: 'fast-templater-status-container'
		});
	}

	/**
	 * 获取错误状态信息
	 */
	private getErrorStatusInfo(): { icon: string; title: string; message: string; actions?: Array<{ text: string; action: () => void | Promise<unknown>; primary?: boolean; busyText?: string }> } | null {
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
				return {
					icon: '',
					title: '暂无模板',
					message: '模板文件夹中还没有找到任何 .md 模板文件。您可以创建一些模板文件，或者选择其他文件夹。',
					actions: [
						{ text: '创建模板', action: () => {
							notifyInfo('请在模板文件夹中创建 .md 文件作为模板。');
							openSettings();
						}, primary: true },
						{ text: '更改路径', action: openSettings }
					]
				};
			default:
				return null;
		}
	}

	/**
	 * 渲染错误状态
	 */
	private renderErrorState(containerEl: HTMLElement) {
		const errorStatusInfo = this.getErrorStatusInfo();
		if (errorStatusInfo) {
			this.renderStatusContainer(containerEl, errorStatusInfo);
		}
	}

	/**
	 * 渲染空状态（模板文件夹为空）
	 */
	private renderEmptyState(containerEl: HTMLElement) {
		const statusInfo = {
			icon: '📋',
			title: '暂无可用模板',
			message: '未找到可用模板，请检查模板文件夹设置。',
			actions: [
				{ text: '重新扫描', action: async () => await this.reloadTemplatesWithFeedback(), busyText: '扫描中…' },
				{ text: '打开设置', action: () => this.openPluginSettings() }
			]
		};
		this.renderStatusContainer(containerEl, statusInfo);
	}

	/**
	 * 渲染无搜索结果状态
	 */
	private renderNoResultsState(containerEl: HTMLElement) {
		const statusInfo = {
			icon: '',
			title: '搜索无结果',
			message: `未找到包含 "${this.searchQuery}" 的模板。`
		};
		this.renderStatusContainer(containerEl, statusInfo);

		// 为搜索无结果添加特殊样式
		containerEl.querySelector('.fast-templater-status-container')?.addClass('fast-templater-no-results');
	}

	/**
	 * 渲染模板列表项
	 */
	private renderTemplateItems(containerEl: HTMLElement, templates: Template[], context: 'recent' | 'all') {
		templates.forEach((template, index) => {
			const listItemEl = containerEl.createEl('li', {
				cls: 'fast-templater-template-item'
			});

			// 如果是"所有模板"列表，则处理键盘导航的 active 状态
			if (context === 'all' && index === this.activeIndex) {
				listItemEl.addClass('fast-templater-template-item-active');
			}

			// 添加选中状态样式
			if (this.selectedTemplate && this.selectedTemplate.id === template.id) {
				listItemEl.addClass('fast-templater-template-item-selected');
			}

			// 显示模板名称
			listItemEl.createEl('span', {
				text: template.name,
				cls: 'fast-templater-template-name'
			});

			// 为模板列表项添加hover事件
			listItemEl.addEventListener('mouseenter', () => {
				if (context === 'all') {
					this.activeIndex = index;
					this.updateActiveDescendant();
				} else {
					// 对于"最近使用"列表，只更新预览，不影响键盘导航焦点
					this.handleTemplateHover(template);
				}
			});

			// 为模板列表项添加click事件
			listItemEl.addEventListener('click', () => {
				this.handleTemplateClick(template);
			});
		});
	}

	/**
	 * 自动重新扫描模板并更新显示
	 * 此方法在UI打开时自动调用，不显示用户通知，以提供无缝体验
	 * 1. 在容器中显示加载状态
	 * 2. 静默重新加载模板
	 * 3. 更新内部模板数据和UI显示
	 * 4. 移除加载状态
	 * @param containerEl 模板列表容器
	 */
	private async autoReloadTemplatesAndRender(containerEl: HTMLElement): Promise<void> {
		// 首先显示加载状态
		this.renderLoadingState(containerEl);

		// 静默重新加载模板（不显示通知）
		const result = await this.templateManager.reloadTemplates(false);

		// 更新内部模板数据
		this.templates = this.templateManager.getTemplates();
		this.filteredTemplates = [...this.templates];
		this.templateLoadStatus = result;

		// 更新模板列表显示
		this.renderTemplateList(containerEl);
	}

	/**
	 * 渲染加载状态
	 */
	private renderLoadingState(containerEl: HTMLElement) {
		containerEl.empty();

		const statusInfo = {
			icon: '',
			title: '正在扫描模板',
			message: '请稍候，正在重新扫描模板文件夹...'
		};
		this.renderStatusContainer(containerEl, statusInfo);
	}

	/**
	 * 重新加载模板并提供用户反馈（辅助方法）
	 * 此方法统一处理UI反馈逻辑：
	 * 1. 调用插件的 reloadTemplates 方法重新加载模板（启用通知）
	 * 2. 更新内部模板数据和UI显示
	 * @returns Promise<TemplateLoadResult> 模板加载结果
	 */
	private async reloadTemplatesWithFeedback(): Promise<TemplateLoadResult> {
		// 调用插件方法并启用通知
		const result = await this.templateManager.reloadTemplates(true);
		this.templates = this.templateManager.getTemplates();
		this.filteredTemplates = [...this.templates];
		this.templateLoadStatus = result;
		this.updateTemplateList();
		return result;
	}

	/**
	 * 打开插件设置页面（辅助方法）
	 */
	private openPluginSettings() {
		this.close();
		this.plugin.openSettings();
	}

	/**
	 * 渲染模板列表到指定容器
	 * 根据当前状态调用相应的子函数进行渲染
	 */
	private renderTemplateList(containerEl: HTMLElement) {
		// 清空现有内容
		containerEl.empty();

		// 首先检查是否有错误状态需要显示
		const errorStatusInfo = this.getErrorStatusInfo();
		if (errorStatusInfo && this.filteredTemplates.length === 0) {
			this.renderErrorState(containerEl);
			return;
		}

		// 检查是否有过滤结果
		if (this.filteredTemplates.length === 0) {
			const isSearchEmpty = this.searchQuery.trim() === '';
			if (isSearchEmpty) {
				this.renderEmptyState(containerEl);
			} else {
				this.renderNoResultsState(containerEl);
			}
			return;
		}

		// 获取最近使用的模板
		const recentTemplateIds = this.plugin.settings.recentlyUsedTemplates;
		const recentTemplates: Template[] = recentTemplateIds
			.map(id => this.templateManager.getTemplateById(id))
			.filter((t): t is Template => t !== undefined)
			.filter(template => this.filteredTemplates.some(filtered => filtered.id === template.id));

		// 渲染"最近使用"部分 (如果有)
		if (recentTemplates.length > 0) {
			containerEl.createEl('h4', { text: '最近使用', cls: 'fast-templater-list-header' });
			const recentListEl = containerEl.createEl('ul', { cls: 'fast-templater-template-list' });
			this.renderTemplateItems(recentListEl, recentTemplates, 'recent');
		}

		// 渲染"所有模板"部分 (排除最近使用的)
		const recentIdsSet = new Set(recentTemplateIds);
		const allOtherTemplates = this.filteredTemplates.filter(t => !recentIdsSet.has(t.id));

		if (allOtherTemplates.length > 0) {
			containerEl.createEl('h4', { text: '所有模板', cls: 'fast-templater-list-header' });
			const allListEl = containerEl.createEl('ul', { cls: 'fast-templater-template-list' });
			this.listEl = allListEl; // 将键盘导航的目标指向"所有模板"列表
			this.renderTemplateItems(allListEl, allOtherTemplates, 'all');
		} else if (recentTemplates.length === 0) {
			// 仅当两个列表都为空时，才显示无结果
			this.renderNoResultsState(containerEl);
		}
	}

	/**
	 * 更新模板列表显示
	 */
	private updateTemplateList() {
		const containerEl = this.contentEl.querySelector('.fast-templater-modal-container') as HTMLElement;
		if (!containerEl) return;

		this.renderTemplateList(containerEl);
	}

	/**
	 * 处理模板hover事件，更新预览内容（带防抖功能）
	 */
	private handleTemplateHover(template: Template) {
		// 如果当前选中的模板与hover的模板相同，无需更新预览
		if (this.selectedTemplate && this.selectedTemplate.id === template.id) {
			return;
		}

		this.schedulePreviewUpdate(template);
	}

	/**
	 * 处理模板click事件，设置选中状态并插入模板
	 */
	private handleTemplateClick(template: Template) {
		// 设置选中状态
		this.selectedTemplate = template;
		this.updatePreview(template);
		this.updateTemplateList(); // 更新列表以显示选中状态

		// 检测模板是否引用了 Frontmatter 配置预设
		const templateFM = TemplateEngine.parseTemplateContent(template.content).frontmatter;
		const configId = templateFM['fast-templater-config'] as string;

		if (configId) {
			// 验证预设 ID 是否存在
			const preset = this.plugin.settings.frontmatterPresets.find(p => p.id === configId);
			if (preset) {
				// 打开 Frontmatter 管理模态窗口
				new FrontmatterManagerModal(this.app, this.plugin, template, preset).open();
				this.close();
				return; // 阻止原有的插入逻辑
			} else {
				// 预设不存在，显示警告并回退到原有逻辑
				notifyWarning(`引用的预设 "${configId}" 不存在，将使用默认插入方式`);
			}
		}

		// 插入模板（原有逻辑）
		this.insertTemplate(template);
	}

	/**
	 * 获取当前 Markdown 编辑器，无法获取时提示用户
	 */
	private getActiveEditor(): Editor | null {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView || !activeView.editor) {
			notifyError('无法获取当前编辑器，请确保在 Markdown 文件中使用此功能。');
			return null;
		}
		return activeView.editor;
	}

	/**
	 * 拼接插入结果的细节描述
	 */
	private formatInsertionDetails(...segments: Array<string | undefined | null>): string {
		const parts = segments.filter((segment): segment is string => Boolean(segment && segment.trim()));
		return parts.length > 0 ? `（${parts.join('，')}）` : '';
	}

	/**
	 * 插入模板到编辑器
	 */
	private async insertTemplate(template: Template) {
		try {
			const editor = this.getActiveEditor();
			if (!editor) return;

			// 检查是否启用智能 Frontmatter 合并功能
			if (this.plugin.settings.enableFrontmatterMerge) {
				await this.insertTemplateWithFrontmatterMerge(template, editor);
			} else {
				// 使用原有的逻辑（不进行 frontmatter 合并）
				await this.insertTemplateWithoutFrontmatterMerge(template, editor);
			}

			// 在成功插入模板后，添加到最近使用列表
			await this.plugin.addRecentTemplate(template.id);

			// 插入成功后关闭模态窗口
			this.close();

		} catch (error) {
			handleError(error, {
				context: 'TemplateSelectorModal.insertTemplate',
				userMessage: '插入模板失败，请稍后重试。',
			});
		}
	}

	/**
	 * 使用智能 Frontmatter 合并功能插入模板
	 */
	private async insertTemplateWithFrontmatterMerge(template: Template, editor: Editor) {
		const {
			content: processedContent,
			usedTemplater,
			error: templaterNotice,
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
				usedTemplater ? '并使用 Templater 处理' : undefined,
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
				`已合并 ${Object.keys(templateFM).length} 个 frontmatter 字段`,
			);
			notifySuccess(`模板 "${template.name}" 已插入${details}。`);
		} catch (error) {
			handleError(error, {
				context: 'TemplateSelectorModal.insertTemplateWithFrontmatterMerge',
			});
			notifyWarning('Frontmatter 合并失败，回退到普通插入');
			editor.replaceSelection(template.content);
		}
	}

	/**
	 * 不使用智能 Frontmatter 合并功能插入模板（原有逻辑）
	 */
	private async insertTemplateWithoutFrontmatterMerge(template: Template, editor: Editor) {
		// 1. 统一处理模板内容（包括 Templater 集成）
		const { content: processedContent, usedTemplater, error } = await TemplateEngine.processTemplateContent(this.app, this.plugin, template);

		// 2. 插入处理后的内容
		editor.replaceSelection(processedContent);

		// 3. 根据处理结果显示相应的通知
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

	/**
	 * 更新预览内容
	 */
	private updatePreview(template: Template | null) {
		if (!this.previewContainer) return;

		// 清空现有内容
		this.previewContainer.empty();

		if (!template) {
			// 显示默认提示
			this.previewContainer.createEl('p', {
				text: '悬停或点击模板名称以预览内容',
				cls: 'fast-templater-preview-placeholder'
			});
			return;
		}

		try {
			// 使用Obsidian的Markdown渲染功能
			this.previewContainer.createEl('div', {
				cls: 'fast-templater-preview-markdown'
			}, (el) => {
				// 使用Obsidian的Markdown渲染
				MarkdownRenderer.renderMarkdown(template.content, el, template.path, new Component());
			});
		} catch (error) {
			handleError(error, {
				context: 'TemplateSelectorModal.updatePreview',
			});
			// 显示渲染错误提示
			this.previewContainer.createEl('p', {
				text: '预览渲染失败，显示原始内容：',
				cls: 'fast-templater-preview-error'
			});
			this.previewContainer.createEl('pre', {
				text: template.content,
				cls: 'fast-templater-preview-raw'
			});
		}
	}

	onOpen() {
		const {contentEl} = this;

		// 设置模态窗口的宽度
		this.modalEl.style.width = '85vw';
		this.modalEl.style.maxWidth = '1000px';

		// 创建模态窗口标题
		contentEl.createEl('h2', {text: '选择模板', cls: 'fast-templater-modal-title'});

		// 创建双列布局容器
		const mainContainerEl = contentEl.createDiv('fast-templater-main-container');

		// 创建左侧区域（搜索框 + 模板列表）
		const leftContainerEl = mainContainerEl.createDiv('fast-templater-left-container');

		// 创建搜索输入框容器
		const searchContainerEl = leftContainerEl.createDiv('fast-templater-search-container');
		this.searchInputEl = searchContainerEl.createEl('input', {
			type: 'text',
			placeholder: '搜索模板...',
			cls: 'fast-templater-search-input'
		});

		// 创建清空搜索框的 X 按钮
		const clearButtonEl = searchContainerEl.createEl('button', {
			type: 'button',
			text: '×',
			cls: 'fast-templater-search-clear'
		});
		clearButtonEl.title = '清空搜索';
		clearButtonEl.setAttribute('aria-label', '清空搜索');

		// 清空按钮点击事件
		clearButtonEl.addEventListener('click', () => {
			this.searchInputEl!.value = '';
			this.searchQuery = '';
			this.filteredTemplates = [...this.templates];
			this.updateTemplateList();
			this.searchInputEl!.focus();
			clearButtonEl.style.display = 'none'; // 点击后隐藏
		});

		// 为搜索输入框添加事件监听器
		this.searchInputEl.addEventListener('input', this.handleSearchInput);
		this.searchInputEl.addEventListener('keydown', this.handleKeyDown);

		// 创建可滚动的列表容器
		const containerEl = leftContainerEl.createDiv('fast-templater-modal-container');

		// 创建右侧预览面板
		const previewContainerEl = mainContainerEl.createDiv('fast-templater-preview-container');
		previewContainerEl.createEl('h3', {text: '预览', cls: 'fast-templater-preview-title'});

		// 创建预览内容区域
		this.previewContainer = previewContainerEl.createDiv('fast-templater-preview-content');
		this.updatePreview(null); // 显示默认提示

		// 自动重新扫描模板并更新显示
		this.autoReloadTemplatesAndRender(containerEl);

		// 添加关闭按钮
		const footerEl = contentEl.createDiv('fast-templater-modal-footer');
		const closeBtn = footerEl.createEl('button', {
			text: '关闭',
			cls: 'fast-templater-ghost-button'
		});
		closeBtn.type = 'button';
		closeBtn.onclick = () => this.close();

		// 聚焦到搜索输入框以便用户直接输入
		setTimeout(() => this.searchInputEl?.focus(), 100);
	}

	onClose() {
		const {contentEl} = this;

		// 移除搜索输入框的事件监听器，防止内存泄漏
		if (this.searchInputEl) {
			this.searchInputEl.removeEventListener('input', this.handleSearchInput);
			this.searchInputEl.removeEventListener('keydown', this.handleKeyDown);
			this.searchInputEl = null;
		}

		// 取消挂起的防抖任务
		this.scheduleSearchUpdate.cancel();
		this.schedulePreviewUpdate.cancel();

		contentEl.empty();
	}
}
