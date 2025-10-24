import { Plugin } from 'obsidian';
import { PresetManager } from '@presets';
import { SettingsManager } from '@settings';
import { TemplateManager } from '@templates';
import type { AppWithSettings, FastTemplaterSettings } from '@types';
import { SettingsFacade } from './SettingsFacade';
import { UiRegistrar } from './UiRegistrar';

export default class FastTemplater extends Plugin {
	settingsManager: SettingsManager;
	settings: FastTemplaterSettings;
	templateManager: TemplateManager;
	presetManager: PresetManager;
	updateStatusBar?: () => void;
	private settingsFacade!: SettingsFacade;

	async onload() {
		await this.initializeManagers();
		this.setupStatusBar();
		this.settingsFacade = new SettingsFacade(this.updateStatusBar, () => this.templateManager.loadTemplates());
		this.presetManager.setSaveOptionsFactory(() => this.settingsFacade.getDefaultSaveOptions());
		new UiRegistrar(this, this.settingsManager, this.presetManager).registerAll();
	}

	onunload() {}

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
}
