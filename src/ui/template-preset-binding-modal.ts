import { App, Modal, Setting, type ButtonComponent } from 'obsidian';
import type { FrontmatterPreset, Template } from '@types';
import { PresetMatcher, type PresetMatchResult } from '@utils/preset-matcher';

interface TemplatePresetBindingModalOptions {
  template: Template;
  presets: FrontmatterPreset[];
  existingPresetId?: string;
  onBind: (preset: FrontmatterPreset) => Promise<void>;
  onClear?: () => Promise<void>;
}

export class TemplatePresetBindingModal extends Modal {
  private readonly options: TemplatePresetBindingModalOptions;
  private readonly matchResults: PresetMatchResult[];
  private filteredResults: PresetMatchResult[];
  private listContainer!: HTMLElement;
  private searchQuery = '';
  private isBusy = false;

  constructor(app: App, options: TemplatePresetBindingModalOptions) {
    super(app);
    this.options = options;
    this.matchResults = PresetMatcher.matchPresets(options.template, options.presets);
    this.filteredResults = [...this.matchResults];
  }

  onOpen(): void {
    const { contentEl } = this;
    this.modalEl.style.width = '520px';
    this.modalEl.style.maxWidth = '90vw';

    contentEl.empty();
    contentEl.createEl('h2', { text: '将模板绑定到预设' });
    contentEl.createEl('p', { text: `模板：${this.options.template.name}` });
    contentEl.createEl('p', {
      text: `当前位置：${this.options.template.path}`,
      cls: 'fast-templater-binding-path',
    });

    if (this.options.existingPresetId) {
      contentEl.createEl('p', {
        text: `当前绑定：${this.options.existingPresetId}`,
        cls: 'fast-templater-binding-current',
      });
    }

    const searchSetting = new Setting(contentEl)
      .setName('搜索预设')
      .setDesc('输入预设名称或 ID 以快速筛选。');
    const searchInput = searchSetting.controlEl.createEl('input', {
      type: 'search',
      placeholder: '输入关键字…',
    });
    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value.trim().toLowerCase();
      this.applyFilters();
    });

    this.listContainer = contentEl.createDiv('fast-templater-binding-list');
    this.listContainer.style.maxHeight = '320px';
    this.listContainer.style.overflowY = 'auto';
    this.renderPresetList();

    if (this.options.onClear) {
      new Setting(contentEl)
        .setName('解除绑定')
        .setDesc('移除 fast-templater-config 字段，让模板恢复为未绑定状态。')
        .addButton((button) =>
          button
            .setButtonText('解除绑定')
            .onClick(() => this.handleClear(button)),
        );
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private applyFilters(): void {
    if (!this.searchQuery) {
      this.filteredResults = [...this.matchResults];
    } else {
      this.filteredResults = this.matchResults.filter(({ preset }) => {
        const haystack = [
          preset.name,
          preset.id,
          preset.description ?? '',
        ].join(' ').toLowerCase();
        return haystack.includes(this.searchQuery);
      });
    }
    this.renderPresetList();
  }

  private renderPresetList(): void {
    this.listContainer.empty();

    if (this.filteredResults.length === 0) {
      this.listContainer.createEl('p', {
        text: '未找到匹配的预设，请调整搜索条件。',
        cls: 'fast-templater-empty-state',
      });
      return;
    }

    for (const result of this.filteredResults) {
      const setting = new Setting(this.listContainer);
      setting.setName(result.preset.name);

      const nameEl = setting.nameEl;
      if (result.score >= 0.8) {
        nameEl.createSpan({ text: ' 🎯', cls: 'fast-templater-badge-strong' });
      } else if (result.score >= 0.5) {
        nameEl.createSpan({ text: ' ⭐', cls: 'fast-templater-badge-medium' });
      }

      if (result.preset.id === this.options.existingPresetId) {
        nameEl.createSpan({ text: '（当前绑定）', cls: 'fast-templater-badge-current' });
      }

      const descParts: string[] = [`ID: ${result.preset.id}`];
      if (result.preset.description) {
        descParts.push(result.preset.description);
      }
      if (result.score > 0) {
        descParts.push(`匹配度：${Math.round(result.score * 100)}%`);
      }
      setting.setDesc(descParts.join(' ｜ '));

      if (result.preset.id === this.options.existingPresetId) {
        setting.addButton((button) =>
          button
            .setButtonText('已绑定')
            .setDisabled(true),
        );
        continue;
      }

      setting.addButton((button) =>
        button
          .setButtonText('绑定')
          .setCta()
          .onClick(() => this.handleBind(result.preset, button)),
      );
    }
  }

  private async handleBind(preset: FrontmatterPreset, button: ButtonComponent): Promise<void> {
    if (this.isBusy) {
      return;
    }

    this.isBusy = true;
    const originalText = button.buttonEl.textContent ?? '绑定';
    button.setDisabled(true);
    button.setButtonText('处理中…');

    try {
      await this.options.onBind(preset);
      this.close();
    } catch {
      button.setDisabled(false);
      button.setButtonText(originalText);
    } finally {
      this.isBusy = false;
    }
  }

  private async handleClear(button: ButtonComponent): Promise<void> {
    if (this.isBusy || !this.options.onClear) {
      return;
    }

    this.isBusy = true;
    const originalText = button.buttonEl.textContent ?? '解除绑定';
    button.setDisabled(true);
    button.setButtonText('处理中…');

    try {
      await this.options.onClear();
      this.close();
    } catch {
      button.setDisabled(false);
      button.setButtonText(originalText);
    } finally {
      this.isBusy = false;
    }
  }
}
