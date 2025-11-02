import { App, Modal, Setting, type ButtonComponent } from 'obsidian';
import type { FrontmatterPreset, Template } from '@types';
import { PresetMatcher, type PresetMatchResult } from '@utils/preset-matcher';
import { runWithBusy } from '@utils/async-ui';

interface TemplatePresetBindingModalOptions {
  template: Template;
  presets: FrontmatterPreset[];
  existingIds?: string[];
  onBind: (preset: FrontmatterPreset) => Promise<void>;
  onClear?: () => Promise<void>;
}

export class TemplatePresetBindingModal extends Modal {
  private readonly options: TemplatePresetBindingModalOptions;
  private readonly matchResults: PresetMatchResult[];
  private filteredResults: PresetMatchResult[];
  private listContainer!: HTMLElement;
  private bindingInfoEl?: HTMLParagraphElement;
  private readonly boundIds: Set<string>;
  private clearButton?: ButtonComponent;
  private searchQuery = '';
  private isBusy = false;

  constructor(app: App, options: TemplatePresetBindingModalOptions) {
    super(app);
    const initialIds = Array.isArray(options.existingIds)
      ? Array.from(new Set(options.existingIds))
      : [];
    this.options = {
      ...options,
      existingIds: initialIds,
    };
    this.matchResults = PresetMatcher.matchPresets(options.template, options.presets);
    this.filteredResults = [...this.matchResults];
    this.boundIds = new Set(initialIds);
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
      cls: 'note-architect-binding-path',
    });

    this.bindingInfoEl = contentEl.createEl('p', {
      cls: 'note-architect-binding-current',
    });
    this.updateBindingInfo();

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

    this.listContainer = contentEl.createDiv('note-architect-binding-list');
    this.listContainer.style.maxHeight = '320px';
    this.listContainer.style.overflowY = 'auto';
    this.renderPresetList();

    if (this.options.onClear) {
      new Setting(contentEl)
        .setName('解除绑定')
        .setDesc('移除 note-architect-config 字段，让模板恢复为未绑定状态。')
        .addButton((button) => {
          this.clearButton = button;
          button
            .setButtonText('解除绑定')
            .onClick(() => this.handleClear(button));
          this.updateClearButtonState();
        });
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

  private renderPresetList(options: { preserveScroll?: boolean } = {}): void {
    const { preserveScroll = false } = options;
    const previousScrollTop = preserveScroll ? this.listContainer.scrollTop : 0;
    this.listContainer.empty();

    if (this.filteredResults.length === 0) {
      this.listContainer.createEl('p', {
        text: '未找到匹配的预设，请调整搜索条件。',
        cls: 'note-architect-empty-state',
      });
      return;
    }

    for (const result of this.filteredResults) {
      const setting = new Setting(this.listContainer);
      setting.setName(result.preset.name);

      const nameEl = setting.nameEl;
      if (result.score >= 0.8) {
        nameEl.createSpan({ text: ' 🎯', cls: 'note-architect-badge-strong' });
      } else if (result.score >= 0.5) {
        nameEl.createSpan({ text: ' ⭐', cls: 'note-architect-badge-medium' });
      }

      if (this.isPresetBound(result.preset.id)) {
        nameEl.createSpan({ text: '（已绑定）', cls: 'note-architect-badge-current' });
      }

      const descParts: string[] = [`ID: ${result.preset.id}`];
      if (result.preset.description) {
        descParts.push(result.preset.description);
      }
      if (result.score > 0) {
        descParts.push(`匹配度：${Math.round(result.score * 100)}%`);
      }
      setting.setDesc(descParts.join(' ｜ '));

      if (this.isPresetBound(result.preset.id)) {
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

    if (preserveScroll) {
      this.listContainer.scrollTop = previousScrollTop;
    } else {
      this.listContainer.scrollTop = 0;
    }
  }

  private async handleBind(preset: FrontmatterPreset, button: ButtonComponent): Promise<void> {
    if (this.isBusy || this.isPresetBound(preset.id)) {
      return;
    }

    this.isBusy = true;

    try {
      const result = await runWithBusy(
        button.buttonEl,
        async () => {
          await this.options.onBind(preset);
        },
        {
          busyText: '处理中…',
          errorContext: 'TemplatePresetBindingModal.handleBind',
        },
      );
      if (result !== null) {
        this.boundIds.add(preset.id);
        this.options.existingIds = Array.from(this.boundIds);
        this.updateBindingInfo();
        this.renderPresetList({ preserveScroll: true });
        this.updateClearButtonState();
      }
    } finally {
      this.isBusy = false;
    }
  }

  private async handleClear(button: ButtonComponent): Promise<void> {
    if (this.isBusy || !this.options.onClear) {
      return;
    }

    this.isBusy = true;

    try {
      const onClear = this.options.onClear;
      const result = await runWithBusy(
        button.buttonEl,
        async () => {
          await onClear();
        },
        {
          busyText: '处理中…',
          errorContext: 'TemplatePresetBindingModal.handleClear',
        },
      );
      if (result !== null) {
        this.boundIds.clear();
        this.options.existingIds = [];
        this.updateBindingInfo();
        this.renderPresetList({ preserveScroll: true });
        this.updateClearButtonState();
      }
    } finally {
      this.isBusy = false;
    }
  }

  private isPresetBound(presetId: string): boolean {
    return this.boundIds.has(presetId);
  }

  private updateBindingInfo(): void {
    if (!this.bindingInfoEl) {
      return;
    }

    if (this.boundIds.size === 0) {
      this.bindingInfoEl.textContent = '';
      this.bindingInfoEl.style.display = 'none';
    } else {
      this.bindingInfoEl.style.display = '';
      const ids = Array.from(this.boundIds);
      this.bindingInfoEl.textContent = `当前绑定：${ids.join('、')}`;
    }
  }

  private updateClearButtonState(): void {
    if (!this.clearButton) {
      return;
    }
    this.clearButton.setDisabled(this.boundIds.size === 0);
  }
}
