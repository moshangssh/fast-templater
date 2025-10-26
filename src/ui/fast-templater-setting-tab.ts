import { App, PluginSettingTab, Setting } from 'obsidian';
import type FastTemplater from '@core/plugin';
import { SettingsManager } from '@settings';
import { PresetManager } from '@presets';
import { ObsidianTemplaterAdapter } from '@engine';
import { DEFAULT_SETTINGS, type FastTemplaterSettings, type FrontmatterPreset } from '@types';
import { FieldConfigModal } from './field-config-modal';
import { CreatePresetModal } from './create-preset-modal';
import { renderPresetListUI } from './preset-item-ui';
import { withUiNotice, confirmAndDelete, renderStatusBlock } from './ui-utils';
import { notifyError, notifyInfo, notifySuccess, notifyWarning } from '@utils/notify';
import { withBusy } from '@utils/async-ui';

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
	 * 计算 Templater 状态信息
	 */
	private getTemplaterStatusInfo(): { icon: string; text: string; color: string; details: string[] } {
		const templater = new ObsidianTemplaterAdapter(this.app);
		const isTemplaterInstalled = templater.isAvailable();
		const isIntegrationEnabled = this.settings.enableTemplaterIntegration;

		let statusIcon = '';
		let statusText = 'Templater 未安装';
		let statusColor = 'var(--text-muted)';
		const details: string[] = [];

		if (isIntegrationEnabled && isTemplaterInstalled) {
			statusIcon = '';
			statusText = 'Templater 集成已启用';
			statusColor = 'var(--text-success)';
			details.push('模板中的 Templater 语法将自动执行');
		} else if (isIntegrationEnabled && !isTemplaterInstalled) {
			statusIcon = '';
			statusText = 'Templater 集成已启用,但未检测到 Templater 插件';
			statusColor = 'var(--text-warning)';
			details.push('请先在社区插件中安装 Templater 插件');
		} else if (!isIntegrationEnabled && isTemplaterInstalled) {
			statusIcon = '';
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

		let statusIcon = '';
		let statusText = '未知状态';
		let statusColor = 'var(--text-muted)';
		let showReloadButton = true;

		switch (status.status) {
			case 'loading':
				statusIcon = '';
				statusText = '加载中...';
				statusColor = 'var(--text-accent)';
				showReloadButton = false;
				break;
			case 'success':
				statusIcon = '';
				statusText = `成功加载 ${status.count} 个模板`;
				statusColor = 'var(--text-success)';
				break;
			case 'empty':
				statusIcon = '';
				statusText = '文件夹为空或未找到模板';
				statusColor = 'var(--text-muted)';
				break;
			case 'error':
				statusIcon = '';
				statusText = status.message || '加载失败';
				statusColor = 'var(--text-error)';
				break;
			case 'idle':
				statusIcon = '';
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

		return renderStatusBlock(containerEl, {
			icon: '',
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
		const statusEl = renderStatusBlock(containerEl, {
			icon: '',
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
			actions: statusInfo.showReloadButton ? [
				{
					text: '重新扫描模板',
					onClick: async () => {
						await this.plugin.templateManager.reloadTemplates(true);
						// 重新渲染状态显示
						const parentEl = statusEl.parentElement;
						if (parentEl) {
							const newStatusEl = this.renderTemplateStatus(parentEl);
							statusEl.replaceWith(newStatusEl);
						}
					},
					busyText: '扫描中…',
					cls: 'mod-cta'
				}
			] : undefined
		});

		return statusEl;
	}

	/**
	 * 渲染路径验证提示元素
	 */
	private renderPathValidationHints(containerEl: HTMLElement): HTMLElement {
		const hintEl = containerEl.createEl('div', { cls: 'setting-item-description' });
		const contentEl = hintEl.createEl('small');

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
		const { containerEl } = this;

		containerEl.empty();

		this.renderHeaderSection(containerEl);
		this.renderTemplateFolderSetting(containerEl);
		this.renderTemplaterIntegrationSection(containerEl);
		this.renderDefaultDateFormatSetting(containerEl);
		this.renderFrontmatterMergeSetting(containerEl);
		this.renderTemplateStatusSection(containerEl);
		this.renderPathValidationHints(containerEl);

		containerEl.createEl('hr', { cls: 'setting-item-hr' });
		this.renderFrontmatterPresetsManager(containerEl);
	}

	/**
	 * 渲染页头信息
	 */
	private renderHeaderSection(containerEl: HTMLElement): void {
		containerEl.createEl('h2', { text: 'Fast Templater 设置' });

		const versionInfo = containerEl.createEl('div', { cls: 'setting-item-description' });
		versionInfo.createEl('small', {
			text: 'Fast Templater v1.0.0 - 可视化模板插件，帮助您通过可视化界面插入模板片段。'
		});

		containerEl.createEl('hr', { cls: 'setting-item-hr' });
	}

	/**
	 * 渲染模板文件夹路径设置
	 */
	private renderTemplateFolderSetting(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName('模板文件夹路径')
			.setDesc('输入存放模板文件的文件夹路径，插件将在此路径下查找模板文件')
			.addText(text => {
				const setting = text
					.setPlaceholder('例如：Templates')
					.setValue(this.settings.templateFolderPath);

				const parentElement = text.inputEl.parentElement;
				if (!parentElement) {
					return;
				}

				const buttonContainer = parentElement.createDiv('mod-cta');
				const verifyButton = buttonContainer.createEl('button', {
					text: '验证路径',
					cls: 'mod-cta',
					type: 'button'
				});

				withBusy(
					verifyButton,
					async () => {
						const currentPath = setting.getValue();
						const cleanPath = currentPath.trim().replace(/^\/+|\/+$/g, '');

						if (cleanPath !== this.settings.templateFolderPath) {
							this.settings.templateFolderPath = cleanPath;
							await this.persistSettings();
						}

						const isValid = await this.plugin.templateManager.validateTemplatePath(cleanPath);
						if (isValid) {
							notifySuccess(`路径 "${cleanPath}" 有效，已找到模板文件`);
						} else {
							notifyWarning(`路径 "${cleanPath}" 未找到模板文件`);
						}
					},
					{
						busyText: '验证中…',
						linkedTargets: [text.inputEl],
						errorContext: 'SettingTab.verifyPath'
					}
				);

				return setting.onChange(async (value) => {
					const cleanPath = value.trim().replace(/^\/+|\/+$/g, '');
					const oldPath = this.settings.templateFolderPath;
					this.settings.templateFolderPath = cleanPath;
					await this.persistSettings();

					if (cleanPath && cleanPath !== oldPath) {
						notifySuccess(`模板路径已更新为: ${cleanPath}`);
					}
				});
			});
	}

	/**
	 * 渲染 Templater 集成配置及状态
	 */
	private renderTemplaterIntegrationSection(containerEl: HTMLElement): void {
		let templaterStatusEl: HTMLElement;
		new Setting(containerEl)
			.setName('启用 Templater 集成')
			.setDesc('启用后，插入模板时会自动调用 Templater 插件处理模板语法（如 <% tp.date.now() %>）。需要先安装 Templater 插件。')
			.addToggle(toggle => toggle
				.setValue(this.settings.enableTemplaterIntegration)
				.onChange(async (value) => {
					this.settings.enableTemplaterIntegration = value;
					await this.persistSettings();
					if (templaterStatusEl) {
						const newStatusEl = this.renderTemplaterStatus(containerEl);
						templaterStatusEl.replaceWith(newStatusEl);
						templaterStatusEl = newStatusEl;
					}
					notifyInfo(value ? '已启用 Templater 集成' : '已禁用 Templater 集成');
				})
			);

		templaterStatusEl = this.renderTemplaterStatus(containerEl);
	}

	/**
	 * 渲染默认日期格式设置
	 */
	private renderDefaultDateFormatSetting(containerEl: HTMLElement): void {
		const currentFormat = this.settings.defaultDateFormat || DEFAULT_SETTINGS.defaultDateFormat;

		new Setting(containerEl)
			.setName('默认日期格式')
			.setDesc('设置自动填充日期字段时使用的 Templater 日期格式，语法同 <% tp.date.now() %>。常用格式：YYYYMMDDHHmmss、YYYY-MM-DD、YYYY/MM/DD HH:mm')
			.addText(text => {
				text
					.setPlaceholder(DEFAULT_SETTINGS.defaultDateFormat)
					.setValue(currentFormat)
					.onChange(async (value) => {
						const trimmed = value.trim();
						const nextFormat = trimmed || DEFAULT_SETTINGS.defaultDateFormat;

						if (nextFormat === this.settings.defaultDateFormat) {
							return;
						}

						this.settings.defaultDateFormat = nextFormat;
						await this.persistSettings();
					});
			});
	}

	/**
	 * 渲染 Frontmatter 合并开关
	 */
	private renderFrontmatterMergeSetting(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName('启用智能 Frontmatter 合并')
			.setDesc('启用后，插入模板时会自动合并模板与笔记的 frontmatter。模板中的字段会覆盖笔记中的同名字段，tags 字段会智能合并去重。需要安装 js-yaml 库。')
			.addToggle(toggle => toggle
				.setValue(this.settings.enableFrontmatterMerge)
				.onChange(async (value) => {
					this.settings.enableFrontmatterMerge = value;
					await this.persistSettings();
					notifyInfo(value ? '已启用智能 Frontmatter 合并' : '已禁用智能 Frontmatter 合并');
				})
			);
	}

	/**
	 * 渲染模板状态信息
	 */
	private renderTemplateStatusSection(containerEl: HTMLElement): void {
		this.renderTemplateStatus(containerEl);
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
			text: '添加新预设',
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
		await withUiNotice(
			async () => await this.presetManager.renamePreset(presetId, newName),
			{
				success: (preset) => `预设已重命名为: ${preset.name}`,
				fail: '重命名预设失败'
			}
		);
	}

	/**
	 * 删除预设
	 */
	private async deletePreset(presetId: string): Promise<void> {
		const preset = this.presetManager.getPresetById(presetId);
		if (!preset) {
			notifyError(`未找到 ID 为 "${presetId}" 的预设`);
			return;
		}

		await confirmAndDelete(
			presetId,
			preset.name,
			async (id) => await this.presetManager.deletePreset(id),
			{
				success: `已删除预设: ${preset.name}`,
				fail: '删除预设失败'
			}
		);
	}

	/**
	 * 打开字段配置模态窗口
	 */
	private async openFieldConfigModal(preset: FrontmatterPreset, onPresetsChanged: () => void): Promise<void> {
		new FieldConfigModal(this.app, this.presetManager, this.settingsManager, preset, onPresetsChanged).open();
	}
}
