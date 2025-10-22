import { App, Component, Editor, MarkdownRenderer, MarkdownView, Modal, Notice } from 'obsidian';
import type FastTemplater from '@core/plugin';
import { TemplateManager } from '@templates';
import { TemplateLoadStatus } from '@types';
import type { Template, TemplateLoadResult } from '@types';
import * as TemplateEngine from '@engine';
import { FrontmatterManagerModal } from './frontmatter-manager-modal';

export class TemplateSelectorModal extends Modal {
	private readonly plugin: FastTemplater;
	private readonly templateManager: TemplateManager;
	private templates: Template[];
	private searchQuery = ''; // 搜索查询字符串
	private filteredTemplates: Template[] = []; // 过滤后的模板列表
	private searchDebounceTimer: number | null = null; // 防抖定时器
	private selectedTemplate: Template | null = null; // 当前选中的模板
	private previewContainer: HTMLElement | null = null; // 预览容器引用
	private previewDebounceTimer: number | null = null; // 预览防抖定时器
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

		// 清除之前的防抖定时器
		if (this.searchDebounceTimer !== null) {
			clearTimeout(this.searchDebounceTimer);
		}

		// 对于空搜索，立即更新
		if (this.searchQuery.trim() === '') {
			this.filteredTemplates = [...this.templates];
			this.updateTemplateList();
			return;
		}

