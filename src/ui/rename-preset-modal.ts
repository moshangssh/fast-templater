import { Modal, Setting, TextComponent, type App } from 'obsidian';
import type { FrontmatterPreset } from '@types';
import type { PresetIdValidationResult } from '@presets';

interface RenamePresetModalOptions {
	preset: FrontmatterPreset;
	newName: string;
	suggestedId: string;
	validateId: (candidate: string, currentId: string) => PresetIdValidationResult;
}

export interface RenamePresetModalResult {
	mode: 'keep' | 'update';
	newId?: string;
}

export class RenamePresetModal extends Modal {
	private resolvePromise?: (result: RenamePresetModalResult | null) => void;
	private options: RenamePresetModalOptions;
	private mode: 'keep' | 'update' = 'keep';
	private newId: string;
	private errorEl!: HTMLElement;
	private idInput!: TextComponent;

	constructor(app: App, options: RenamePresetModalOptions) {
		super(app);
		this.options = options;
		this.newId = options.suggestedId;
	}

	async openAndWait(): Promise<RenamePresetModalResult | null> {
		return new Promise<RenamePresetModalResult | null>((resolve) => {
			this.resolvePromise = resolve;
			this.open();
		});
	}

	onOpen(): void {
		this.modalEl.addClass('note-architect-rename-preset-modal');
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: '更新预设名称' });

		const summaryEl = contentEl.createDiv('note-architect-rename-summary');
		summaryEl.createEl('p', {
			text: `当前名称：${this.options.preset.name}`,
		});
		summaryEl.createEl('p', {
			text: `新名称：${this.options.newName}`,
		});
		summaryEl.createEl('p', {
			text: `当前 ID：${this.options.preset.id}`,
		});

		const optionsWrap = contentEl.createDiv('note-architect-rename-options');

		const keepOption = optionsWrap.createEl('label', {
			cls: 'note-architect-rename-option',
		});
		const keepRadio = keepOption.createEl('input', {
			type: 'radio',
		}) as HTMLInputElement;
		keepRadio.name = 'preset-rename-mode';
		keepRadio.value = 'keep';
		keepRadio.checked = true;
		keepOption.createSpan({
			text: '仅更新名称（保留当前 ID，引用保持不变）',
			cls: 'note-architect-rename-option-title',
		});

		const updateOption = optionsWrap.createEl('label', {
			cls: 'note-architect-rename-option',
		});
		const updateRadio = updateOption.createEl('input', {
			type: 'radio',
		}) as HTMLInputElement;
		updateRadio.name = 'preset-rename-mode';
		updateRadio.value = 'update';
		updateOption.createSpan({
			text: '更新名称并生成新 ID（自动迁移所有引用）',
			cls: 'note-architect-rename-option-title',
		});

		const idSetting = new Setting(contentEl)
			.setName('新的预设 ID')
			.setDesc('将使用该 ID 更新所有模板引用。请保持唯一且易读。')
			.addText((text) => {
				this.idInput = text;
				text.setValue(this.newId);
				text.setDisabled(true);
				text.onChange((value) => {
					this.newId = value.trim();
					this.validateId();
				});
			});

		this.errorEl = idSetting.descEl.createDiv('note-architect-rename-error');

		const footer = contentEl.createDiv('modal-button-container');
		const cancelButton = footer.createEl('button', { text: '取消' });
		cancelButton.addEventListener('click', () => this.closeWith(null));

		const confirmButton = footer.createEl('button', {
			text: '保存',
			cls: 'mod-cta',
		});
		confirmButton.addEventListener('click', () => this.handleConfirm());

		keepRadio.addEventListener('change', () => {
			if (keepRadio.checked) {
				this.mode = 'keep';
				this.idInput.setDisabled(true);
				this.clearError();
			}
		});

		updateRadio.addEventListener('change', () => {
			if (updateRadio.checked) {
				this.mode = 'update';
				this.idInput.setDisabled(false);
				this.idInput.inputEl.focus();
				this.validateId();
			}
		});
	}

	onClose(): void {
		super.onClose();
		if (this.resolvePromise) {
			const resolver = this.resolvePromise;
			this.resolvePromise = undefined;
			resolver(null);
		}
	}

	private async handleConfirm(): Promise<void> {
		if (this.mode === 'update') {
			const validation = this.validateId();
			if (!validation) {
				return;
			}
		}

		this.closeWith({
			mode: this.mode,
			newId: this.mode === 'update' ? this.newId : undefined,
		});
	}

	private validateId(): boolean {
		if (this.mode !== 'update') {
			this.clearError();
			return true;
		}

		if (!this.newId) {
			this.showError('预设ID不能为空');
			return false;
		}

		const result = this.options.validateId(this.newId, this.options.preset.id);
		if (!result.isValid) {
			this.showError(result.error ?? '预设ID无效');
			return false;
		}

		this.clearError();
		return true;
	}

	private showError(message: string): void {
		this.errorEl.setText(message);
		this.errorEl.addClass('is-visible');
	}

	private clearError(): void {
		this.errorEl.empty();
		this.errorEl.removeClass('is-visible');
	}

	private closeWith(result: RenamePresetModalResult | null): void {
		const resolver = this.resolvePromise;
		this.resolvePromise = undefined;
		this.close();
		resolver?.(result);
	}
}
