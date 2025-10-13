import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, Component, MarkdownRenderer } from 'obsidian';

// Remember to rename these classes and interfaces!

interface FastTemplaterSettings {
	templateFolderPath: string; // 模板文件夹路径
	enableTemplaterIntegration: boolean; // 是否启用 Templater 集成
}

interface Template {
	id: string;      // 唯一标识符，使用文件路径
	name: string;    // 模板名称，通常是文件名
	path: string;    // 模板的完整文件路径
	content: string; // 模板的纯文本内容
}

enum TemplateLoadStatus {
	IDLE = 'idle',           // 未加载
	LOADING = 'loading',     // 加载中
	SUCCESS = 'success',     // 成功
	ERROR = 'error',        // 错误
	EMPTY = 'empty'         // 空文件夹
}

interface TemplateLoadResult {
	status: TemplateLoadStatus;
	count: number;
	message?: string;
	error?: Error;
}

const DEFAULT_SETTINGS: FastTemplaterSettings = {
	templateFolderPath: 'Templates',
	enableTemplaterIntegration: true // 默认启用 Templater 集成
}

export default class FastTemplater extends Plugin {
	settings: FastTemplaterSettings;
	updateStatusBar?: () => void;
	templates: Template[] = []; // 存储所有读取到的模板
	templateLoadStatus: TemplateLoadResult = {
		status: TemplateLoadStatus.IDLE,
		count: 0
	}; // 模板加载状态

