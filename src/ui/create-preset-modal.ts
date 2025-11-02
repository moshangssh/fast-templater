import { App, Modal } from 'obsidian';
import { PresetManager } from '@presets';
import { withUiNotice } from './ui-utils';
import { notifyError } from '@utils/notify';
export class CreatePresetModal extends Modal {
	private readonly presetManager: PresetManager;
	private nameInput: HTMLInputElement;
	private validationMessage: HTMLElement | null = null;
	private submitButton: HTMLButtonElement;
	private readonly onPresetsChanged?: () => void;

	constructor(
		app: App,
		presetManager: PresetManager,
		onPresetsChanged?: () => void,
	) {
		super(app);
		this.presetManager = presetManager;
		this.onPresetsChanged = onPresetsChanged;
	}

	onOpen() {
		const { contentEl } = this;

		// 设置模态窗口大小
		this.modalEl.style.width = '60vw';
		this.modalEl.style.maxWidth = '500px';
		this.modalEl.style.height = 'auto';

		// 创建标题
		contentEl.createEl('h2', { text: '创建新的预设配置' });

		// 创建说明文字
		const descEl = contentEl.createDiv('setting-item-description');
		descEl.createEl('small', {
			text: '预设配置用于管理模板中引用的 Frontmatter 字段。每个配置包含一组可重用的字段定义。'
		});

		// 创建表单容器
		const formContainer = contentEl.createDiv('note-architect-create-preset-form');

		// 预设名称输入框
		const nameContainer = formContainer.createDiv('note-architect-form-group');
		nameContainer.createEl('label', { text: '预设名称 *' });
		nameContainer.createEl('small', {
			text: '用于在设置界面中显示的友好名称，系统会基于此自动生成引用ID'
		});
		this.nameInput = nameContainer.createEl('input', {
			type: 'text',
			placeholder: '例如: 项目模板配置',
			cls: 'note-architect-form-input'
		});

		// 验证消息容器
		this.validationMessage = formContainer.createDiv('note-architect-validation-message');

		// 操作按钮容器
		const actionsContainer = contentEl.createDiv('note-architect-form-actions');

		// 取消按钮
		const cancelBtn = actionsContainer.createEl('button', {
			text: '❌ 取消',
			cls: ''
		});
		cancelBtn.onclick = () => this.close();

		// 按钮分隔
		actionsContainer.createEl('span', { text: ' | ' });

		// 创建按钮
		this.submitButton = actionsContainer.createEl('button', {
			text: '✅ 创建预设',
			cls: 'mod-cta'
		});
		this.submitButton.onclick = () => this.handleCreate();
		this.submitButton.disabled = true; // 初始禁用

		// 添加输入事件监听器
		this.nameInput.addEventListener('input', this.handleInputChange);

		// 聚焦到名称输入框
		setTimeout(() => this.nameInput.focus(), 100);
	}

	/**
	 * 处理输入变化事件
	 */
	private handleInputChange = () => {
		const nameValue = this.nameInput.value.trim();

		if (!nameValue) {
			this.updateValidationMessage('', null);
			this.submitButton.disabled = true;
			return;
		}

		const generatedId = this.presetManager.generateUniquePresetId(nameValue);

		// 更新验证消息
		this.updateValidationMessage(nameValue, generatedId);

		// 启用创建按钮
		this.submitButton.disabled = false;
	}

	/**
	 * 更新验证消息显示
	 */
	private updateValidationMessage(nameValue: string, generatedId: string | null) {
		if (!this.validationMessage) return;

		this.validationMessage.empty();

		// 检查名称
		if (!nameValue) {
			this.validationMessage.createEl('p', {
				text: '⚠️ 预设名称不能为空',
				cls: 'note-architect-validation-error'
			});
			return;
		}

		const message = this.validationMessage.createEl('p', {
			cls: 'note-architect-validation-success'
		});

		message.appendText('✅ 将自动生成引用ID：');

		if (generatedId) {
			message.createEl('code', { text: generatedId });
		} else {
			message.appendText('生成失败');
		}
	}

	/**
	 * 处理创建预设
	 */
	private async handleCreate(): Promise<void> {
		const nameValue = this.nameInput.value.trim();

		if (!nameValue) {
			notifyError('请修正输入错误后再创建预设');
			return;
		}

		// 使用 withUiNotice 工具函数简化创建流程
		await withUiNotice(
			async () => await this.presetManager.createPreset({ name: nameValue }),
			{
				success: (newPreset) => `✅ 已创建预设 "${nameValue}" (ID: ${newPreset.id})`,
				fail: '❌ 创建预设失败',
				onSuccess: () => {
					this.close();
					this.onPresetsChanged?.();
				}
			}
		);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
