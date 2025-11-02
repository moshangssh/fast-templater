import { Plugin } from 'obsidian';
import { PresetManager } from '@presets';
import { SettingsManager } from '@settings';
import { TemplateManager } from '@templates';
import type { AppWithSettings, NoteArchitectSettings } from '@types';
import { SettingsFacade } from './SettingsFacade';
import { UiRegistrar } from './UiRegistrar';

const MAX_RECENT_TEMPLATES = 5;

export default class NoteArchitect extends Plugin {
	settingsManager: SettingsManager;
	settings: NoteArchitectSettings;
	templateManager: TemplateManager;
	presetManager: PresetManager;
	updateStatusBar?: () => void;
	private settingsFacade!: SettingsFacade;

	async onload() {
		await this.initializeManagers();
		this.setupStatusBar();
		this.templateManager.startWatching();
		this.settingsFacade = new SettingsFacade(this.updateStatusBar, () => this.templateManager.loadTemplates());
		this.presetManager.setSaveOptionsFactory(() => this.settingsFacade.getDefaultSaveOptions());
		new UiRegistrar(this, this.settingsManager, this.presetManager).registerAll();
	}

	onunload() {
		this.templateManager?.dispose();
	}

	async loadSettings() {
		this.settings = await this.settingsManager.load();
	}

	async saveSettings() {
		this.settings = await this.settingsManager.save(this.settings, this.settingsFacade.getDefaultSaveOptions());
	}

	openSettings() {
		const appInstance = this.app as AppWithSettings;
		appInstance.setting.open();
		appInstance.setting.openTabById(this.manifest.id);
	}

	private async initializeManagers(): Promise<void> {
		this.settingsManager = new SettingsManager(this);
		this.settings = await this.settingsManager.load();
		this.templateManager = new TemplateManager(this.app, () => this.settings);
		await this.templateManager.loadTemplates();
		this.presetManager = new PresetManager(this.settingsManager);
	}

	private setupStatusBar(): void {
		const statusBarItemEl = this.addStatusBarItem();
		this.updateStatusBar = () => {
			statusBarItemEl.setText(`📁 ${this.settings.templateFolderPath || '未设置'}`);
		};
		this.updateStatusBar();
	}

	/**
	 * 将一个模板ID添加到最近使用列表的顶部。
	 * 此方法会处理去重、排序和长度限制。
	 * @param templateId 要记录的模板ID (即文件路径)
	 */
	async addRecentTemplate(templateId: string): Promise<void> {
		// 步骤1: 从现有列表中移除该ID，以处理重复情况
		const updatedList = this.settings.recentlyUsedTemplates.filter(id => id !== templateId);

		// 步骤2: 将该ID添加到列表的最前面
		updatedList.unshift(templateId);

		// 步骤3: 裁剪列表，确保其长度不超过预设的最大值
		this.settings.recentlyUsedTemplates = updatedList.slice(0, MAX_RECENT_TEMPLATES);

		// 步骤4: 持久化设置。这会调用 saveSettings，但我们只更新数据，
		// 不会触发模板重载等重量级操作。
		await this.saveData(this.settings);
	}
}
