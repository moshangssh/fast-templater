import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, Component, MarkdownRenderer } from 'obsidian';
import * as yaml from 'js-yaml';

// NodeListOf 类型定义
interface NodeListOf<TNode extends Node> extends NodeList {
	readonly length: number;
	item(index: number): TNode;
	[index: number]: TNode;
}

// Helper interfaces for type safety
interface AppWithSettings extends App {
	setting: {
		open(): void;
		openTabById(id: string): void;
	};
}

interface TemplaterPlugin extends Plugin {
	templater?: {
		read_and_parse_template(config: unknown): Promise<string>;
	};
}

interface Loc {
	line: number;
	col: number;
	offset: number;
}
interface Pos {
	start: Loc;
	end: Loc;
}


// Remember to rename these classes and interfaces!

interface FastTemplaterSettings {
	templateFolderPath: string; // 模板文件夹路径
	enableTemplaterIntegration: boolean; // 是否启用 Templater 集成
	enableFrontmatterMerge: boolean; // 是否启用智能 Frontmatter 合并
	frontmatterPresets: FrontmatterPreset[]; // Frontmatter 预设配置
}

interface FrontmatterPreset {
	id: string; // 唯一标识符，例如 'config-1'
	name: string; // 用户友好的预设名称
	fields: FrontmatterField[]; // 字段配置数组
}

interface FrontmatterField {
	key: string; // 实际 Frontmatter 键名
	type: 'text' | 'select' | 'date' | 'multi-select'; // 表单类型
	label: string; // 显示名称
	default: string; // 默认值（可能包含 Templater 宏）
	options?: string[]; // 选项列表，用于 select 和 multi-select 类型
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
	enableTemplaterIntegration: true, // 默认启用 Templater 集成
	enableFrontmatterMerge: true, // 默认启用智能 Frontmatter 合并
	frontmatterPresets: [] // 默认为空数组
}

