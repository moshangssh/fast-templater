import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type FastTemplater from '@core/plugin';
import { SettingsManager } from '@settings';
import { PresetManager } from '@presets';
import { isTemplaterEnabled } from '@engine';
import type { FastTemplaterSettings, FrontmatterPreset } from '@types';
import { FieldConfigModal } from './field-config-modal';
import { CreatePresetModal } from './create-preset-modal';
import { renderPresetListUI } from './preset-item-ui';

export class FastTemplaterSettingTab extends PluginSettingTab {
	plugin: FastTemplater;
	private readonly settingsManager: SettingsManager;
	private readonly presetManager: PresetManager;

	constructor(app: App, plugin: FastTemplater, settingsManager: SettingsManager, presetManager: PresetManager) {
		super(app, plugin);
		this.plugin = plugin;
		this.settingsManager = settingsManager;
		this.presetManager = presetManager;
	}

	private get settings(): FastTemplaterSettings {
		return this.settingsManager.getSettings();
	}

	private async persistSettings(): Promise<void> {
		this.plugin.settings = await this.settingsManager.save(this.settings, {
			onAfterSave: this.plugin.updateStatusBar,
			reloadTemplates: () => this.plugin.templateManager.loadTemplates(),
		});
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
		const isTemplaterInstalled = isTemplaterEnabled(this.app);
		const isIntegrationEnabled = this.settings.enableTemplaterIntegration;

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
		const status = this.plugin.templateManager.getTemplateLoadStatus();
		const folderPath = this.settings.templateFolderPath || '未设置';

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
			await this.plugin.templateManager.reloadTemplates(true);

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
					.setValue(this.settings.templateFolderPath);

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
					if (cleanPath !== this.settings.templateFolderPath) {
						this.settings.templateFolderPath = cleanPath;
						await this.persistSettings();
					}

					// 验证保存后的路径
					const isValid = await this.plugin.templateManager.validateTemplatePath(cleanPath);
					if (isValid) {
						new Notice(`✅ 路径 "${cleanPath}" 有效，已找到模板文件`);
					} else {
						new Notice(`⚠️ 路径 "${cleanPath}" 未找到模板文件`);
					}
				};

				return setting.onChange(async (value) => {
					// 清理路径，移除首尾空格和斜杠
					const cleanPath = value.trim().replace(/^\/+|\/+$/g, '');
					const oldPath = this.settings.templateFolderPath;
					this.settings.templateFolderPath = cleanPath;
					await this.persistSettings();

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
				.setValue(this.settings.enableTemplaterIntegration)
				.onChange(async (value) => {
					this.settings.enableTemplaterIntegration = value;
					await this.persistSettings();
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
				.setValue(this.settings.enableFrontmatterMerge)
				.onChange(async (value) => {
					this.settings.enableFrontmatterMerge = value;
					await this.persistSettings();
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
		const refreshPresetsList = () => this.renderPresetsList(presetsListContainer);
		refreshPresetsList();

		// 添加新预设按钮事件
		addPresetButton.onclick = async () => {
			await this.addNewPreset(refreshPresetsList);
		};
	}

	/**
	 * 渲染预设列表
	 */
	private renderPresetsList(containerEl: HTMLElement): void {
		const refreshPresetsList = () => this.renderPresetsList(containerEl);

		renderPresetListUI({
			containerEl,
			presets: this.presetManager.getPresets(),
			callbacks: {
				onRename: async (preset, newName) => {
					await this.renamePreset(preset.id, newName);
					refreshPresetsList();
				},
				onConfigure: async (preset, context) => {
					await this.openFieldConfigModal(preset, refreshPresetsList);
				},
				onDelete: async (preset, context) => {
					await this.deletePreset(preset.id);
					refreshPresetsList();
				},
			},
		});
	}

	
	/**
	 * 添加新预设
	 */
	private async addNewPreset(onPresetsChanged: () => void): Promise<void> {
		// 打开创建预设模态窗口
		new CreatePresetModal(this.app, this.presetManager, onPresetsChanged).open();
	}

	/**
	 * 重命名预设
	 */
	private async renamePreset(presetId: string, newName: string): Promise<void> {
		try {
			const updatedPreset = await this.presetManager.renamePreset(presetId, newName);
			new Notice(`✅ 预设已重命名为: ${updatedPreset.name}`);
		} catch (error) {
			console.error('Fast Templater: 重命名预设失败', error);
			new Notice('❌ 重命名预设失败');
			throw error;
		}
	}

	/**
	 * 删除预设
	 */
	private async deletePreset(presetId: string): Promise<void> {
		try {
			const preset = this.presetManager.getPresetById(presetId);
			if (!preset) {
				throw new Error(`未找到 ID 为 "${presetId}" 的预设`);
			}

			await this.presetManager.deletePreset(presetId);

			new Notice(`✅ 已删除预设: ${preset.name}`);
		} catch (error) {
			console.error('Fast Templater: 删除预设失败', error);
			new Notice('❌ 删除预设失败');
		}
	}

	/**
	 * 打开字段配置模态窗口
	 */
	private async openFieldConfigModal(preset: FrontmatterPreset, onPresetsChanged: () => void): Promise<void> {
		new FieldConfigModal(this.app, this.presetManager, preset, onPresetsChanged).open();
	}
}
