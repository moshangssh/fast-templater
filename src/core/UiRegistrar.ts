import type { Plugin } from 'obsidian';
import type { PresetManager } from '@presets';
import type { SettingsManager } from '@settings';
import { FastTemplaterSettingTab, TemplateSelectorModal } from '@ui';

export class UiRegistrar {
	constructor(
		private readonly plugin: Plugin,
		private readonly settingsManager: SettingsManager,
		private readonly presetManager: PresetManager,
	) {}

	registerAll(): void {
		this.registerRibbon();
		this.registerCommands();
		this.registerSettingTab();
	}

	private registerRibbon(): void {
		const ribbonIconEl = this.plugin.addRibbonIcon('layout-template', '插入可视化模板', () => {
			new TemplateSelectorModal(this.plugin.app, this.plugin as any).open();
		});
		ribbonIconEl.addClass('fast-templater-ribbon-class');
	}

	private registerCommands(): void {
		this.plugin.addCommand({
			id: 'insert-template-placeholder',
			name: '插入模板占位符',
			icon: 'code',
			editorCallback: (editor) => {
				const selection = editor.getSelection();
				editor.replaceSelection(selection ? `{{${selection}}}` : '{{template-placeholder}}');
			},
		});

		this.plugin.addCommand({
			id: 'open-template-settings',
			name: '打开模板设置',
			icon: 'settings',
			checkCallback: (checking) => {
				const markdownView = this.plugin.app.workspace.getActiveViewOfType(require('obsidian').MarkdownView);
				if (!markdownView) return false;
				if (!checking) {
					const app = this.plugin.app as any;
					app.setting.open();
					app.setting.openTabById(this.plugin.manifest.id);
				}
				return true;
			},
		});

		this.plugin.addCommand({
			id: 'insert-visual-template',
			name: '插入可视化模板',
			icon: 'layout-template',
			callback: () => {
				new TemplateSelectorModal(this.plugin.app, this.plugin as any).open();
			},
		});
	}

	private registerSettingTab(): void {
		this.plugin.addSettingTab(
			new FastTemplaterSettingTab(this.plugin.app, this.plugin as any, this.settingsManager, this.presetManager)
		);
	}
}