// Templater 运行模式常量
const TEMPLATER_DYNAMIC_MODE = 4; // DynamicProcessor 模式：动态处理模板内容

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
			const loadedData = await this.loadData();

			// 数据迁移和兼容性处理
			const migratedData = this.migrateSettingsData(loadedData as Partial<FastTemplaterSettings>);

			this.settings = Object.assign({}, DEFAULT_SETTINGS, migratedData);

			// 数据验证和向后兼容性处理
			if (!Array.isArray(this.settings.frontmatterPresets)) {
				this.settings.frontmatterPresets = [];
			}

			// 验证 frontmatterPresets 数组中的每个对象
			this.settings.frontmatterPresets = this.settings.frontmatterPresets.filter((preset) => {
				// 检查必要字段
				if (typeof preset !== 'object' || !preset.id || !preset.name || !Array.isArray(preset.fields)) {
					return false;
				}

				// 验证 fields 数组
				preset.fields = preset.fields.filter((field) => {
					if (typeof field !== 'object' || !field.key || !field.type || !field.label || typeof field.default !== 'string') {
						return false;
					}

					// 验证 type 值
					const validTypes = ['text', 'select', 'date', 'multi-select'];
					if (!validTypes.includes(field.type)) {
						field.type = 'text'; // 默认为 text 类型
					}

					// 验证 options（可选字段）
					if (field.options && !Array.isArray(field.options)) {
						delete field.options;
					}

					return true;
				});

				return preset.fields.length > 0;
			});

		} catch (error) {
			console.error('Fast Templater: 加载设置失败', error);
			new Notice('Fast Templater: 加载设置失败，使用默认设置');
			this.settings = { ...DEFAULT_SETTINGS };
		}
	}

	/**
	 * 数据迁移方法，处理旧版本设置的兼容性
	 */
	private migrateSettingsData(data: Partial<FastTemplaterSettings>): Partial<FastTemplaterSettings> {
		// 如果数据为空或不是对象，直接返回空对象
		if (!data || typeof data !== 'object') {
			return {};
		}

		// 确保新字段在旧数据中不存在时使用安全的空默认值
		const migrated: Partial<FastTemplaterSettings> = {
			...data,
			frontmatterPresets: Array.isArray(data.frontmatterPresets) ? data.frontmatterPresets : []
		};

		// 可以在这里添加更多版本的迁移逻辑
		// 例如：如果将来添加了新字段，可以在这里处理默认值

		return migrated;
	}

	async saveSettings() {
		try {
			// 在保存前进行数据验证，确保数据结构正确
			const dataToSave: FastTemplaterSettings = {
				...this.settings,
				frontmatterPresets: this.settings.frontmatterPresets.map(preset => ({
					id: preset.id,
					name: preset.name,
					fields: preset.fields.map(field => {
						const fieldData: Partial<FrontmatterField> = {
							key: field.key,
							type: field.type,
							label: field.label,
							default: field.default
						};

						// 只有在有 options 且为数组时才包含 options 字段
						if (field.options && Array.isArray(field.options) && field.options.length > 0) {
							fieldData.options = field.options;
						}

						return fieldData as FrontmatterField;
					})
				}))
			};

			await this.saveData(dataToSave);

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
	 * @param showNotice 是否显示通知，默认为 false
	 */
	async reloadTemplates(showNotice: boolean = false): Promise<TemplateLoadResult> {
		const result = await this.loadTemplates();

		// 根据参数决定是否显示通知
		if (showNotice) {
			if (result.status === 'success') {
				new Notice(`✅ ${result.message}`);
			} else {
				new Notice(`⚠️ ${result.message}`);
			}
		}

		return result;
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
	 * 打���插件设置页面的辅助方法
	 */
	openSettings() {
		const appInstance = this.app as AppWithSettings;
		appInstance.setting.open();
		appInstance.setting.openTabById(this.manifest.id);
	}

	/**
	 * 验证预设ID的唯一性（公共方法）
	 */
	validatePresetId(id: string): { isValid: boolean; error?: string } {
		// 检查是否为空
		if (!id || id.trim() === '') {
			return { isValid: false, error: '预设ID不能为空' };
		}

		const cleanId = id.trim();

		// 检查格式：只能包含字母、数字、连字符和下划线，且必须以字母开头
		const idRegex = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
		if (!idRegex.test(cleanId)) {
			return { isValid: false, error: '预设ID只能包含字母、数字、连字符和下划线，且必须以字母开头' };
		}

		// 检查长度
		if (cleanId.length < 2) {
			return { isValid: false, error: '预设ID长度至少为2个字符' };
		}

		if (cleanId.length > 50) {
			return { isValid: false, error: '预设ID长度不能超过50个字符' };
		}

		// 检查是否已存在
		const existingPreset = this.settings.frontmatterPresets.find(p => p.id === cleanId);
		if (existingPreset) {
			return { isValid: false, error: `预设ID "${cleanId}" 已存在，请使用其他ID` };
		}

		return { isValid: true };
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
	private searchInputEl: HTMLInputElement | null = null; // 搜索输入框引用，用于移除事件监听器

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
		const result = await this.plugin.reloadTemplates(false);

		// 更新内部模板数据
		this.templates = this.plugin.getTemplates();
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
			icon: '⏳',
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
		const result = await this.plugin.reloadTemplates(true);
		this.templates = this.plugin.getTemplates();
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
		const appInstance = this.app as AppWithSettings;
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

		// 检测模板是否引用了 Frontmatter 配置预设
		const templateFM = this.parseTemplateContent(template.content).frontmatter;
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
				new Notice(`⚠️ 引用的预设 "${configId}" 不存在，将使用默认插入方式`);
			}
		}

		// 插入模板（原有逻辑）
		this.insertTemplate(template);
	}

	/**
	 * 检测是否安装了 Templater 插件
	 */
	private getTemplaterPlugin(): TemplaterPlugin | undefined {
		// @ts-expect-error - 访问内部 API
		const templater = this.app.plugins.plugins['templater-obsidian'] as TemplaterPlugin | undefined;
		return templater;
	}

	/**
	 * 检查 Templater 插件是否已启用
	 */
	private isTemplaterEnabled(): boolean {
		// @ts-expect-error - 访问内部 API
		return this.app.plugins.enabledPlugins.has('templater-obsidian');
	}

	/**
	 * 调用 Templater 处理模板内容
	 */
	private async runTemplater(template: Template): Promise<string> {
		try {
			const templater = this.getTemplaterPlugin();

			if (templater && templater.templater) {
				// 使用 Templater 的 API 解析模板内容
				const abstractFile = this.app.vault.getAbstractFileByPath(template.path);

				// 检查是否是有效的 TFile 对象
				if (abstractFile && 'extension' in abstractFile && abstractFile.extension === 'md') {
					const templateFile = abstractFile;

					// 获取当前活动文件
					const activeFile = this.app.workspace.getActiveFile();

					if (!activeFile) {
						throw new Error('无法获取当前活动文件');
					}

					// 创建 RunningConfig 对象
					const config = {
						template_file: templateFile,
						target_file: activeFile,
						run_mode: TEMPLATER_DYNAMIC_MODE, // DynamicProcessor 模式：动态处理模板内容
						active_file: activeFile
					};

					// 调用 read_and_parse_template
					const parsedContent = await templater.templater.read_and_parse_template(config);
					return parsedContent;
				} else {
					throw new Error('无法获取有效的 TFile 对象');
				}
			} else {
				throw new Error('Templater API 不可用');
			}
		} catch (error) {
			console.warn('Fast Templater: Templater 处理失败', error);
			throw error;
		}
	}

	/**
	 * 解析模板内容，分离 frontmatter 和主体内容
	 */
	private parseTemplateContent(content: string): { frontmatter: Record<string, unknown>, body: string } {
		// 使用正则表达式匹配 frontmatter
		const frontmatterRegex = /^---\n([\s\S]+?)\n---/;
		const match = content.match(frontmatterRegex);

		if (match) {
			try {
				// 解析 frontmatter
				const frontmatterText = match[1];
				const frontmatter = (yaml.load(frontmatterText) || {}) as Record<string, unknown>;

				// 获取主体内容（移除 frontmatter）
				const body = content.replace(frontmatterRegex, '').trim();

				return { frontmatter, body };
			} catch (error) {
				console.warn('Fast Templater: Frontmatter 解析失败', error);
				// 如果解析失败，将整个内容作为主体
				return { frontmatter: {}, body: content };
			}
		} else {
			// 没有找到 frontmatter
			return { frontmatter: {}, body: content };
		}
	}

	/**
	 * 获取当前笔记的元数据信息
	 */
	private getNoteMetadata(): { frontmatter: Record<string, unknown>, position: Pos | null } {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			return { frontmatter: {}, position: null };
		}

		const fileCache = this.app.metadataCache.getFileCache(activeFile);
		if (!fileCache || !fileCache.frontmatter) {
			return { frontmatter: {}, position: null };
		}

		return {
			frontmatter: fileCache.frontmatter || {},
			position: (fileCache.frontmatterPosition as Pos) ?? null
		};
	}

	/**
	 * 合并两个 frontmatter 对象
	 */
	private mergeFrontmatters(noteFM: Record<string, unknown>, templateFM: Record<string, unknown>): Record<string, unknown> {
		const merged: Record<string, unknown> = { ...noteFM };

		// 遍历模板的 frontmatter
		for (const [key, templateValue] of Object.entries(templateFM)) {
			if (key === 'tags') {
				// 特殊处理 tags 字段：合并去重
				const noteTags = Array.isArray(merged[key]) ? merged[key] as unknown[] :
								 (merged[key] ? [merged[key]] : []);
				const templateTags = Array.isArray(templateValue) ? templateValue as unknown[] :
									(templateValue ? [templateValue] : []);

				// 合并并去重
				const allTags = [...noteTags, ...templateTags];
				merged[key] = [...new Set(allTags)];
			} else {
				// 其他字段：模板的值覆盖笔记的值
				merged[key] = templateValue;
			}
		}

		return merged;
	}

	/**
	 * 更新笔记的 frontmatter
	 */
	private updateNoteFrontmatter(editor: Editor, newFM: Record<string, unknown>, position: Pos | null): void {
		try {
			// 将新的 frontmatter 转换为 YAML 字符串
			const newYamlString = yaml.dump(newFM, {
				indent: 2,
				lineWidth: -1,
				noRefs: true,
				sortKeys: false
			});

			if (position && position.start && position.end) {
				// 如果笔记已有 frontmatter，替换它
				const startPos = { line: position.start.line, ch: 0 };
				const endPos = { line: position.end.line + 1, ch: 0 }; // +1 因为 end.line 是最后一行
				editor.replaceRange(`---\n${newYamlString}---\n\n`, startPos, endPos);
			} else {
				// 如果笔记没有 frontmatter，在文件开头插入
				const startPos = { line: 0, ch: 0 };
				editor.replaceRange(`---\n${newYamlString}---\n\n`, startPos);
			}
		} catch (error) {
			console.error('Fast Templater: 更新 frontmatter 失败', error);
			throw error;
		}
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
			new Notice('❌ 插入模板失败，请稍后重试。');
		}
	}

	/**
	 * 处理模板内容的通用方法
	 * 统一处理 Templater 集成，返回处理后的模板内容
	 * @param template 要处理的模板
	 * @returns 处理后的模板内容
	 */
	private async processTemplateContent(template: Template): Promise<{ content: string; usedTemplater: boolean; error?: string }> {
		let processedContent = template.content;
		let usedTemplater = false;
		let error: string | undefined;

		// 检查是否启用 Templater 集成
		if (this.plugin.settings.enableTemplaterIntegration && this.isTemplaterEnabled()) {
			try {
				processedContent = await this.runTemplater(template);
				usedTemplater = true;
			} catch (templaterError) {
				console.warn('Fast Templater: Templater 处理失败，使用原始模板内容', templaterError);
				error = 'Templater 处理失败，使用原始模板内容';
				// 保持原始内容，不改变 usedTemplater 状态
			}
		}

		return { content: processedContent, usedTemplater, error };
	}

	/**
	 * 使用智能 Frontmatter 合并功能插入模板
	 */
	private async insertTemplateWithFrontmatterMerge(template: Template, editor: Editor) {
		try {
			// 1. 统一处理模板内容（包括 Templater 集成）
			const { content: processedContent, usedTemplater, error } = await this.processTemplateContent(template);

			// 2. 如果有 Templater 处理错误，显示通知
			if (error) {
				new Notice(`⚠️ ${error}进行 frontmatter 合并`);
			}

			// 3. 解析处理后的内容，分离 frontmatter 和主体
			const { frontmatter: templateFM, body: templateBody } = this.parseTemplateContent(processedContent);

			// 4. 获取当前笔记的元数据
			const { frontmatter: noteFM, position: notePosition } = this.getNoteMetadata();

			// 5. 如果模板没有 frontmatter，直接插入处理后的内容
			if (Object.keys(templateFM).length === 0) {
				editor.replaceSelection(processedContent);
				const notice = `✅ 模板 "${template.name}" 已插入（模板无 frontmatter，直接插入）${usedTemplater ? '并使用 Templater 处理' : ''}。`;
				new Notice(notice);
				return;
			}

			// 6. 合并 frontmatter
			const mergedFM = this.mergeFrontmatters(noteFM, templateFM);

			// 7. 更新笔记的 frontmatter
			this.updateNoteFrontmatter(editor, mergedFM, notePosition);

			// 8. 插入模板主体内容到光标位置
			if (templateBody.trim()) {
				editor.replaceSelection(templateBody);
			}

			// 9. 成功通知
			const templaterInfo = usedTemplater ? '并使用 Templater 处理' : '';
			const mergeInfo = Object.keys(templateFM).length > 0
				? ` 已合并 ${Object.keys(templateFM).length} 个 frontmatter 字段`
				: '';
			new Notice(`✅ 模板 "${template.name}" 已插入${templaterInfo}${mergeInfo}。`);

		} catch (error) {
			console.error('Fast Templater: 智能 frontmatter 合并失败', error);
			// 如果智能合并失败，回退到普通插入
			new Notice('⚠️ Frontmatter 合并失败，回退到普通插入');
			editor.replaceSelection(template.content);
		}
	}

	/**
	 * 不使用智能 Frontmatter 合并功能插入模板（原有逻辑）
	 */
	private async insertTemplateWithoutFrontmatterMerge(template: Template, editor: Editor) {
		// 1. 统一处理模板内容（包括 Templater 集成）
		const { content: processedContent, usedTemplater, error } = await this.processTemplateContent(template);

		// 2. 插入处理后的内容
		editor.replaceSelection(processedContent);

		// 3. 根据处理结果显示相应的通知
		if (usedTemplater) {
			new Notice(`✅ 模板 "${template.name}" 已插入并使用 Templater 处理。`);
		} else if (this.plugin.settings.enableTemplaterIntegration && !this.isTemplaterEnabled()) {
			new Notice(`✅ 模板 "${template.name}" 已插入(未检测到 Templater 插件)。`);
		} else if (error) {
			new Notice(`✅ 模板 "${template.name}" 已插入(${error})。`);
		} else {
			new Notice(`✅ 模板 "${template.name}" 已插入。`);
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
		const closeBtn = contentEl.createEl('button', {
			text: '关闭',
			cls: 'mod-cta'
		});
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

class FastTemplaterSettingTab extends PluginSettingTab {
	plugin: FastTemplater;

	constructor(app: App, plugin: FastTemplater) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * 统一的状态UI渲染辅助函数
	 * 消除 renderTemplaterStatus 和 renderTemplateStatus 中的重复代码
	 * @param containerEl 容器元素
	 * @param config 状态配置
	 */
	private renderStatusBlock(containerEl: HTMLElement, config: {
		icon: string;
		title: string;
		items: Array<{
			label: string;
			content: string;
			type?: 'text' | 'code' | 'status';
			color?: string;
		}>;
		actions?: Array<{
			text: string;
			onClick: () => void;
			cls?: string;
		}>;
	}): HTMLElement {
		const statusEl = containerEl.createEl('div', { cls: 'setting-item-description' });

		// 创建状态内容容器
		const contentEl = statusEl.createEl('small');
		contentEl.createEl('span', { text: `${config.icon} ` });
		contentEl.createEl('strong', { text: `${config.title}：` });
		contentEl.createEl('br');

		// 渲染所有状态项
		config.items.forEach(item => {
			// 创建标签
			contentEl.createEl('span', { text: `• ${item.label}: ` });

			// 根据类型渲染内容
			let contentElement: HTMLElement;
			switch (item.type) {
				case 'code':
					contentElement = contentEl.createEl('code', { text: item.content });
					break;
				case 'status':
					contentElement = contentEl.createEl('span');
					contentElement.textContent = item.content;
					if (item.color) {
						(contentElement as HTMLElement).style.color = item.color;
					}
					break;
				default:
					contentElement = contentEl.createEl('span', { text: item.content });
			}

			contentEl.createEl('br');
		});

		// 渲染操作按钮
		if (config.actions && config.actions.length > 0) {
			config.actions.forEach(action => {
				const button = contentEl.createEl('button', {
					text: action.text,
					type: 'button',
					cls: action.cls || 'mod-cta'
				});
				button.onclick = action.onClick;
			});
		}

		return statusEl;
	}

	/**
	 * 计算 Templater 状态信息
	 */
	private getTemplaterStatusInfo(): { icon: string; text: string; color: string; details: string[] } {
		// @ts-expect-error - 访问内部 API
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

		return this.renderStatusBlock(containerEl, {
			icon: '🔌',
			title: 'Templater 状态',
			items: [
				{
					label: '状态',
					content: `${statusInfo.icon} ${statusInfo.text}`,
					type: 'status',
					color: statusInfo.color
				},
				...statusInfo.details.map(detail => ({
					label: '',
					content: detail,
					type: 'text' as const
				}))
			]
		});
	}

	/**
	 * 渲染模板状态显示元素
	 */
	private renderTemplateStatus(containerEl: HTMLElement): HTMLElement {
		const statusInfo = this.getTemplateStatusInfo();

		// 使用统一的状态块渲染函数
		const statusEl = this.renderStatusBlock(containerEl, {
			icon: '📋',
			title: '模板状态',
			items: [
				{
					label: '当前路径',
					content: statusInfo.folderPath,
					type: 'code'
				},
				{
					label: '状态',
					content: `${statusInfo.icon} ${statusInfo.text}`,
					type: 'status',
					color: statusInfo.color
				}
			],
			// 不在这里设置事件，在后面单独处理
			actions: statusInfo.showReloadButton ? [
				{
					text: '重新扫描模板',
					onClick: () => {}, // 占位，实际事件在下面设置
					cls: 'mod-cta'
				}
			] : undefined
		});

		// 单独设置按钮事件处理
		if (statusInfo.showReloadButton) {
			const reloadBtn = statusEl.querySelector('button') as HTMLButtonElement;
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

			// 调用插件的重新加载方法并启用通知
			await this.plugin.reloadTemplates(true);

			// 重新渲染状态显示
			const parentEl = statusEl.parentElement;
			if (parentEl) {
				const newStatusEl = this.renderTemplateStatus(parentEl);
				statusEl.replaceWith(newStatusEl);
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

		// 添加版本信息
		const versionInfo = containerEl.createEl('div', {cls: 'setting-item-description'});
		versionInfo.createEl('small', {text: '📋 Fast Templater v1.0.0 - 可视化模板插件，帮助您通过可视化界面插入模板片段。'});

		// 添加分隔线
		containerEl.createEl('hr', {cls: 'setting-item-hr'});

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
					// 立即获取输入框的当前值，确保验证的是最新的路径
					const currentPath = setting.getValue();
					const cleanPath = currentPath.trim().replace(/^\/+|\/+$/g, '');

					// 立即保存当前路径值到插件设置中，确保验证和保存的一致性
					if (cleanPath !== this.plugin.settings.templateFolderPath) {
						this.plugin.settings.templateFolderPath = cleanPath;
						await this.plugin.saveSettings();
					}

					// 验证保存后的路径
					const isValid = await this.plugin.validateTemplatePath(cleanPath);
					if (isValid) {
						new Notice(`✅ 路径 "${cleanPath}" 有效，已找到模板文件`);
					} else {
						new Notice(`⚠️ 路径 "${cleanPath}" 未找到模板文件`);
					}
				};

				return setting.onChange(async (value) => {
					// 清理路径，移除首尾空格和斜杠
					const cleanPath = value.trim().replace(/^\/+|\/+$/g, '');
					const oldPath = this.plugin.settings.templateFolderPath;
					this.plugin.settings.templateFolderPath = cleanPath;
					await this.plugin.saveSettings();

					// 提供用户反馈（只在路径确实发生变化时）
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

		// 智能 Frontmatter 合并设置
		new Setting(containerEl)
			.setName('启用智能 Frontmatter 合并')
			.setDesc('启用后，插入模板时会自动合并模板与笔记的 frontmatter。模板中的字段会覆盖笔记中的同名字段，tags 字段会智能合并去重。需要安装 js-yaml 库。')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableFrontmatterMerge)
				.onChange(async (value) => {
					this.plugin.settings.enableFrontmatterMerge = value;
					await this.plugin.saveSettings();
					new Notice(value ? '已启用智能 Frontmatter 合并' : '已禁用智能 Frontmatter 合并');
				})
			);

		// 初始显示模板状态
		this.renderTemplateStatus(containerEl);

		// 路径验证提示
		this.renderPathValidationHints(containerEl);

		// 添加分隔线
		containerEl.createEl('hr', {cls: 'setting-item-hr'});

		// Frontmatter 配置预设管理
		this.renderFrontmatterPresetsManager(containerEl);
	}

	/**
	 * 渲染 Frontmatter 配置预设管理界面
	 */
	private renderFrontmatterPresetsManager(containerEl: HTMLElement): void {
		containerEl.createEl('h3', {text: 'Frontmatter 配置预设'});

		// 添加预设管理说明
		const descEl = containerEl.createEl('div', {cls: 'setting-item-description'});
		descEl.createEl('small', {text: '创建和管理 Frontmatter 配置预设，为后续的字段配置做准备。每个预设包含一组可重用的 frontmatter 字段。'});

		// 添加新预设按钮
		const addButtonContainer = containerEl.createDiv('fast-templater-preset-actions');
		const addPresetButton = addButtonContainer.createEl('button', {
			text: '➕ 添加新预设',
			cls: 'mod-cta'
		});

		// 预设列表容器
		const presetsListContainer = containerEl.createDiv('fast-templater-presets-list');

		// 渲染预设列表
		this.renderPresetsList(presetsListContainer);

		// 添加新预设按钮事件
		addPresetButton.onclick = async () => {
			await this.addNewPreset(presetsListContainer);
		};
	}

	/**
	 * 渲染预设列表
	 */
	private renderPresetsList(containerEl: HTMLElement): void {
		containerEl.empty();

		const presets = this.plugin.settings.frontmatterPresets;

		if (presets.length === 0) {
			// 显示空状态提示
			const emptyEl = containerEl.createDiv('fast-templater-empty-presets');
			emptyEl.createEl('p', {
				text: '暂无配置预设，点击"添加新预设"开始创建。',
				cls: 'setting-item-description'
			});
			return;
		}

		// 渲染每个预设项
		presets.forEach((_preset, index) => {
			this.renderPresetItem(containerEl, _preset, index);
		});
	}

	/**
	 * 渲染单个预设项
	 */
	private renderPresetItem(containerEl: HTMLElement, preset: FrontmatterPreset, _index: number): void {
		const presetItem = containerEl.createDiv('fast-templater-preset-item');

		// 预设名称输入框
		const nameContainer = presetItem.createDiv('fast-templater-preset-name');
		const nameInput = nameContainer.createEl('input', {
			type: 'text',
			value: preset.name,
			cls: 'fast-templater-preset-name-input'
		});

		// 预设操作按钮容器
		const actionsContainer = presetItem.createDiv('fast-templater-preset-actions');

		// 配置字段按钮
		const configButton = actionsContainer.createEl('button', {
			text: '⚙️ 配置字段',
			cls: 'mod-cta'
		});

		// 删除按钮
		const deleteButton = actionsContainer.createEl('button', {
			text: '🗑️ 删除',
			cls: 'mod-warning'
		});

		// 预设信息显示
		const infoEl = presetItem.createDiv('fast-templater-preset-info');
		infoEl.createEl('small', {
			text: `ID: ${preset.id} | 字段数量: ${preset.fields.length}`,
			cls: 'setting-item-description'
		});

		// 名称输入框变化事件
		nameInput.addEventListener('change', async () => {
			const newName = nameInput.value.trim();
			if (newName && newName !== preset.name) {
				await this.renamePreset(preset.id, newName);
			} else if (!newName) {
				// 如果名称为空，恢复原名称
				nameInput.value = preset.name;
				new Notice('预设名称不能为空');
			}
		});

		// 配置字段按钮事件
		configButton.addEventListener('click', async () => {
			await this.openFieldConfigModal(preset, containerEl);
		});

		// 删除按钮事件
		deleteButton.addEventListener('click', async () => {
			await this.deletePreset(preset.id, containerEl);
		});
	}

	
	/**
	 * 添加新预设
	 */
	private async addNewPreset(containerEl: HTMLElement): Promise<void> {
		// 打开创建预设模态窗口
		new CreatePresetModal(this.app, this.plugin, containerEl).open();
	}

	/**
	 * 重命名预设
	 */
	private async renamePreset(presetId: string, newName: string): Promise<void> {
		try {
			const preset = this.plugin.settings.frontmatterPresets.find(p => p.id === presetId);
			if (preset) {
				preset.name = newName;
				await this.plugin.saveSettings();
				new Notice(`✅ 预设已重命名为: ${newName}`);
			}
		} catch (error) {
			console.error('Fast Templater: 重命名预设失败', error);
			new Notice('❌ 重命名预设失败');
		}
	}

	/**
	 * 删除预设
	 */
	private async deletePreset(presetId: string, containerEl: HTMLElement): Promise<void> {
		try {
			const presetIndex = this.plugin.settings.frontmatterPresets.findIndex(p => p.id === presetId);
			if (presetIndex !== -1) {
				const presetName = this.plugin.settings.frontmatterPresets[presetIndex].name;

				// 从数组中移除预设
				this.plugin.settings.frontmatterPresets.splice(presetIndex, 1);

				// 保存设置
				await this.plugin.saveSettings();

				// 重新渲染预设列表
				this.renderPresetsList(containerEl);

				new Notice(`✅ 已删除预设: ${presetName}`);
			}
		} catch (error) {
			console.error('Fast Templater: 删除预设失败', error);
			new Notice('❌ 删除预设失败');
		}
	}

	/**
	 * 打开字段配置模态窗口
	 */
	private async openFieldConfigModal(preset: FrontmatterPreset, parentContainerEl: HTMLElement): Promise<void> {
		new FieldConfigModal(this.app, this.plugin, preset, parentContainerEl).open();
	}
}

/**
 * 字段配置模态窗口类
 */
class FieldConfigModal extends Modal {
	private plugin: FastTemplater;
	private preset: FrontmatterPreset;
	private parentContainerEl: HTMLElement;
	private fields: FrontmatterField[];

	constructor(app: App, plugin: FastTemplater, preset: FrontmatterPreset, parentContainerEl: HTMLElement) {
		super(app);
		this.plugin = plugin;
		this.preset = preset;
		this.parentContainerEl = parentContainerEl;
		// 创建字段副本以避免直接修改原数据
		this.fields = preset.fields.map(field => ({ ...field }));
	}

	onOpen() {
		const { contentEl } = this;

		// 设置模态窗口大小
		this.modalEl.style.width = '90vw';
		this.modalEl.style.maxWidth = '800px';
		this.modalEl.style.height = '80vh';

		// 创建标题
		contentEl.createEl('h2', { text: `配置预设字段: ${this.preset.name}` });

		// 创建主容器
		const mainContainer = contentEl.createDiv('fast-templater-field-config-container');

		// 创建字段列表容器
		const fieldsContainer = mainContainer.createDiv('fast-templater-fields-list');

		// 渲染字段列表
		this.renderFieldsList(fieldsContainer);

		// 创建操作按钮容器
		const actionsContainer = mainContainer.createDiv('fast-templater-field-config-actions');

		// 添加字段按钮
		const addFieldBtn = actionsContainer.createEl('button', {
			text: '➕ 添加字段',
			cls: 'mod-cta'
		});
		addFieldBtn.onclick = () => this.addNewField(fieldsContainer);

		// 按钮分隔
		actionsContainer.createEl('span', { text: ' | ' });

		// 保存按钮
		const saveBtn = actionsContainer.createEl('button', {
			text: '💾 保存',
			cls: 'mod-cta'
		});
		saveBtn.onclick = () => this.saveAndClose();

		// 取消按钮
		const cancelBtn = actionsContainer.createEl('button', {
			text: '❌ 取消'
		});
		cancelBtn.onclick = () => this.close();
	}

	/**
	 * 渲染字段列表
	 */
	private renderFieldsList(containerEl: HTMLElement): void {
		containerEl.empty();

		if (this.fields.length === 0) {
			// 显示空状态
			const emptyEl = containerEl.createDiv('fast-templater-empty-fields');
			emptyEl.createEl('p', {
				text: '暂无字段，点击"添加字段"开始创建。',
				cls: 'setting-item-description'
			});
			return;
		}

		// 渲染每个字段
		this.fields.forEach((field, index) => {
			this.renderFieldItem(containerEl, field, index);
		});
	}

	/**
	 * 渲染单个字段项
	 */
	private renderFieldItem(containerEl: HTMLElement, field: FrontmatterField, index: number): void {
		const fieldItem = containerEl.createDiv('fast-templater-field-item');

		// 字段头部
		const headerEl = fieldItem.createDiv('fast-templater-field-header');

		// 字段标题
		headerEl.createEl('h4', { text: `字段 ${index + 1}` });

		// 删除字段按钮
		const deleteBtn = headerEl.createEl('button', {
			text: '🗑️ 删除',
			cls: 'mod-warning'
		});
		deleteBtn.onclick = () => this.removeField(index, containerEl);

		// 字段配置容器
		const configContainer = fieldItem.createDiv('fast-templater-field-config');

		// Key 输入框
		const keyContainer = configContainer.createDiv('fast-templater-field-row');
		keyContainer.createEl('label', { text: 'Frontmatter 键名: *' });
		const keyInput = keyContainer.createEl('input', {
			type: 'text',
			value: field.key,
			placeholder: '例如: status, category, priority'
		});
		keyInput.addEventListener('input', () => {
			field.key = keyInput.value.trim();
		});

		// Label 输入框
		const labelContainer = configContainer.createDiv('fast-templater-field-row');
		labelContainer.createEl('label', { text: '显示名称: *' });
		const labelInput = labelContainer.createEl('input', {
			type: 'text',
			value: field.label,
			placeholder: '例如: 状态, 分类, 优先级'
		});
		labelInput.addEventListener('input', () => {
			field.label = labelInput.value.trim();
		});

		// Type 选择框
		const typeContainer = configContainer.createDiv('fast-templater-field-row');
		typeContainer.createEl('label', { text: '字段类型: *' });
		const typeSelect = typeContainer.createEl('select');
		const types = ['text', 'select', 'date', 'multi-select'];
		types.forEach(type => {
			const option = typeSelect.createEl('option', {
				value: type,
				text: this.getTypeLabel(type)
			});
			if (type === field.type) {
				option.selected = true;
			}
		});
		typeSelect.addEventListener('change', () => {
			field.type = typeSelect.value as FrontmatterField['type'];
			// 如果类型不是 select 或 multi-select，清空 options
			if (field.type !== 'select' && field.type !== 'multi-select') {
				field.options = [];
			}
			// 重新渲染字段以显示/隐藏 options 配置
			this.renderFieldsList(containerEl);
		});

		// Default 输入框
		const defaultContainer = configContainer.createDiv('fast-templater-field-row');
		defaultContainer.createEl('label', { text: '默认值:' });
		const defaultInput = defaultContainer.createEl('input', {
			type: 'text',
			value: field.default,
			placeholder: '默认值或 Templater 宏（可选）'
		});
		defaultInput.addEventListener('input', () => {
			field.default = defaultInput.value;
		});

		// Options 配置（仅当类型为 select 或 multi-select 时显示）
		if (field.type === 'select' || field.type === 'multi-select') {
			const optionsContainer = configContainer.createDiv('fast-templater-field-row');
			optionsContainer.createEl('label', { text: '选项列表:' });

			const optionsListContainer = optionsContainer.createDiv('fast-templater-options-list');
			this.renderOptionsList(optionsListContainer, field, index);

			// 添加选项按钮
			const addOptionBtn = optionsContainer.createEl('button', {
				text: '➕ 添加选项',
				cls: 'mod-small'
			});
			addOptionBtn.onclick = () => this.addOption(field, optionsListContainer, index);
		}
	}

	/**
	 * 渲染选项列表
	 */
	private renderOptionsList(containerEl: HTMLElement, field: FrontmatterField, fieldIndex: number): void {
		containerEl.empty();

		if (!field.options || field.options.length === 0) {
			containerEl.createEl('small', {
				text: '暂无选项，点击"添加选项"添加。',
				cls: 'setting-item-description'
			});
			return;
		}

		field.options.forEach((option, optionIndex) => {
			const optionItem = containerEl.createDiv('fast-templater-option-item');

			const optionInput = optionItem.createEl('input', {
				type: 'text',
				value: option,
				placeholder: '选项值'
			});
			optionInput.addEventListener('input', () => {
				if (field.options) {
					field.options[optionIndex] = optionInput.value.trim();
				}
			});

			const removeOptionBtn = optionItem.createEl('button', {
				text: '🗑️',
				cls: 'mod-small mod-warning'
			});
			removeOptionBtn.onclick = () => this.removeOption(field, optionIndex, fieldIndex);
		});
	}

	/**
	 * 获取类型标签
	 */
	private getTypeLabel(type: string): string {
		const labels: Record<string, string> = {
			'text': '文本',
			'select': '单选',
			'date': '日期',
			'multi-select': '多选'
		};
		return labels[type] || type;
	}

	/**
	 * 添加新字段
	 */
	private addNewField(containerEl: HTMLElement): void {
		const newField: FrontmatterField = {
			key: '',
			type: 'text',
			label: '',
			default: '',
			options: []
		};
		this.fields.push(newField);
		this.renderFieldsList(containerEl);
	}

	/**
	 * 删除字段
	 */
	private removeField(index: number, containerEl: HTMLElement): void {
		this.fields.splice(index, 1);
		this.renderFieldsList(containerEl);
	}

	/**
	 * 添加选项
	 */
	private addOption(field: FrontmatterField, containerEl: HTMLElement, fieldIndex: number): void {
		if (!field.options) {
			field.options = [];
		}
		field.options.push('');
		this.renderOptionsList(containerEl, field, fieldIndex);
	}

	/**
	 * 删除选项
	 */
	private removeOption(field: FrontmatterField, optionIndex: number, _fieldIndex: number): void {
		if (field.options) {
			field.options.splice(optionIndex, 1);
		}
		// 重新渲染整个字段列表以更新选项显示
		const containerEl = this.contentEl.querySelector('.fast-templater-fields-list') as HTMLElement;
		if (containerEl) {
			this.renderFieldsList(containerEl);
		}
	}

	/**
	 * 验证字段数据
	 */
	private validateFields(): { isValid: boolean; errors: string[] } {
		const errors: string[] = [];

		this.fields.forEach((field, index) => {
			const fieldNum = index + 1;

			// 验证必填字段
			if (!field.key.trim()) {
				errors.push(`字段 ${fieldNum}: Frontmatter 键名不能为空`);
			}
			if (!field.label.trim()) {
				errors.push(`字段 ${fieldNum}: 显示名称不能为空`);
			}
			// 默认值现在可以为空，移除验证

			// 验证 key 格式
			const keyRegex = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
			if (field.key && !keyRegex.test(field.key)) {
				errors.push(`字段 ${fieldNum}: Frontmatter 键名格式不正确，只能包含字母、数字、下划线和连字符，且必须以字母或下划线开头`);
			}

			// 验证 select 和 multi-select 类型必须有选项
			if ((field.type === 'select' || field.type === 'multi-select') &&
				(!field.options || field.options.length === 0 || field.options.every(opt => !opt.trim()))) {
				errors.push(`字段 ${fieldNum}: ${field.type === 'select' ? '单选' : '多选'}类型必须至少有一个选项`);
			}
		});

		// 检查重复的 key
		const keys = this.fields.map(f => f.key).filter(k => k.trim());
		const duplicateKeys = keys.filter((key, index) => keys.indexOf(key) !== index);
		if (duplicateKeys.length > 0) {
			errors.push(`发现重复的 Frontmatter 键名: ${duplicateKeys.join(', ')}`);
		}

		return {
			isValid: errors.length === 0,
			errors
		};
	}

	/**
	 * 保存并关闭
	 */
	private async saveAndClose(): Promise<void> {
		// 验证字段数据
		const validation = this.validateFields();
		if (!validation.isValid) {
			new Notice(`❌ 验证失败:\n${validation.errors.join('\n')}`);
			return;
		}

		try {
			// 更新预设的字段
			const preset = this.plugin.settings.frontmatterPresets.find(p => p.id === this.preset.id);
			if (preset) {
				// 过滤掉空字段并保存（默认值现在可以为空）
				preset.fields = this.fields.filter(field =>
					field.key.trim() &&
					field.label.trim()
				);
			}

			// 保存设置
			await this.plugin.saveSettings();

			// 简单地重新渲染父容器
			this.renderParentPresetsList();

			new Notice('✅ 字段配置已保存');
			this.close();
		} catch (error) {
			console.error('Fast Templater: 保存字段配置失败', error);
			new Notice('❌ 保存字段配置失败');
		}
	}

	/**
	 * 重新渲染父容器的预设列表
	 */
	private renderParentPresetsList(): void {
		// 找到预设列表的祖先容器
		let currentEl = this.parentContainerEl;
		while (currentEl) {
			const presetsListContainer = currentEl.querySelector('.fast-templater-presets-list') as HTMLElement;
			if (presetsListContainer) {
				// 重新渲染预设列表
				presetsListContainer.empty();

				const presets = this.plugin.settings.frontmatterPresets;
				if (presets.length === 0) {
					const emptyEl = presetsListContainer.createDiv('fast-templater-empty-presets');
					emptyEl.createEl('p', {
						text: '暂无配置预设，点击"添加新预设"开始创建。',
						cls: 'setting-item-description'
					});
				} else {
					// 手动重新渲染每个预设项
					presets.forEach((_preset, index) => {
						this.renderPresetItem(presetsListContainer, _preset, index);
					});
				}
				return;
			}
			currentEl = currentEl.parentElement as HTMLElement;
		}
	}

	/**
	 * 手动渲染预设项（简化版本，用于重新渲染）
	 */
	private renderPresetItem(containerEl: HTMLElement, preset: FrontmatterPreset, _index: number): void {
		const presetItem = containerEl.createDiv('fast-templater-preset-item');

		// 预设名称输入框
		const nameContainer = presetItem.createDiv('fast-templater-preset-name');
		nameContainer.createEl('input', {
			type: 'text',
			value: preset.name,
			cls: 'fast-templater-preset-name-input'
		});

		// 预设操作按钮容器
		const actionsContainer = presetItem.createDiv('fast-templater-preset-actions');

		// 配置字段按钮
		const configButton = actionsContainer.createEl('button', {
			text: '⚙️ 配置字段',
			cls: 'mod-cta'
		});

		// 删除按钮（这里我们不需要事件监听器，只是显示）
		actionsContainer.createEl('button', {
			text: '🗑️ 删除',
			cls: 'mod-warning'
		});

		// 预设信息显示
		const infoEl = presetItem.createDiv('fast-templater-preset-info');
		infoEl.createEl('small', {
			text: `ID: ${preset.id} | 字段数量: ${preset.fields.length}`,
			cls: 'setting-item-description'
		});

		// 为配置字段按钮重新添加事件监听器
		configButton.addEventListener('click', async () => {
			// 创建新的字段配置模态窗口
			new FieldConfigModal(this.app, this.plugin, preset, containerEl).open();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * 创建预设模态窗口类
 */
class CreatePresetModal extends Modal {
	private plugin: FastTemplater;
	private parentContainerEl: HTMLElement;
	private idInput: HTMLInputElement;
	private nameInput: HTMLInputElement;
	private validationMessage: HTMLElement | null = null;
	private submitButton: HTMLButtonElement;

	constructor(app: App, plugin: FastTemplater, parentContainerEl: HTMLElement) {
		super(app);
		this.plugin = plugin;
		this.parentContainerEl = parentContainerEl;
	}

	onOpen() {
		const { contentEl } = this;

		// 设置模态窗口大小
		this.modalEl.style.width = '60vw';
		this.modalEl.style.maxWidth = '500px';
		this.modalEl.style.height = 'auto';

		// 创建标题
		contentEl.createEl('h2', { text: '创建新的预设配置' });

		// 创建说明文字
		const descEl = contentEl.createDiv('setting-item-description');
		descEl.createEl('small', {
			text: '预设配置用于管理模板中引用的 Frontmatter 字段。每个配置包含一组可重用的字段定义。'
		});

		// 创建表单容器
		const formContainer = contentEl.createDiv('fast-templater-create-preset-form');

		// 预设 ID 输入框
		const idContainer = formContainer.createDiv('fast-templater-form-group');
		idContainer.createEl('label', { text: '预设ID *' });
		idContainer.createEl('small', {
			text: '用于在模板中引用，建议使用英文字母和连字符，如 "project-template"'
		});
		this.idInput = idContainer.createEl('input', {
			type: 'text',
			placeholder: '例如: project-template',
			cls: 'fast-templater-form-input'
		});

		// 预设名称输入框
		const nameContainer = formContainer.createDiv('fast-templater-form-group');
		nameContainer.createEl('label', { text: '预设名称 *' });
		nameContainer.createEl('small', {
			text: '用于在设置界面中显示的友好名称'
		});
		this.nameInput = nameContainer.createEl('input', {
			type: 'text',
			placeholder: '例如: 项目模板配置',
			cls: 'fast-templater-form-input'
		});

		// 验证消息容器
		this.validationMessage = formContainer.createDiv('fast-templater-validation-message');

		// 操作按钮容器
		const actionsContainer = contentEl.createDiv('fast-templater-form-actions');

		// 取消按钮
		const cancelBtn = actionsContainer.createEl('button', {
			text: '❌ 取消',
			cls: ''
		});
		cancelBtn.onclick = () => this.close();

		// 按钮分隔
		actionsContainer.createEl('span', { text: ' | ' });

		// 创建按钮
		this.submitButton = actionsContainer.createEl('button', {
			text: '✅ 创建预设',
			cls: 'mod-cta'
		});
		this.submitButton.onclick = () => this.handleCreate();
		this.submitButton.disabled = true; // 初始禁用

		// 添加输入事件监听器
		this.idInput.addEventListener('input', this.handleInputChange);
		this.nameInput.addEventListener('input', this.handleInputChange);

		// 聚焦到ID输入框
		setTimeout(() => this.idInput.focus(), 100);
	}

	/**
	 * 处理输入变化事件
	 */
	private handleInputChange = () => {
		const idValue = this.idInput.value.trim();
		const nameValue = this.nameInput.value.trim();

		// 检查是否有值
		const hasValidInput = idValue && nameValue;

		// 验证ID格式
		let idValidation = { isValid: false };
		if (idValue) {
			idValidation = this.plugin.validatePresetId(idValue);
		}

		// 更新验证消息
		this.updateValidationMessage(nameValue, idValidation);

		// 启用/禁用创建按钮
		this.submitButton.disabled = !hasValidInput || !idValidation.isValid;
	}

	/**
	 * 更新验证消息显示
	 */
	private updateValidationMessage(nameValue: string, idValidation: { isValid: boolean; error?: string }) {
		if (!this.validationMessage) return;

		this.validationMessage.empty();

		// 检查名称
		if (!nameValue) {
			this.validationMessage.createEl('p', {
				text: '⚠️ 预设名称不能为空',
				cls: 'fast-templater-validation-error'
			});
		}

		// 检查ID
		if (nameValue && !idValidation.isValid) {
			this.validationMessage.createEl('p', {
				text: `⚠️ ${idValidation.error}`,
				cls: 'fast-templater-validation-error'
			});
		}

		// 显示成功消息
		if (nameValue && idValidation.isValid) {
			this.validationMessage.createEl('p', {
				text: '✅ 预设ID验证通过，可以创建配置',
				cls: 'fast-templater-validation-success'
			});
		}
	}

	/**
	 * 处理创建预设
	 */
	private async handleCreate(): Promise<void> {
		const idValue = this.idInput.value.trim();
		const nameValue = this.nameInput.value.trim();

		// 验证输入
		const idValidation = this.plugin.validatePresetId(idValue);
		if (!nameValue || !idValidation.isValid) {
			new Notice('❌ 请修正输入错误后再创建预设');
			return;
			}

		try {
			// 创建新的预设对象
			const newPreset: FrontmatterPreset = {
				id: idValue,
				name: nameValue,
				fields: [] // 初始为空字段数组
			};

			// 添加到设置中
			this.plugin.settings.frontmatterPresets.push(newPreset);

			// 保存设置
			await this.plugin.saveSettings();

			// 重新渲染预设列表
			const presetsListContainer = this.parentContainerEl.querySelector('.fast-templater-presets-list') as HTMLElement;
			if (presetsListContainer) {
				presetsListContainer.empty();
				const presets = this.plugin.settings.frontmatterPresets;
				if (presets.length === 0) {
					const emptyEl = presetsListContainer.createDiv('fast-templater-empty-presets');
					emptyEl.createEl('p', {
						text: '暂无配置预设，点击"添加新预设"开始创建。',
						cls: 'setting-item-description'
					});
				} else {
					// 重新渲染每个预设项
					presets.forEach((_preset, index) => {
						this.renderPresetItem(presetsListContainer, _preset, index);
					});
				}
			}

			new Notice(`✅ 已创建预设 "${nameValue}" (ID: ${idValue})`);
			this.close();

		} catch (error) {
			console.error('Fast Templater: 创建预设失败', error);
			new Notice('❌ 创建预设失败');
		}
	}

	/**
	 * 渲染单个预设项（简化版本）
	 */
	private renderPresetItem(containerEl: HTMLElement, preset: FrontmatterPreset, _index: number): void {
		const presetItem = containerEl.createDiv('fast-templater-preset-item');

		// 预设名称输入框
		const nameContainer = presetItem.createDiv('fast-templater-preset-name');
		const nameInput = nameContainer.createEl('input', {
			type: 'text',
			value: preset.name,
			cls: 'fast-templater-preset-name-input'
		});

		// 预设操作按钮容器
		const actionsContainer = presetItem.createDiv('fast-templater-preset-actions');

		// 配置字段按钮
		const configButton = actionsContainer.createEl('button', {
			text: '⚙️ 配置字段',
			cls: 'mod-cta'
		});

		// 删除按钮
		const deleteButton = actionsContainer.createEl('button', {
			text: '🗑️ 删除',
			cls: 'mod-warning'
		});

		// 预设信息显示
		const infoEl = presetItem.createDiv('fast-templater-preset-info');
		infoEl.createEl('small', {
			text: `ID: ${preset.id} | 字段数量: ${preset.fields.length}`,
			cls: 'setting-item-description'
		});

		// 名称输入框变化事件
		nameInput.addEventListener('change', async () => {
			const newName = nameInput.value.trim();
			if (newName && newName !== preset.name) {
				// 更新预设名称
				preset.name = newName;
				await this.plugin.saveSettings();
				new Notice(`✅ 预设已重命名为: ${newName}`);
			} else if (!newName) {
				// 如果名称为空，恢复原名称
				nameInput.value = preset.name;
				new Notice('预设名称不能为空');
			}
		});

		// 配置字段按钮事件
		configButton.addEventListener('click', async () => {
			// 创建新的字段配置模态窗口
			new FieldConfigModal(this.app, this.plugin, preset, this.parentContainerEl).open();
		});

		// 删除按钮事件
		deleteButton.addEventListener('click', async () => {
			try {
				const presetIndex = this.plugin.settings.frontmatterPresets.findIndex(p => p.id === preset.id);
				if (presetIndex !== -1) {
					const presetName = this.plugin.settings.frontmatterPresets[presetIndex].name;

					// 从数组中移除预设
					this.plugin.settings.frontmatterPresets.splice(presetIndex, 1);

					// 保存设置
					await this.plugin.saveSettings();

					// 重新渲染预设列表
					const presetsListContainer = this.parentContainerEl.querySelector('.fast-templater-presets-list') as HTMLElement;
					if (presetsListContainer) {
						presetsListContainer.empty();
						const presets = this.plugin.settings.frontmatterPresets;
						if (presets.length === 0) {
							const emptyEl = presetsListContainer.createDiv('fast-templater-empty-presets');
							emptyEl.createEl('p', {
								text: '暂无配置预设，点击"添加新预设"开始创建。',
								cls: 'setting-item-description'
							});
						} else {
							presets.forEach((_preset, index) => {
								this.renderPresetItem(presetsListContainer, _preset, index);
							});
						}
					}

					new Notice(`✅ 已删除预设: ${presetName}`);
				}
			} catch (error) {
				console.error('Fast Templater: 删除预设失败', error);
				new Notice('❌ 删除预设失败');
			}
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * Frontmatter 管理模态窗口类
 */
class FrontmatterManagerModal extends Modal {
	private plugin: FastTemplater;
	private template: Template;
	private preset: FrontmatterPreset;
	private formData: Record<string, unknown>;

	constructor(app: App, plugin: FastTemplater, template: Template, preset: FrontmatterPreset) {
		super(app);
		this.plugin = plugin;
		this.template = template;
		this.preset = preset;
		this.formData = {}; // 初始化表单数据
	}

	onOpen() {
		const { contentEl } = this;

		// 设置模态窗口大小
		this.modalEl.style.width = '85vw';
		this.modalEl.style.maxWidth = '700px';
		this.modalEl.style.height = '80vh';

		// 创建标题
		contentEl.createEl('h2', { text: `配置模板: ${this.template.name}` });

		// 创建主容器
		const mainContainer = contentEl.createDiv('fast-templater-frontmatter-manager-container');

		// 创建说明文字
		mainContainer.createEl('p', {
			text: `此模板引用了预设 "${this.preset.name}"，请填写以下字段：`,
			cls: 'setting-item-description'
		});

		// 创建表单容器
		const formContainer = mainContainer.createDiv('fast-templater-form-container');

		// 渲染表单字段
		this.renderFormFields(formContainer);

		// 创建操作按钮容器
		const actionsContainer = mainContainer.createDiv('fast-templater-form-actions');

		// 取消按钮
		const cancelBtn = actionsContainer.createEl('button', {
			text: '❌ 取消',
			cls: 'mod-cta'
		});
		cancelBtn.onclick = () => this.handleCancel();

		// 按钮分隔
		actionsContainer.createEl('span', { text: ' | ' });

		// 确认按钮（暂时禁用，等 Templater 解析完成后启用）
		const confirmBtn = actionsContainer.createEl('button', {
			text: '✅ 确认插入',
			cls: 'mod-cta'
		});
		confirmBtn.disabled = true;
		confirmBtn.onclick = () => this.handleConfirm();

		// 异步解析 Templater 默认值
		this.parseTemplaterDefaults().then(() => {
			confirmBtn.disabled = false;
		});
	}

	/**
	 * 渲染表单字段
	 */
	private renderFormFields(containerEl: HTMLElement): void {
		containerEl.empty();

		this.preset.fields.forEach((field) => {
			const fieldContainer = containerEl.createDiv('fast-templater-form-field');

			// 字段标签
			fieldContainer.createEl('label', {
				text: `${field.label}:`,
				cls: 'fast-templater-form-label'
			});

			// 字段输入控件
			let inputEl: HTMLInputElement | HTMLSelectElement | undefined;

			switch (field.type) {
				case 'text':
					inputEl = fieldContainer.createEl('input', {
						type: 'text',
						cls: 'fast-templater-form-input'
					}) as HTMLInputElement;
					break;

				case 'date':
					inputEl = fieldContainer.createEl('input', {
						type: 'date',
						cls: 'fast-templater-form-input'
					}) as HTMLInputElement;
					break;

				case 'select': {
					const selectEl = fieldContainer.createEl('select', {
						cls: 'fast-templater-form-select'
					}) as HTMLSelectElement;
					inputEl = selectEl;

					// 添加默认选项
					selectEl.createEl('option', {
						value: '',
						text: '请选择...'
					});

					// 添加预设选项
					if (field.options) {
						field.options.forEach(option => {
							selectEl.createEl('option', {
								value: option,
								text: option
							});
						});
					}
					break;
				}

				case 'multi-select': {
					// 多选框组
					const multiSelectContainer = fieldContainer.createDiv('fast-templater-multi-select-container');

					// 初始化多选字段的表单数据
					this.formData[field.key] = [];

					if (field.options && field.options.length > 0) {
						field.options.forEach(option => {
							const optionContainer = multiSelectContainer.createDiv('fast-templater-checkbox-container');

							const checkbox = optionContainer.createEl('input', {
								type: 'checkbox',
								value: option,
								cls: 'fast-templater-form-checkbox'
							}) as HTMLInputElement;

							// 添加 change 事件监听器来实时更新表单数据
							checkbox.addEventListener('change', () => {
								this.collectMultiSelectData();
							});

							// 如果选项是默认值，则预选中
							if (field.default === option) {
								checkbox.checked = true;
							}

							optionContainer.createEl('label', {
								text: option,
								cls: 'fast-templater-checkbox-label'
							});
						});
					} else {
						multiSelectContainer.createEl('small', {
							text: '暂无可用选项',
							cls: 'setting-item-description'
						});
					}
					break;
				}

				default:
					// 默认为文本输入
					inputEl = fieldContainer.createEl('input', {
						type: 'text',
						cls: 'fast-templater-form-input'
					}) as HTMLInputElement;
					break;
			}

			// 为有 inputEl 的字段类型添加事件监听器
			if (inputEl && (field.type === 'text' || field.type === 'date' || field.type === 'select')) {
				// 初始化表单数据
				this.formData[field.key] = field.default;

				// 设置初始值
				if (field.type === 'text' || field.type === 'date') {
					(inputEl as HTMLInputElement).value = field.default;
				} else if (field.type === 'select' && inputEl) {
					const selectEl = inputEl as HTMLSelectElement;
					const matchingOption = Array.from(selectEl.options).find(option => option.value === field.default);
					if (matchingOption) {
						selectEl.value = field.default;
					}
				}

				// 添加输入变化监听器
				inputEl.addEventListener('input', () => {
					this.formData[field.key] = field.type === 'select'
						? inputEl!.value
						: (inputEl as HTMLInputElement).value;
				});
			}
		});

		// 在所有字段渲染完成后，收集一次多选框数据以捕获默认选中的值
		setTimeout(() => {
			this.collectMultiSelectData();
		}, 0);
	}

	/**
	 * 解析 Templater 默认值
	 */
	private async parseTemplaterDefaults(): Promise<void> {
		try {
			// 创建一个临时的模板对象用于 Templater 解析
			const tempTemplate: Template = {
				id: 'temp-templater-parsing',
				name: 'Temp Templater Parsing',
				path: this.template.path,
				content: '' // 内容不重要，我们只需要 Templater 环境
			};

			// 解析每个字段的默认值
			for (const field of this.preset.fields) {
				if (field.default && field.default.includes('<%')) {
					try {
						// 检查 Templater 是否可用
						if (this.plugin.settings.enableTemplaterIntegration && this.isTemplaterEnabled()) {
							// 创建一个简单的模板内容用于解析宏
							const templateContent = field.default;
							tempTemplate.content = templateContent;

							// 调用 runTemplater 方法
							const parsedValue = await this.runTemplater(tempTemplate);
							field.default = parsedValue;

							// 更新表单数据
							this.formData[field.key] = parsedValue;
						}
					} catch (error) {
						console.warn(`Fast Templater: 字段 "${field.label}" 的默认值 Templater 解析失败`, error);
						// 显示警告通知
						new Notice(`⚠️ 字段 "${field.label}" 的默认值解析失败，显示原始宏内容`);
					}
				} else {
					// 不包含 Templater 宏，直接使用原始值
					this.formData[field.key] = field.default;
				}
			}

			// 重新渲染表单以更新默认值
			const formContainer = this.contentEl.querySelector('.fast-templater-form-container') as HTMLElement;
			if (formContainer) {
				this.renderFormFields(formContainer);
			}

		} catch (error) {
			console.error('Fast Templater: Templater 默认值解析过程失败', error);
			new Notice('⚠️ 默认值解析过程中出现错误，将显示原始值');
		}
	}

	
	/**
	 * 收集多选框数据
	 */
	private collectMultiSelectData(): void {
		this.preset.fields.forEach(field => {
			if (field.type === 'multi-select') {
				const fieldContainer = this.contentEl.querySelector('.fast-templater-form-container');
				if (!fieldContainer) return;

				// 找到当前字段的所有 checkbox
				const checkboxes = fieldContainer.querySelectorAll('input[type="checkbox"]') as unknown as NodeListOf<HTMLInputElement>;
				const selectedValues: string[] = [];

				checkboxes.forEach(checkbox => {
					if ((checkbox as HTMLInputElement).checked && (checkbox as HTMLInputElement).value) {
						selectedValues.push((checkbox as HTMLInputElement).value);
					}
				});

				this.formData[field.key] = selectedValues;
			}
		});
	}

	
	/**
	 * 解析模板内容，分离 frontmatter 和主体内容
	 */
	private parseTemplateContent(content: string): { frontmatter: Record<string, unknown>, body: string } {
		// 使用正则表达式匹配 frontmatter
		const frontmatterRegex = /^---\n([\s\S]+?)\n---/;
		const match = content.match(frontmatterRegex);

		if (match) {
			try {
				// 解析 frontmatter
				const frontmatterText = match[1];
				const frontmatter = (yaml.load(frontmatterText) || {}) as Record<string, unknown>;

				// 获取主体内容（移除 frontmatter）
				const body = content.replace(frontmatterRegex, '').trim();

				return { frontmatter, body };
			} catch (error) {
				console.warn('Fast Templater: Frontmatter 解析失败', error);
				// 如果解析失败，将整个内容作为主体
				return { frontmatter: {}, body: content };
			}
		} else {
			// 没有找到 frontmatter
			return { frontmatter: {}, body: content };
		}
	}

	/**
	 * 获取当前笔记的元数据信息
	 */
	private getNoteMetadata(): { frontmatter: Record<string, unknown>, position: Pos | null } {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			return { frontmatter: {}, position: null };
		}

		const fileCache = this.app.metadataCache.getFileCache(activeFile);
		if (!fileCache || !fileCache.frontmatter) {
			return { frontmatter: {}, position: null };
		}

		return {
			frontmatter: fileCache.frontmatter || {},
			position: (fileCache.frontmatterPosition as Pos) ?? null
		};
	}

	/**
	 * 合并两个 frontmatter 对象
	 */
	private mergeFrontmatters(noteFM: Record<string, unknown>, templateFM: Record<string, unknown>): Record<string, unknown> {
		const merged: Record<string, unknown> = { ...noteFM };

		// 遍历模板的 frontmatter
		for (const [key, templateValue] of Object.entries(templateFM)) {
			if (key === 'tags') {
				// 特殊处理 tags 字段：合并去重
				const noteTags = Array.isArray(merged[key]) ? merged[key] as unknown[] :
									(merged[key] ? [merged[key]] : []);
				const templateTags = Array.isArray(templateValue) ? templateValue as unknown[] :
									(templateValue ? [templateValue] : []);

				// 合并并去重
				const allTags = [...noteTags, ...templateTags];
				merged[key] = [...new Set(allTags)];
			} else {
				// 其他字段：模板的值覆盖笔记的值
				merged[key] = templateValue;
			}
		}

		return merged;
	}

	/**
	 * 更新笔记的 frontmatter
	 */
	private updateNoteFrontmatter(editor: Editor, newFM: Record<string, unknown>, position: Pos | null): void {
		try {
			// 将新的 frontmatter 转换为 YAML 字符串
			const newYamlString = yaml.dump(newFM, {
				indent: 2,
				lineWidth: -1,
				noRefs: true,
				sortKeys: false
			});

			if (position && position.start && position.end) {
				// 如果笔记已有 frontmatter，替换它
				const startPos = { line: position.start.line, ch: 0 };
				const endPos = { line: position.end.line + 1, ch: 0 }; // +1 因为 end.line 是最后一行
				editor.replaceRange(`---\n${newYamlString}---\n\n`, startPos, endPos);
			} else {
				// 如果笔记没有 frontmatter，在文件开头插入
				const startPos = { line: 0, ch: 0 };
				editor.replaceRange(`---\n${newYamlString}---\n\n`, startPos);
			}
		} catch (error) {
			console.error('Fast Templater: 更新 frontmatter 失败', error);
			throw error;
		}
	}

	/**
	 * 处理模板内容的通用方法
	 * 统一处理 Templater 集成，返回处理后的模板内容
	 * @param template 要处理的模板
	 * @returns 处理后的模板内容
	 */
	private async processTemplateContent(template: Template): Promise<{ content: string; usedTemplater: boolean; error?: string }> {
		let processedContent = template.content;
		let usedTemplater = false;
		let error: string | undefined;

		// 检查是否启用 Templater 集成
		if (this.plugin.settings.enableTemplaterIntegration && this.isTemplaterEnabled()) {
			try {
				processedContent = await this.runTemplater(template);
				usedTemplater = true;
			} catch (templaterError) {
				console.warn('Fast Templater: Templater 处理失败，使用原始模板内容', templaterError);
				error = 'Templater 处理失败，使用原始模板内容';
				// 保持原始内容，不改变 usedTemplater 状态
			}
		}

		return { content: processedContent, usedTemplater, error };
	}

	/**
	 * 调用 Templater 处理模板内容
	 */
	private async runTemplater(template: Template): Promise<string> {
		try {
			const templater = this.getTemplaterPlugin();

			if (templater && templater.templater) {
				// 使用 Templater 的 API 解析模板内容
				const abstractFile = this.app.vault.getAbstractFileByPath(template.path);

				// 检查是否是有效的 TFile 对象
				if (abstractFile && 'extension' in abstractFile && abstractFile.extension === 'md') {
					const templateFile = abstractFile;

					// 获取当前活动文件
					const activeFile = this.app.workspace.getActiveFile();

					if (!activeFile) {
						throw new Error('无法获取当前活动文件');
					}

					// 创建 RunningConfig 对象
					const config = {
						template_file: templateFile,
						target_file: activeFile,
						run_mode: TEMPLATER_DYNAMIC_MODE, // DynamicProcessor 模式：动态处理模板内容
						active_file: activeFile
					};

					// 调用 read_and_parse_template
					const parsedContent = await templater.templater.read_and_parse_template(config);
					return parsedContent;
				} else {
					throw new Error('无法获取有效的 TFile 对象');
				}
			} else {
				throw new Error('Templater API 不可用');
			}
		} catch (error) {
			console.warn('Fast Templater: Templater 处理失败', error);
			throw error;
		}
	}

	/**
	 * 检测是否安装了 Templater 插件
	 */
	private getTemplaterPlugin(): TemplaterPlugin | undefined {
		// @ts-expect-error - 访问内部 API
		const templater = this.app.plugins.plugins['templater-obsidian'] as TemplaterPlugin | undefined;
		return templater;
	}

	/**
	 * 检查 Templater 插件是否已启用
	 */
	private isTemplaterEnabled(): boolean {
		// @ts-expect-error - 访问内部 API
		return this.app.plugins.enabledPlugins.has('templater-obsidian');
	}

	/**
	 * 执行带有用户输入的模板插入 - 核心逻辑实现
	 */
	private async insertTemplateWithUserInput(userFrontmatter: Record<string, unknown>): Promise<void> {
		try {
			// 获取当前编辑器实例
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!activeView || !activeView.editor) {
				throw new Error('无法获取当前编辑器，请确保在 Markdown 文件中使用此功能');
			}

			const editor = activeView.editor;

			// Task 2: 处理模板内容
			const { content: processedContent, usedTemplater, error } = await this.processTemplateContent(this.template);

			// 如果有 Templater 处理错误，显示通知但不中断流程
			if (error) {
				new Notice(`⚠️ ${error}，将使用原始模板内容进行插入`);
			}

			// 解析处理后的模板内容
			const { frontmatter: templateFM, body: templateBody } = this.parseTemplateContent(processedContent);

			// Task 3: 执行四方智能合并
			const mergedFrontmatter = this.mergeFrontmatterWithUserInput(templateFM, userFrontmatter);

			// Task 4: 执行实际插入操作
			await this.performInsertOperation(editor, mergedFrontmatter, templateBody, usedTemplater);

		} catch (error) {
			console.error('Fast Templater: 模板插入失败', error);
			throw error; // 重新抛出错误以供上层处理
		}
	}

	/**
	 * 四方智能 Frontmatter 合并算法
	 * 优先级：用户输入 > 模板 Frontmatter > 现有笔记 Frontmatter > 预设默认值
	 */
	private mergeFrontmatterWithUserInput(
		templateFM: Record<string, unknown>,
		userFrontmatter: Record<string, unknown>
	): Record<string, unknown> {
		// 获取当前笔记的 Frontmatter
		const noteMetadata = this.getNoteMetadata();
		const noteFM = noteMetadata.frontmatter;

		// Subtask 2.1: 从预设配置中提取默认值
		const presetDefaults = this.extractPresetDefaults();

		// Subtask 2.2: 笔记 Frontmatter 覆盖预设默认值
		const noteOverridesPreset = this.mergeFrontmatters(presetDefaults, noteFM);

		// Subtask 2.3: 模板 Frontmatter 覆盖笔记结果
		const templateOverridesNote = this.mergeFrontmatters(noteOverridesPreset, templateFM);

		// Subtask 2.4: 用户输入具有最高优先级
		const finalResult = this.mergeFrontmatters(templateOverridesNote, userFrontmatter);

		// 过滤掉特殊的配置键
		delete finalResult['fast-templater-config'];

		return finalResult;
	}

	/**
	 * 从预设配置中提取默认值
	 */
	private extractPresetDefaults(): Record<string, unknown> {
		const defaults: Record<string, unknown> = {};

		this.preset.fields.forEach(field => {
			if (field.default && field.default.trim() !== '') {
				// 根据字段类型设置默认值
				switch (field.type) {
					case 'multi-select':
						// 多选字段的默认值处理为单个值（如果有的话）
						if (field.options && field.options.includes(field.default)) {
							defaults[field.key] = [field.default];
						}
						break;
					default:
						defaults[field.key] = field.default;
						break;
				}
			}
		});

		return defaults;
	}

	/**
	 * 执行实际的插入操作 - Task 3 实现
	 */
	private async performInsertOperation(
		editor: Editor,
		mergedFrontmatter: Record<string, unknown>,
		templateBody: string,
		usedTemplater: boolean
	): Promise<void> {
		try {
			// Subtask 3.3: 更新笔记的 Frontmatter
			const noteMetadata = this.getNoteMetadata();
			this.updateNoteFrontmatter(editor, mergedFrontmatter, noteMetadata.position);

			// Subtask 3.4: 插入模板主体内容到光标位置
			if (templateBody.trim()) {
				editor.replaceSelection(templateBody);
			}

			// Task 6: 提供成功反馈
			const mergeCount = Object.keys(mergedFrontmatter).length;
			const templaterInfo = usedTemplater ? '并使用 Templater 处理' : '';
			const mergeInfo = mergeCount > 0 ? `已合并 ${mergeCount} 个 frontmatter 字段` : '';

			let successMessage = `✅ 模板 "${this.template.name}" 已插入`;
			if (templaterInfo || mergeInfo) {
				successMessage += `（${templaterInfo}${templaterInfo && mergeInfo ? '，' : ''}${mergeInfo}）`;
			}
			successMessage += '。';

			new Notice(successMessage);

		} catch (error) {
			console.error('Fast Templater: 插入操作失败', error);
			// Task 4: 提供回退机制
			new Notice('⚠️ Frontmatter 更新失败，尝试仅插入模板内容');

			try {
				// 回退：只插入模板主体内容
				editor.replaceSelection(templateBody);
				new Notice(`✅ 已插入模板内容（Frontmatter 更新失败）`);
			} catch (fallbackError) {
				console.error('Fast Templater: 回退插入也失败', fallbackError);
				throw new Error('模板插入完全失败，请手动复制模板内容');
			}
		}
	}

	/**
	 * 处理取消按钮点击事件
	 */
	private handleCancel(): void {
		this.close();
	}

	/**
	 * 验证表单数据
	 */
	private validateFormData(): { isValid: boolean; errors: string[] } {
		const errors: string[] = [];

		this.preset.fields.forEach(field => {
			const value = this.formData[field.key];

			// 检查必填字段
			if (field.type !== 'multi-select') {
				if (!value || (typeof value === 'string' && value.trim() === '')) {
					errors.push(`字段 "${field.label}" 不能为空`);
				}
			} else {
				// 多选框至少需要选择一个选项
				if (!Array.isArray(value) || value.length === 0) {
					errors.push(`字段 "${field.label}" 至少需要选择一个选项`);
				}
			}

			// 日期格式验证
			if (field.type === 'date' && value) {
				const date = new Date(value as string);
				if (isNaN(date.getTime())) {
					errors.push(`字段 "${field.label}" 的日期格式无效`);
				}
			}
		});

		return {
			isValid: errors.length === 0,
			errors
		};
	}

	/**
	 * Subtask 1.3: 将表单数据转换为 Frontmatter 格式
	 */
	private convertFormDataToFrontmatter(): Record<string, unknown> {
		const frontmatter: Record<string, unknown> = {};

		this.preset.fields.forEach(field => {
			const value = this.formData[field.key];

			if (value !== undefined && value !== null && value !== '') {
				// 根据字段类型进行格式转换
				switch (field.type) {
					case 'date': {
						// 日期格式验证和标准化
						const date = new Date(value as string);
						if (!isNaN(date.getTime())) {
							// 格式化为 ISO 8601 字符串
							frontmatter[field.key] = date.toISOString().split('T')[0];
						} else {
							throw new Error(`字段 "${field.label}" 的日期格式无效`);
						}
						break;
					}

					case 'multi-select':
						// 多选框确保为数组类型
						if (Array.isArray(value) && value.length > 0) {
							frontmatter[field.key] = value;
						}
						break;

					case 'text':
					case 'select':
					default:
						// 文本和单选框直接存储
						if (typeof value === 'string') {
							const trimmedValue = value.trim();
							if (trimmedValue) {
								frontmatter[field.key] = trimmedValue;
							}
						} else {
							frontmatter[field.key] = value;
						}
						break;
				}
			}
		});

		return frontmatter;
	}

	/**
	 * 处理确认按钮点击事件 - 核心逻辑实现
	 * Task 1: 表单数据收集和预处理
	 * Task 2-6: 完整的模板插入流程
	 */
	private async handleConfirm(): Promise<void> {
		try {
			// Subtask 1.1 & 1.2: 收集并验证表单数据
			const validation = this.validateFormData();
			if (!validation.isValid) {
				new Notice(`❌ 表单验证失败:\n${validation.errors.join('\n')}`);
				return;
			}

			// Subtask 1.1: 收集多选框数据
			this.collectMultiSelectData();

			// Subtask 1.3: 转换表单数据为 Frontmatter 格式
			const userFrontmatter = this.convertFormDataToFrontmatter();

			// 执行完整的模板插入流程
			await this.insertTemplateWithUserInput(userFrontmatter);

			// Task 6.2: 操作完成后关闭模态窗口
			this.close();

		} catch (error) {
			console.error('Fast Templater: 处理确认操作失败', error);

			// Task 4: 错误处理机制
			const errorMessage = error instanceof Error ? error.message : '未知错误';
			new Notice(`❌ 插入模板失败: ${errorMessage}`);

			// Task 4.4: 用户友好的错误通知系统
			// 提供回退建议
			if (errorMessage.includes('编辑器')) {
				new Notice('💡 请确保在 Markdown 文件中使用此功能');
			} else if (errorMessage.includes('Templater')) {
				new Notice('💡 可以尝试禁用 Templater 集成后重试');
			}
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}