		// 设置新的防抖定时器（300ms延迟）
		this.searchDebounceTimer = window.setTimeout(() => {
			this.filteredTemplates = this.searchTemplates(this.searchQuery);
			this.updateTemplateList();
			this.searchDebounceTimer = null;
		}, 300);
	}

	/**
	 * 处理键盘导航事件
	 */
	private handleKeyDown = (event: KeyboardEvent) => {
		if (this.filteredTemplates.length === 0) return;

		switch (event.key) {
			case 'ArrowDown': {
				this.activeIndex = (this.activeIndex + 1) % this.filteredTemplates.length;
				this.updateActiveDescendant();
				event.preventDefault();
				break;
			}
			case 'ArrowUp': {
				this.activeIndex = (this.activeIndex - 1 + this.filteredTemplates.length) % this.filteredTemplates.length;
				this.updateActiveDescendant();
				event.preventDefault();
				break;
			}
			case 'Enter': {
				if (this.activeIndex >= 0 && this.activeIndex < this.filteredTemplates.length) {
					this.handleTemplateClick(this.filteredTemplates[this.activeIndex]);
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
			this.handleTemplateHover(this.filteredTemplates[this.activeIndex]);
		}
	}

	/**
	 * 渲染增强的状态消息容器
	 */
	private renderStatusContainer(containerEl: HTMLElement, status: {
		icon: string;
		title: string;
		message: string;
		actions?: Array<{ text: string; action: () => void; primary?: boolean }>;
	}) {
		// 创建状态容器
		const statusContainer = containerEl.createDiv('fast-templater-status-container');

		// 图标和标题
		const headerEl = statusContainer.createDiv('fast-templater-status-header');
		headerEl.createEl('div', { text: status.icon, cls: 'fast-templater-status-icon' });
		headerEl.createEl('h3', { text: status.title, cls: 'fast-templater-status-title' });

		// 消息
		statusContainer.createEl('p', { text: status.message, cls: 'fast-templater-status-message' });

		// 操作按钮
		if (status.actions && status.actions.length > 0) {
			const actionsContainer = statusContainer.createDiv('fast-templater-status-actions');
			status.actions.forEach(action => {
				const btn = actionsContainer.createEl('button', {
					text: action.text,
					cls: action.primary ? 'mod-cta' : ''
				});
				btn.onclick = action.action;
			});
		}
	}

	/**
	 * 获取错误状态信息
	 */
	private getErrorStatusInfo(): { icon: string; title: string; message: string; actions?: Array<{ text: string; action: () => void; primary?: boolean }> } | null {
		if (!this.templateLoadStatus || this.templateLoadStatus.status === TemplateLoadStatus.SUCCESS) {
			return null;
		}

		const status = this.templateLoadStatus.status;
		const openSettings = () => this.openPluginSettings();

		const retryScan = () => this.reloadTemplatesWithFeedback();

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
							{ text: '重新扫描', action: retryScan }
						]
					};
				} else {
					return {
						icon: '',
						title: '加载失败',
						message: '加载模板时发生错误，请稍后重试或检查设置。',
						actions: [
							{ text: '重新扫描', action: retryScan, primary: true },
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
							new Notice('请在模板文件夹中创建 .md 文件作为模板。');
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
				{ text: '重新扫描', action: () => this.reloadTemplatesWithFeedback() },
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
	private renderTemplateItems(containerEl: HTMLElement) {
		// 创建模板列表
		this.listEl = containerEl.createEl('ul', {cls: 'fast-templater-template-list'});

		this.filteredTemplates.forEach((template, index) => {
			if (!this.listEl) return;

			const listItemEl = this.listEl.createEl('li', {
				cls: 'fast-templater-template-item'
			});

			// 添加活动状态样式
			if (index === this.activeIndex) {
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
				this.activeIndex = index;
				this.updateActiveDescendant();
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
	 * 1. 禁用搜索输入框并添加加载状态样式
	 * 2. 调用插件的 reloadTemplates 方法重新加载模板（启用通知）
	 * 3. 更新内部模板数据和UI显示
	 * 4. 恢复搜索输入框状态并重新聚焦
	 * @returns Promise<TemplateLoadResult> 模板加载结果
	 */
	private async reloadTemplatesWithFeedback(): Promise<TemplateLoadResult> {
		const searchInputEl = this.contentEl.querySelector('.fast-templater-search-input') as HTMLInputElement;
		if (searchInputEl) {
			searchInputEl.disabled = true;
			searchInputEl.classList.add('fast-templater-search-loading');
		}

		// 调用插件方法并启用通知
		const result = await this.templateManager.reloadTemplates(true);
		this.templates = this.templateManager.getTemplates();
		this.filteredTemplates = [...this.templates];
		this.templateLoadStatus = result;
		this.updateTemplateList();

		if (searchInputEl) {
			searchInputEl.disabled = false;
			searchInputEl.classList.remove('fast-templater-search-loading');
			searchInputEl.focus();
		}

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

		// 渲染模板列表项
		this.renderTemplateItems(containerEl);
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
		// 清除之前的预览防抖定时器
		if (this.previewDebounceTimer !== null) {
			clearTimeout(this.previewDebounceTimer);
		}

		// 如果当前选中的模板与hover的模板相同，无需更新预览
		if (this.selectedTemplate && this.selectedTemplate.id === template.id) {
			return;
		}

		// 设置新的预览防抖定时器（200ms延迟，比搜索防抖更快以提供更好的用户体验）
		this.previewDebounceTimer = window.setTimeout(() => {
			this.updatePreview(template);
			this.previewDebounceTimer = null;
		}, 200);
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
				return; // 阻止原有的插入逻辑
			} else {
				// 预设不存在，显示警告并回退到原有逻辑
				new Notice(`引用的预设 "${configId}" 不存在，将使用默认插入方式`);
			}
		}

		// 插入模板（原有逻辑）
		this.insertTemplate(template);
	}

	/**
	 * 插入模板到编辑器
	 */
	private async insertTemplate(template: Template) {
		try {
			// 获取当前激活的Markdown视图和编辑器实例
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

			if (!activeView || !activeView.editor) {
				new Notice('无法获取当前编辑器，请确保在Markdown文件中使用此功能。');
				return;
			}

			const editor = activeView.editor;

			// 检查是否启用智能 Frontmatter 合并功能
			if (this.plugin.settings.enableFrontmatterMerge) {
				await this.insertTemplateWithFrontmatterMerge(template, editor);
			} else {
				// 使用原有的逻辑（不进行 frontmatter 合并）
				await this.insertTemplateWithoutFrontmatterMerge(template, editor);
			}

			// 插入成功后关闭模态窗口
			this.close();

		} catch (error) {
			console.error('Fast Templater: 插入模板失败', error);
			new Notice('插入模板失败，请稍后重试。');
		}
	}

	/**
	 * 使用智能 Frontmatter 合并功能插入模板
	 */
	private async insertTemplateWithFrontmatterMerge(template: Template, editor: Editor) {
		try {
			// 1. 统一处理模板内容（包括 Templater 集成）
			const { content: processedContent, usedTemplater, error } = await TemplateEngine.processTemplateContent(this.app, this.plugin, template);

			// 2. 如果有 Templater 处理错误，显示通知
			if (error) {
				new Notice(`${error}进行 frontmatter 合并`);
			}

			// 3. 解析处理后的内容，分离 frontmatter 和主体
			const { frontmatter: templateFM, body: templateBody } = TemplateEngine.parseTemplateContent(processedContent);

			// 4. 获取当前笔记的元数据
			const { frontmatter: noteFM, position: notePosition } = TemplateEngine.getNoteMetadata(this.app);

			// 5. 如果模板没有 frontmatter，直接插入处理后的内容
			if (Object.keys(templateFM).length === 0) {
				editor.replaceSelection(processedContent);
				const notice = `模板 "${template.name}" 已插入（模板无 frontmatter，直接插入）${usedTemplater ? '并使用 Templater 处理' : ''}。`;
				new Notice(notice);
				return;
			}

			// 6. 合并 frontmatter
			const mergedFM = TemplateEngine.mergeFrontmatters(noteFM, templateFM);

			// 7. 更新笔记的 frontmatter
			TemplateEngine.updateNoteFrontmatter(editor, mergedFM, notePosition);

			// 8. 插入模板主体内容到光标位置
			if (templateBody.trim()) {
				editor.replaceSelection(templateBody);
			}

			// 9. 成功通知
			const templaterInfo = usedTemplater ? '并使用 Templater 处理' : '';
			const mergeInfo = Object.keys(templateFM).length > 0
				? ` 已合并 ${Object.keys(templateFM).length} 个 frontmatter 字段`
				: '';
			new Notice(`模板 "${template.name}" 已插入${templaterInfo}${mergeInfo}。`);

		} catch (error) {
			console.error('Fast Templater: 智能 frontmatter 合并失败', error);
			// 如果智能合并失败，回退到普通插入
			new Notice('Frontmatter 合并失败，回退到普通插入');
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
		if (usedTemplater) {
			new Notice(`模板 "${template.name}" 已插入并使用 Templater 处理。`);
		} else if (this.plugin.settings.enableTemplaterIntegration && !TemplateEngine.isTemplaterEnabled(this.app)) {
			new Notice(`模板 "${template.name}" 已插入(未检测到 Templater 插件)。`);
		} else if (error) {
			new Notice(`模板 "${template.name}" 已插入(${error})。`);
		} else {
			new Notice(`模板 "${template.name}" 已插入。`);
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
			console.error('Fast Templater: 预览渲染失败', error);
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

		// 清理防抖定时器
		if (this.searchDebounceTimer !== null) {
			clearTimeout(this.searchDebounceTimer);
			this.searchDebounceTimer = null;
		}

		// 清理预览防抖定时器
		if (this.previewDebounceTimer !== null) {
			clearTimeout(this.previewDebounceTimer);
			this.previewDebounceTimer = null;
		}

		contentEl.empty();
	}
}
