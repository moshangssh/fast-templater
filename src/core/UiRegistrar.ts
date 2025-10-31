import { MarkdownView, TFile } from 'obsidian';
import type { Plugin } from 'obsidian';
import type FastTemplater from '@core/plugin';
import type { PresetManager } from '@presets';
import type { SettingsManager } from '@settings';
import type { FrontmatterPreset, Template } from '@types';
import { FastTemplaterSettingTab, TemplatePresetBindingModal, TemplateSelectorModal } from '@ui';
import { handleError } from '@core/error';
import { parseFrontmatter, removeFrontmatterField, updateFrontmatter } from '@utils/frontmatter-editor';
import { notifyInfo, notifySuccess, notifyWarning } from '@utils/notify';

const CONFIG_KEY = 'fast-templater-config';

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
      new TemplateSelectorModal(this.plugin.app, this.getFastTemplater()).open();
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
        const markdownView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
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
        new TemplateSelectorModal(this.plugin.app, this.getFastTemplater()).open();
      },
    });

    this.plugin.addCommand({
      id: 'bind-template-to-preset',
      name: '将当前模板绑定到预设',
      icon: 'link',
      checkCallback: (checking) => this.handleBindCommand(checking),
    });
  }

  private registerSettingTab(): void {
    this.plugin.addSettingTab(
      new FastTemplaterSettingTab(this.plugin.app, this.getFastTemplater(), this.settingsManager, this.presetManager),
    );
  }

  private handleBindCommand(checking: boolean): boolean {
    const markdownView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    const file = markdownView?.file;
    if (!file || file.extension !== 'md') {
      return false;
    }

    const fastTemplater = this.getFastTemplater();
    const folderPath = fastTemplater.settings.templateFolderPath?.trim();
    if (!folderPath) {
      if (!checking) {
        notifyWarning('请先在 Fast Templater 设置中配置模板文件夹路径。');
      }
      return false;
    }

    if (!this.isInsideTemplateFolder(file, folderPath)) {
      if (!checking) {
        notifyWarning('当前文件不在模板文件夹内，请先将模板移动到指定目录。');
      }
      return false;
    }

    if (checking) {
      return true;
    }

    void this.openTemplatePresetBindingModal(file);
    return true;
  }

  private async openTemplatePresetBindingModal(file: TFile): Promise<void> {
    const presets = this.presetManager.getPresets();
    if (!presets || presets.length === 0) {
      notifyInfo('当前没有可用预设，请先在设置中创建至少一个预设。');
      return;
    }

    try {
      const content = await this.plugin.app.vault.read(file);
      const template: Template = {
        id: file.path,
        name: file.basename,
        path: file.path,
        content,
      };
      const parsed = parseFrontmatter(content);
      const existing = typeof parsed.frontmatter[CONFIG_KEY] === 'string'
        ? (parsed.frontmatter[CONFIG_KEY] as string)
        : undefined;

      new TemplatePresetBindingModal(this.plugin.app, {
        template,
        presets,
        existingPresetId: existing,
        onBind: async (preset) => await this.bindPresetToTemplate(file, preset),
        onClear: existing ? async () => await this.clearPresetBinding(file) : undefined,
      }).open();
    } catch (error) {
      handleError(error, {
        context: 'UiRegistrar.openTemplatePresetBindingModal',
        userMessage: '读取模板内容失败，无法绑定预设。',
      });
    }
  }

  private async bindPresetToTemplate(file: TFile, preset: FrontmatterPreset): Promise<void> {
    try {
      const vault = this.plugin.app.vault;
      const content = await vault.read(file);
      const parsed = parseFrontmatter(content);
      const currentId = typeof parsed.frontmatter[CONFIG_KEY] === 'string'
        ? (parsed.frontmatter[CONFIG_KEY] as string)
        : undefined;

      if (currentId === preset.id) {
        notifyInfo(`模板已绑定到预设 “${preset.name}”。`);
        return;
      }

      const result = updateFrontmatter(
        content,
        (frontmatter) => ({
          ...frontmatter,
          [CONFIG_KEY]: preset.id,
        }),
        parsed,
      );

      if (!result.changed) {
        notifyInfo(`模板已绑定到预设 “${preset.name}”。`);
        return;
      }

      await vault.modify(file, result.content);
      notifySuccess(`模板 “${file.basename}” 已绑定预设 “${preset.name}”。`);
      void this.getFastTemplater().templateManager.reloadTemplates();
    } catch (error) {
      handleError(error, {
        context: 'UiRegistrar.bindPresetToTemplate',
        userMessage: '绑定预设失败，请稍后重试。',
      });
      throw error;
    }
  }

  private async clearPresetBinding(file: TFile): Promise<void> {
    try {
      const vault = this.plugin.app.vault;
      const content = await vault.read(file);
      const parsed = parseFrontmatter(content);
      const hasBinding = typeof parsed.frontmatter[CONFIG_KEY] === 'string';

      if (!hasBinding) {
        notifyInfo('当前模板未绑定任何预设。');
        return;
      }

      const result = removeFrontmatterField(content, CONFIG_KEY, parsed);
      if (!result.changed) {
        notifyInfo('当前模板未绑定任何预设。');
        return;
      }

      await vault.modify(file, result.content);
      notifySuccess(`模板 “${file.basename}” 已解除预设绑定。`);
      void this.getFastTemplater().templateManager.reloadTemplates();
    } catch (error) {
      handleError(error, {
        context: 'UiRegistrar.clearPresetBinding',
        userMessage: '解除预设绑定失败，请稍后重试。',
      });
      throw error;
    }
  }

  private isInsideTemplateFolder(file: TFile, folderPath: string): boolean {
    const normalizedFolder = this.normalizePath(folderPath);
    if (!normalizedFolder) {
      return false;
    }

    const normalizedFilePath = this.normalizePath(file.path);
    return normalizedFilePath.startsWith(`${normalizedFolder}/`);
  }

  private normalizePath(path: string): string {
    return path.replace(/\\/g, '/').trim().replace(/^\/*|\/*$/g, '');
  }

  private getFastTemplater(): FastTemplater {
    return this.plugin as FastTemplater;
  }
}