	async onload() {
		await this.loadSettings();
		await this.loadTemplates(); // 加载模板文件

		// Ribbon 图标 - 提供快速访问模板功能
		const ribbonIconEl = this.addRibbonIcon('layout-template', '插入可视化模板', (_evt: MouseEvent) => {
			// 直接打开模板选择界面
			new TemplateSelectorModal(this.app, this).open();
		});
		ribbonIconEl.addClass('fast-templater-ribbon-class');

		// 状态栏 - 显示当前模板路径
		const statusBarItemEl = this.addStatusBarItem();
		const updateStatusBar = () => {
			statusBarItemEl.setText(`📁 ${this.settings.templateFolderPath || '未设置'}`);
		};
		updateStatusBar();

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'open-about-modal',
			name: '关于 Fast Templater',
			icon: 'info',
			callback: () => {
				new AboutModal(this.app).open();
			}
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'insert-template-placeholder',
			name: '插入模板占位符',
			icon: 'code',
			editorCallback: (editor: Editor, _view: MarkdownView) => {
				const selection = editor.getSelection();
				if (selection) {
					editor.replaceSelection(`{{${selection}}}`);
				} else {
					editor.replaceSelection('{{template-placeholder}}');
				}
			}
		});
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'open-template-settings',
			name: '打开模板设置',
			icon: 'settings',
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						// 打开设置页面并导航到插件设置
						this.openSettings();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			}
		});
		// This adds a command to open the template selector modal
		this.addCommand({
			id: 'insert-visual-template',
			name: '插入可视化模板',
			icon: 'layout-template',
			callback: () => {
				// 创建并打开模板选择模态窗口
				new TemplateSelectorModal(this.app, this).open();
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new FastTemplaterSettingTab(this.app, this));

		// 状态栏更新函数（在设置变化时调用）
		this.updateStatusBar = updateStatusBar;
	}

	onunload() {

	}

	async loadSettings() {
		try {
			this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		} catch (error) {
			console.error('Fast Templater: 加载设置失败', error);
			new Notice('Fast Templater: 加载设置失败，使用默认设置');
			this.settings = { ...DEFAULT_SETTINGS };
		}
	}

	async saveSettings() {
		try {
			await this.saveData(this.settings);
			// 更新状态栏显示
			if (this.updateStatusBar) {
				this.updateStatusBar();
			}
			// 重新加载模板文件
			await this.loadTemplates();
		} catch (error) {
			console.error('Fast Templater: 保存设置失败', error);
			new Notice('Fast Templater: 保存设置失败');
		}
	}

	/**
	 * 规范化路径，移除首尾空格和斜杠
	 */
	private normalizePath(path: string): string {
		return path.trim().replace(/^\/+|\/+$/g, '');
	}

	/**
	 * 验证模板文件夹路径是否存在
	 */
	async validateTemplatePath(path: string): Promise<boolean> {
		if (!path || path.trim() === '') {
			return false;
		}

		try {
			const normalizedPath = this.normalizePath(path);
			const folder = this.app.vault.getAbstractFileByPath(normalizedPath);
			return folder !== null && 'children' in folder;
		} catch {
			return false;
		}
	}

	/**
	 * 加载模板文件到内存
	 */
	async loadTemplates(): Promise<TemplateLoadResult> {
		// 设置加载状态
		this.templateLoadStatus = {
			status: TemplateLoadStatus.LOADING,
			count: 0,
			message: '正在加载模板...'
		};

		try {
			const folderPath = this.settings.templateFolderPath?.trim();
			if (!folderPath) {
				this.templateLoadStatus = {
					status: TemplateLoadStatus.ERROR,
					count: 0,
					message: '模板文件夹路径未设置'
				};
				console.log('Fast Templater: 模板文件夹路径未设置');
				return this.templateLoadStatus;
			}

			// 验证路径有效性
			const pathExists = await this.validateTemplatePath(folderPath);
			if (!pathExists) {
				this.templateLoadStatus = {
					status: TemplateLoadStatus.ERROR,
					count: 0,
					message: `模板文件夹路径 "${folderPath}" 无效或不存在`
				};
				console.warn(`Fast Templater: 路径 "${folderPath}" 无效或不存在`);
				return this.templateLoadStatus;
			}

			// 获取所有文件
			const allFiles = this.app.vault.getFiles();

			// 过滤出指定文件夹下的 .md 文件（包含子文件夹）
			const normalizedPath = this.normalizePath(folderPath);
			const templateFiles = allFiles.filter(file => {
				return file.extension === 'md' &&
                   file.path.startsWith(normalizedPath + '/');
			});

			// 清空现有模板
			this.templates = [];

			// 读取每个模板文件的内容
			let errorCount = 0;

			for (const file of templateFiles) {
				try {
					const content = await this.app.vault.read(file);
					const template: Template = {
						id: file.path,
						name: file.basename, // 文件名（不含扩展名）
						path: file.path,
						content: content
					};
					this.templates.push(template);
				} catch (error) {
					errorCount++;
					console.warn(`Fast Templater: 无法读取模板文件 ${file.path}`, error);
				}
			}

			// 按模板名称进行 A-Z 排序
			this.templates.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { sensitivity: 'base' }));

			// 更新状态
			if (this.templates.length === 0) {
				this.templateLoadStatus = {
					status: TemplateLoadStatus.EMPTY,
					count: 0,
					message: `文件夹 "${folderPath}" 中未找到 .md 模板文件`
				};
			} else {
				this.templateLoadStatus = {
					status: TemplateLoadStatus.SUCCESS,
					count: this.templates.length,
					message: `成功加载 ${this.templates.length} 个模板文件`
				};
			}

			console.log(`Fast Templater: ${this.templateLoadStatus.message}`);
			if (errorCount > 0) {
				console.warn(`Fast Templater: ${errorCount} 个文件读取失败`);
			}

			return this.templateLoadStatus;

		} catch (error) {
			const errorMessage = 'Fast Templater: 加载模板失败';
			this.templateLoadStatus = {
				status: TemplateLoadStatus.ERROR,
				count: 0,
				message: errorMessage,
				error: error as Error
			};
			console.error(errorMessage, error);
			new Notice(`${errorMessage}，请检查模板文件夹设置`);
			return this.templateLoadStatus;
		}
	}

	/**
	 * 重新加载模板文件
	 */
	async reloadTemplates(): Promise<TemplateLoadResult> {
		return await this.loadTemplates();
	}

	/**
	 * 获取所有模板
	 */
	getTemplates(): Template[] {
		return [...this.templates]; // 返回副本，避免外部修改
	}

	/**
	 * 根据ID获取模板
	 */
	getTemplateById(id: string): Template | undefined {
		return this.templates.find(template => template.id === id);
	}

	/**
	 * 获取模板加载状态
	 */
	getTemplateLoadStatus(): TemplateLoadResult {
		return { ...this.templateLoadStatus }; // 返回副本
	}

	/**
	 * 检查是否有可用模板
	 */
	hasTemplates(): boolean {
		return this.templates.length > 0 &&
			this.templateLoadStatus.status === TemplateLoadStatus.SUCCESS;
	}

	/**
	 * 打开插件设置页面的辅助方法
	 */
	openSettings() {
		const appInstance = this.app as any;
		appInstance.setting.open();
		appInstance.setting.openTabById(this.manifest.id);
	}
}

class AboutModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.createEl('h2', {text: 'Fast Templater'});
		contentEl.createEl('p', {text: '可视化模板插件，帮助您通过可视化界面插入模板片段。'});
		contentEl.createEl('p', {text: '版本: 1.0.0'});

		const closeBtn = contentEl.createEl('button', {text: '关闭'});
		closeBtn.onclick = () => this.close();
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class TemplateSelectorModal extends Modal {
	templates: Template[];
	private plugin: FastTemplater;
	private searchQuery = ''; // 搜索查询字符串
	private filteredTemplates: Template[] = []; // 过滤后的模板列表
	private searchDebounceTimer: number | null = null; // 防抖定时器
	private selectedTemplate: Template | null = null; // 当前选中的模板
	private previewContainer: HTMLElement | null = null; // 预览容器引用
	private previewDebounceTimer: number | null = null; // 预览防抖定时器
	private templateLoadStatus: TemplateLoadResult; // 模板加载状态
	private activeIndex = 0; // 用于键盘导航
	private listEl: HTMLElement | null = null; // 模板列表元素

	constructor(app: App, plugin: FastTemplater) {
		super(app);
		this.plugin = plugin;
		this.templates = this.plugin.getTemplates();
		this.filteredTemplates = [...this.templates]; // 初始化时显示所有模板
		this.templateLoadStatus = this.plugin.getTemplateLoadStatus();
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
						icon: '⚙️',
						title: '模板路径未设置',
						message: '您需要先设置模板文件夹路径才能使用此功能。',
						actions: [
							{ text: '设置路径', action: openSettings, primary: true },
							{ text: '稍后再说', action: () => this.close() }
						]
					};
				} else if (message.includes('无效或不存在')) {
					return {
						icon: '📂',
						title: '模板文件夹不存在',
						message: '指定的模板文件夹路径无效或不存在，请检查路径设置。',
						actions: [
							{ text: '修正路径', action: openSettings, primary: true },
							{ text: '重新扫描', action: retryScan }
						]
					};
				} else {
					return {
						icon: '❌',
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
					icon: '📝',
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
			icon: '🔍',
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
	 * 重新加载模板并提供用户反馈（辅助方法）
	 * 此方法统一处理以下逻辑，消除代码重复：
	 * 1. 禁用搜索输入框并添加加载状态样式
	 * 2. 调用插件的 reloadTemplates 方法重新加载模板
	 * 3. 更新内部模板数据和UI显示
	 * 4. 恢复搜索输入框状态并重新聚焦
	 * 5. 根据加载结果显示用户通知
	 * @returns Promise<TemplateLoadResult> 模板加载结果
	 */
	private async reloadTemplatesWithFeedback(): Promise<TemplateLoadResult> {
		const searchInputEl = this.contentEl.querySelector('.fast-templater-search-input') as HTMLInputElement;
		if (searchInputEl) {
			searchInputEl.disabled = true;
			searchInputEl.classList.add('fast-templater-search-loading');
		}

		const result = await this.plugin.reloadTemplates();
		this.templates = this.plugin.getTemplates();
		this.filteredTemplates = [...this.templates];
		this.templateLoadStatus = result;
		this.updateTemplateList();

		if (searchInputEl) {
			searchInputEl.disabled = false;
			searchInputEl.classList.remove('fast-templater-search-loading');
			searchInputEl.focus();
		}

		if (result.status === 'success') {
			new Notice(`✅ ${result.message}`);
		} else {
			new Notice(`⚠️ ${result.message}`);
		}

		return result;
	}

	/**
	 * 打开插件设置页面（辅助方法）
	 */
	private openPluginSettings() {
		this.close();
		const appInstance = this.app as any;
		appInstance.setting.open();
		appInstance.setting.openTabById(this.plugin.manifest.id);
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

		// 插入模板
		this.insertTemplate(template);
	}

	/**
	 * 检测是否安装了 Templater 插件
	 */
	private getTemplaterPlugin(): any {
		// @ts-ignore - 访问内部 API
		const templater = this.app.plugins.plugins['templater-obsidian'];
		return templater;
	}

	/**
	 * 检查 Templater 插件是否已启用
	 */
	private isTemplaterEnabled(): boolean {
		// @ts-ignore - 访问内部 API
		return this.app.plugins.enabledPlugins.has('templater-obsidian');
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
			const cursor = editor.getCursor();

			// 检查是否启用 Templater 集成
			if (this.plugin.settings.enableTemplaterIntegration && this.isTemplaterEnabled()) {
				try {
					const templater = this.getTemplaterPlugin();

					if (templater && templater.templater) {
						// 使用 Templater 的 API 解析模板内容
						// read_and_parse_template 需要一个 RunningConfig 对象,而不是单个 TFile
						const abstractFile = this.app.vault.getAbstractFileByPath(template.path);

						// 检查是否是有效的 TFile 对象(必须有 extension 属性且为文件而非文件夹)
						if (abstractFile && 'extension' in abstractFile && abstractFile.extension === 'md') {
							const templateFile = abstractFile;

							// 获取当前活动文件(Templater 需要目标文件上下文)
							const activeFile = this.app.workspace.getActiveFile();

							if (!activeFile) {
								console.warn('Fast Templater: 无法获取当前活动文件');
								editor.replaceSelection(template.content);
								new Notice(`✅ 模板 "${template.name}" 已插入(无法获取活动文件,已回退到普通插入)。`);
								return;
							}

							console.log('Fast Templater: 准备调用 Templater API', {
								templatePath: templateFile.path,
								templateName: templateFile.name,
								activeFilePath: activeFile.path,
								activeFileName: activeFile.name
							});

							// 创建 RunningConfig 对象
							// read_and_parse_template 的参数必须是 RunningConfig,包含:
							// - template_file: 模板文件
							// - target_file: 目标文件(当前活动文件)
							// - run_mode: 运行模式(4 = DynamicProcessor,用于动态插入)
							// - active_file: 当前活动文件
							const config = {
								template_file: templateFile,
								target_file: activeFile,
								run_mode: 4, // DynamicProcessor 模式
								active_file: activeFile
							};

							// 调用 read_and_parse_template
							const parsedContent = await templater.templater.read_and_parse_template(config);

							// 插入解析后的内容
							editor.replaceSelection(parsedContent);

							new Notice(`✅ 模板 "${template.name}" 已插入并使用 Templater 处理。`);
						} else {
							// 如果无法获取文件对象,回退到普通插入
							console.warn('Fast Templater: 无法获取有效的 TFile 对象', {
								path: template.path,
								abstractFile: abstractFile
							});
							editor.replaceSelection(template.content);
							new Notice(`✅ 模板 "${template.name}" 已插入(无法获取文件对象,已回退到普通插入)。`);
						}
					} else {
						// Templater 已安装但 API 不可用，回退到普通插入
						editor.replaceSelection(template.content);
						new Notice(`✅ 模板 "${template.name}" 已插入(Templater API 不可用)。`);
					}
				} catch (templaterError) {
					// Templater 处理失败，回退到普通插入
					console.warn('Fast Templater: Templater 处理失败，使用普通插入', templaterError);
					editor.replaceSelection(template.content);
					new Notice(`✅ 模板 "${template.name}" 已插入(Templater 处理失败，已回退到普通插入)。`);
				}
			} else {
				// 未启用 Templater 集成或 Templater 未安装，直接插入模板内容
				editor.replaceSelection(template.content);

				const notice = this.plugin.settings.enableTemplaterIntegration && !this.isTemplaterEnabled()
					? `✅ 模板 "${template.name}" 已插入(未检测到 Templater 插件)。`
					: `✅ 模板 "${template.name}" 已插入。`;
				new Notice(notice);
			}

			// 插入成功后关闭模态窗口
			this.close();

		} catch (error) {
			console.error('Fast Templater: 插入模板失败', error);
			new Notice('❌ 插入模板失败，请稍后重试。');
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
		contentEl.createEl('h2', {text: '选择模板'});

		// 创建双列布局容器
		const mainContainerEl = contentEl.createDiv('fast-templater-main-container');

		// 创建左侧区域（搜索框 + 模板列表）
		const leftContainerEl = mainContainerEl.createDiv('fast-templater-left-container');

		// 创建搜索输入框容器
		const searchContainerEl = leftContainerEl.createDiv('fast-templater-search-container');
		const searchInputEl = searchContainerEl.createEl('input', {
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
			searchInputEl.value = '';
			this.searchQuery = '';
			this.filteredTemplates = [...this.templates];
			this.updateTemplateList();
			searchInputEl.focus();
			clearButtonEl.style.display = 'none'; // 点击后隐藏
		});

		// 为搜索输入框添加事件监听器
		searchInputEl.addEventListener('input', this.handleSearchInput);
		searchInputEl.addEventListener('keydown', this.handleKeyDown);

		// 创建可滚动的列表容器
		const containerEl = leftContainerEl.createDiv('fast-templater-modal-container');

		// 创建右侧预览面板
		const previewContainerEl = mainContainerEl.createDiv('fast-templater-preview-container');
		previewContainerEl.createEl('h3', {text: '预览', cls: 'fast-templater-preview-title'});

		// 创建预览内容区域
		this.previewContainer = previewContainerEl.createDiv('fast-templater-preview-content');
		this.updatePreview(null); // 显示默认提示

		// 使用公共方法渲染模板列表，消除代码重复
		this.renderTemplateList(containerEl);

		// 添加关闭按钮
		const closeBtn = contentEl.createEl('button', {
			text: '关闭',
			cls: 'mod-cta'
		});
		closeBtn.onclick = () => this.close();

		// 聚焦到搜索输入框以便用户直接输入
		setTimeout(() => searchInputEl.focus(), 100);
	}

	onClose() {
		const {contentEl} = this;

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

class FastTemplaterSettingTab extends PluginSettingTab {
	plugin: FastTemplater;

	constructor(app: App, plugin: FastTemplater) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * 计算 Templater 状态信息
	 */
	private getTemplaterStatusInfo(): { icon: string; text: string; color: string; details: string[] } {
		// @ts-ignore - 访问内部 API
		const isTemplaterInstalled = this.app.plugins.enabledPlugins.has('templater-obsidian');
		const isIntegrationEnabled = this.plugin.settings.enableTemplaterIntegration;

		let statusIcon = '❌';
		let statusText = 'Templater 未安装';
		let statusColor = 'var(--text-muted)';
		const details: string[] = [];

		if (isIntegrationEnabled && isTemplaterInstalled) {
			statusIcon = '✅';
			statusText = 'Templater 集成已启用';
			statusColor = 'var(--text-success)';
			details.push('模板中的 Templater 语法将自动执行');
		} else if (isIntegrationEnabled && !isTemplaterInstalled) {
			statusIcon = '⚠️';
			statusText = 'Templater 集成已启用,但未检测到 Templater 插件';
			statusColor = 'var(--text-warning)';
			details.push('请先在社区插件中安装 Templater 插件');
		} else if (!isIntegrationEnabled && isTemplaterInstalled) {
			statusIcon = '💤';
			statusText = 'Templater 已安装,但集成未启用';
			statusColor = 'var(--text-muted)';
		} else {
			details.push('请先在社区插件中安装 Templater 插件');
		}

		return { icon: statusIcon, text: statusText, color: statusColor, details };
	}

	/**
	 * 计算模板状态信息
	 */
	private getTemplateStatusInfo(): {
		icon: string;
		text: string;
		color: string;
		folderPath: string;
		showReloadButton: boolean;
	} {
		const status = this.plugin.getTemplateLoadStatus();
		const folderPath = this.plugin.settings.templateFolderPath || '未设置';

		let statusIcon = '⏳';
		let statusText = '未知状态';
		let statusColor = 'var(--text-muted)';
		let showReloadButton = true;

		switch (status.status) {
			case 'loading':
				statusIcon = '⏳';
				statusText = '加载中...';
				statusColor = 'var(--text-accent)';
				showReloadButton = false;
				break;
			case 'success':
				statusIcon = '✅';
				statusText = `成功加载 ${status.count} 个模板`;
				statusColor = 'var(--text-success)';
				break;
			case 'empty':
				statusIcon = '📂';
				statusText = '文件夹为空或未找到模板';
				statusColor = 'var(--text-muted)';
				break;
			case 'error':
				statusIcon = '❌';
				statusText = status.message || '加载失败';
				statusColor = 'var(--text-error)';
				break;
			case 'idle':
				statusIcon = '💤';
				statusText = '未加载';
				statusColor = 'var(--text-muted)';
				break;
		}

		return { icon: statusIcon, text: statusText, color: statusColor, folderPath, showReloadButton };
	}

	/**
	 * 渲染 Templater 状态显示元素
	 */
	private renderTemplaterStatus(containerEl: HTMLElement): HTMLElement {
		const statusInfo = this.getTemplaterStatusInfo();
		const statusEl = containerEl.createEl('div', { cls: 'setting-item-description' });

		// 创建状态内容容器
		const contentEl = statusEl.createEl('small');
		contentEl.createEl('span', { text: '🔌 ' });
		contentEl.createEl('strong', { text: 'Templater 状态：' });
		contentEl.createEl('br');

		// 状态行
		const statusLine = contentEl.createEl('span', { text: '• ' });
		const statusSpan = statusLine.createSpan({
			text: `${statusInfo.icon} ${statusInfo.text}`
		});
		statusSpan.style.color = statusInfo.color;
		contentEl.createEl('br');

		// 详细信息
		statusInfo.details.forEach(detail => {
			contentEl.createEl('span', { text: `• ${detail}` });
			contentEl.createEl('br');
		});

		return statusEl;
	}

	/**
	 * 渲染模板状态显示元素
	 */
	private renderTemplateStatus(containerEl: HTMLElement): HTMLElement {
		const statusInfo = this.getTemplateStatusInfo();
		const statusEl = containerEl.createEl('div', { cls: 'setting-item-description' });

		// 创建状态内容容器
		const contentEl = statusEl.createEl('small');
		contentEl.createEl('span', { text: '📋 ' });
		contentEl.createEl('strong', { text: '模板状态：' });
		contentEl.createEl('br');

		// 当前路径
		contentEl.createEl('span', { text: '• 当前路径: ' });
		contentEl.createEl('code', { text: statusInfo.folderPath });
		contentEl.createEl('br');

		// 状态行
		const statusLine = contentEl.createEl('span', { text: '• 状态: ' });
		const statusSpan = statusLine.createSpan({
			text: `${statusInfo.icon} ${statusInfo.text}`
		});
		statusSpan.style.color = statusInfo.color;
		contentEl.createEl('br');

		// 重新扫描按钮
		if (statusInfo.showReloadButton) {
			const reloadBtn = contentEl.createEl('button', {
				text: '重新扫描模板',
				type: 'button',
				cls: 'mod-cta'
			});
			this.attachReloadButtonHandler(reloadBtn, statusEl);
		}

		return statusEl;
	}

	/**
	 * 为重新扫描按钮附加事件处理程序
	 * 此方法统一处理设置页面中的模板重新加载逻辑
	 * @param button 重新扫描按钮元素
	 * @param statusEl 需要更新的状态显示元素
	 */
	private attachReloadButtonHandler(button: HTMLButtonElement, statusEl: HTMLElement): void {
		button.onclick = async () => {
			// 更新按钮状态，防止重复点击
			button.textContent = '扫描中...';
			button.disabled = true;

			// 调用插件的重新加载方法
			const result = await this.plugin.reloadTemplates();

			// 重新渲染状态显示
			statusEl.empty();
			const newStatusEl = this.renderTemplateStatus(statusEl.parentElement!);
			statusEl.replaceWith(newStatusEl);

			// 根据加载结果显示用户通知
			if (result.status === 'success') {
				new Notice(`✅ ${result.message}`);
			} else {
				new Notice(`⚠️ ${result.message}`);
			}
		};
	}

	/**
	 * 渲染路径验证提示元素
	 */
	private renderPathValidationHints(containerEl: HTMLElement): HTMLElement {
		const hintEl = containerEl.createEl('div', { cls: 'setting-item-description' });
		const contentEl = hintEl.createEl('small');

		contentEl.createEl('span', { text: '💡 ' });
		contentEl.createEl('strong', { text: '提示：' });
		contentEl.createEl('br');

		const hints = [
			'路径相对于库根目录',
			'支持多级路径,如 "Templates/Projects"',
			'使用验证按钮检查路径是否包含模板文件',
			'只有 .md 文件会被识别为模板'
		];

		hints.forEach(hint => {
			contentEl.createEl('span', { text: `• ${hint}` });
			contentEl.createEl('br');
		});

		return hintEl;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'Fast Templater 设置'});

		new Setting(containerEl)
			.setName('模板文件夹路径')
			.setDesc('输入存放模板文件的文件夹路径，插件将在此路径下查找模板文件')
			.addText(text => {
				const setting = text
					.setPlaceholder('例如：Templates')
					.setValue(this.plugin.settings.templateFolderPath);

				// 创建验证按钮容器
				const parentElement = text.inputEl.parentElement;
				if (!parentElement) return;

				const buttonContainer = parentElement.createDiv('mod-cta');
				const verifyButton = buttonContainer.createEl('button', {
					text: '验证路径',
					cls: 'mod-cta'
				});

				verifyButton.onclick = async () => {
					const currentPath = setting.getValue();
					const isValid = await this.plugin.validateTemplatePath(currentPath);
					if (isValid) {
						new Notice(`✅ 路径 "${currentPath}" 有效，已找到模板文件`);
					} else {
						new Notice(`⚠️ 路径 "${currentPath}" 未找到模板文件`);
					}
				};

				return setting.onChange(async (value) => {
					// 清理路径，移除首尾空格和斜杠
					const cleanPath = value.trim().replace(/^\/+|\/+$/g, '');
					const oldPath = this.plugin.settings.templateFolderPath;
					this.plugin.settings.templateFolderPath = cleanPath;
					await this.plugin.saveSettings();

					// 提供用户反馈
					if (cleanPath && cleanPath !== oldPath) {
						new Notice(`模板路径已更新为: ${cleanPath}`);
					}
				});
			});

		// Templater 集成设置
		let templaterStatusEl: HTMLElement;
		new Setting(containerEl)
			.setName('启用 Templater 集成')
			.setDesc('启用后，插入模板时会自动调用 Templater 插件处理模板语法（如 <% tp.date.now() %>）。需要先安装 Templater 插件。')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableTemplaterIntegration)
				.onChange(async (value) => {
					this.plugin.settings.enableTemplaterIntegration = value;
					await this.plugin.saveSettings();
					// 更新 Templater 状态显示
					if (templaterStatusEl) {
						const newStatusEl = this.renderTemplaterStatus(containerEl);
						templaterStatusEl.replaceWith(newStatusEl);
						templaterStatusEl = newStatusEl;
					}
					new Notice(value ? '已启用 Templater 集成' : '已禁用 Templater 集成');
				})
			);

		// 初始显示 Templater 状态
		templaterStatusEl = this.renderTemplaterStatus(containerEl);

		// 初始显示模板状态
		this.renderTemplateStatus(containerEl);

		// 路径验证提示
		this.renderPathValidationHints(containerEl);
	}
}