import { Editor, MarkdownView, Plugin } from 'obsidian';
import { PresetManager } from '@presets';
import { SaveSettingsOptions, SettingsManager } from '@settings';
import { TemplateManager } from '@templates';
import type { AppWithSettings, FastTemplaterSettings } from '@types';
import { FastTemplaterSettingTab, TemplateSelectorModal } from '@ui';

export default class FastTemplater extends Plugin {
	settingsManager: SettingsManager;
	settings: FastTemplaterSettings;
	templateManager: TemplateManager;
	presetManager: PresetManager;
	updateStatusBar?: () => void;

	async onload() {
		await this.initializeManagers();
		this.setupStatusBar();
		this.configurePresetManager();
		this.registerRibbon();
		this.registerCommands();
		this.registerSettingTab();
	}

	onunload() {}

	async loadSettings() {
		this.settings = await this.settingsManager.load();
	}

	async saveSettings() {
		this.settings = await this.settingsManager.save(this.settings, this.getDefaultSaveOptions());
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

	private configurePresetManager(): void {
		this.presetManager.setSaveOptionsFactory(() => this.getDefaultSaveOptions());
	}

	private registerRibbon(): void {
		const ribbonIconEl = this.addRibbonIcon('layout-template', '插入可视化模板', () => {
			new TemplateSelectorModal(this.app, this).open();
		});
		ribbonIconEl.addClass('fast-templater-ribbon-class');
	}

	private registerCommands(): void {
		this.addCommand({
			id: 'insert-template-placeholder',
			name: '插入模板占位符',
			icon: 'code',
			editorCallback: (editor: Editor) => {
				const selection = editor.getSelection();
				if (selection) {
					editor.replaceSelection(`{{${selection}}}`);
				} else {
					editor.replaceSelection('{{template-placeholder}}');
				}
			},
		});

		this.addCommand({
			id: 'open-template-settings',
			name: '打开模板设置',
			icon: 'settings',
			checkCallback: (checking: boolean) => {
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!markdownView) {
					return false;
				}

				if (!checking) {
					this.openSettings();
				}

				return true;
			},
		});

		this.addCommand({
			id: 'insert-visual-template',
			name: '插入可视化模板',
			icon: 'layout-template',
			callback: () => {
				new TemplateSelectorModal(this.app, this).open();
			},
		});
	}

	private registerSettingTab(): void {
		this.addSettingTab(new FastTemplaterSettingTab(this.app, this, this.settingsManager, this.presetManager));
	}

	private getDefaultSaveOptions(): SaveSettingsOptions {
		const options: SaveSettingsOptions = {};

		if (this.updateStatusBar) {
			options.onAfterSave = this.updateStatusBar;
		}

		if (this.templateManager) {
			options.reloadTemplates = () => this.templateManager.loadTemplates();
		}

		return options;
	}
}
