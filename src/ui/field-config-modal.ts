import { App, Modal, Notice } from 'obsidian';
import type { FrontmatterField, FrontmatterPreset } from '@types';
import { PresetManager } from '@presets';

export class FieldConfigModal extends Modal {
	private readonly presetManager: PresetManager;
	private preset: FrontmatterPreset;
	private fields: FrontmatterField[];
	private readonly onPresetsChanged?: () => void;

	constructor(
		app: App,
		presetManager: PresetManager,
		preset: FrontmatterPreset,
		onPresetsChanged?: () => void,
	) {
		super(app);
		this.presetManager = presetManager;
		this.preset = preset;
		this.onPresetsChanged = onPresetsChanged;
		// 创建字段副本以避免直接修改原数据
		this.fields = preset.fields.map(field => ({ ...field }));
	}

	onOpen() {
		const { contentEl } = this;

		// 设置模态窗口大小
		this.modalEl.style.width = '90vw';
		this.modalEl.style.maxWidth = '800px';
		this.modalEl.style.height = '80vh';

		// 创建标题
		contentEl.createEl('h2', { text: `配置预设字段: ${this.preset.name}` });

		// 创建主容器
		const mainContainer = contentEl.createDiv('fast-templater-field-config-container');

		// 创建字段列表容器
		const fieldsContainer = mainContainer.createDiv('fast-templater-fields-list');

		// 渲染字段列表
		this.renderFieldsList(fieldsContainer);

		// 创建操作按钮容器
		const actionsContainer = mainContainer.createDiv('fast-templater-field-config-actions');

		// 添加字段按钮
		const addFieldBtn = actionsContainer.createEl('button', {
			text: '➕ 添加字段',
			cls: 'mod-cta'
		});
		addFieldBtn.onclick = () => this.addNewField(fieldsContainer);

		// 按钮分隔
		actionsContainer.createEl('span', { text: ' | ' });

		// 保存按钮
		const saveBtn = actionsContainer.createEl('button', {
			text: '💾 保存',
			cls: 'mod-cta'
		});
		saveBtn.onclick = () => this.saveAndClose();

		// 取消按钮
		const cancelBtn = actionsContainer.createEl('button', {
			text: '❌ 取消'
		});
		cancelBtn.onclick = () => this.close();
	}

	/**
	 * 渲染字段列表
	 */
	private renderFieldsList(containerEl: HTMLElement): void {
		containerEl.empty();

		if (this.fields.length === 0) {
			// 显示空状态
			const emptyEl = containerEl.createDiv('fast-templater-empty-fields');
			emptyEl.createEl('p', {
				text: '暂无字段，点击"添加字段"开始创建。',
				cls: 'setting-item-description'
			});
			return;
		}

		// 渲染每个字段
		this.fields.forEach((field, index) => {
			this.renderFieldItem(containerEl, field, index);
		});
	}

	/**
	 * 渲染单个字段项
	 */
	private renderFieldItem(containerEl: HTMLElement, field: FrontmatterField, index: number): void {
		const fieldItem = containerEl.createDiv('fast-templater-field-item');

		// 字段头部
		const headerEl = fieldItem.createDiv('fast-templater-field-header');

		// 字段标题
		headerEl.createEl('h4', { text: `字段 ${index + 1}` });

		// 删除字段按钮
		const deleteBtn = headerEl.createEl('button', {
			text: '🗑️ 删除',
			cls: 'mod-warning'
		});
		deleteBtn.onclick = () => this.removeField(index, containerEl);

		// 字段配置容器
		const configContainer = fieldItem.createDiv('fast-templater-field-config');

		// Key 输入框
		const keyContainer = configContainer.createDiv('fast-templater-field-row');
		keyContainer.createEl('label', { text: 'Frontmatter 键名: *' });
		const keyInput = keyContainer.createEl('input', {
			type: 'text',
			value: field.key,
			placeholder: '例如: status, category, priority'
		});
		keyInput.addEventListener('input', () => {
			field.key = keyInput.value.trim();
		});

		// Label 输入框
		const labelContainer = configContainer.createDiv('fast-templater-field-row');
		labelContainer.createEl('label', { text: '显示名称: *' });
		const labelInput = labelContainer.createEl('input', {
			type: 'text',
			value: field.label,
			placeholder: '例如: 状态, 分类, 优先级'
		});
		labelInput.addEventListener('input', () => {
			field.label = labelInput.value.trim();
		});

		// Type 选择框
		const typeContainer = configContainer.createDiv('fast-templater-field-row');
		typeContainer.createEl('label', { text: '字段类型: *' });
		const typeSelect = typeContainer.createEl('select');
		const types = ['text', 'select', 'date', 'multi-select'];
		types.forEach(type => {
			const option = typeSelect.createEl('option', {
				value: type,
				text: this.getTypeLabel(type)
			});
			if (type === field.type) {
				option.selected = true;
			}
		});
		typeSelect.addEventListener('change', () => {
			field.type = typeSelect.value as FrontmatterField['type'];
			// 如果类型不是 select 或 multi-select，清空 options
			if (field.type !== 'select' && field.type !== 'multi-select') {
				field.options = [];
			}
			// 重新渲染字段以显示/隐藏 options 配置
			this.renderFieldsList(containerEl);
		});

		// Default 输入框
		const defaultContainer = configContainer.createDiv('fast-templater-field-row');
		defaultContainer.createEl('label', { text: '默认值:' });
		const defaultInput = defaultContainer.createEl('input', {
			type: 'text',
			value: field.default,
			placeholder: '默认值或 Templater 宏（可选）'
		});
		defaultInput.addEventListener('input', () => {
			field.default = defaultInput.value;
		});

		// Options 配置（仅当类型为 select 或 multi-select 时显示）
		if (field.type === 'select' || field.type === 'multi-select') {
			const optionsContainer = configContainer.createDiv('fast-templater-field-row');
			optionsContainer.createEl('label', { text: '选项列表:' });

			const optionsListContainer = optionsContainer.createDiv('fast-templater-options-list');
			this.renderOptionsList(optionsListContainer, field, index);

			// 添加选项按钮
			const addOptionBtn = optionsContainer.createEl('button', {
				text: '➕ 添加选项',
				cls: 'mod-small'
			});
			addOptionBtn.onclick = () => this.addOption(field, optionsListContainer, index);
		}
	}

	/**
	 * 渲染选项列表
	 */
	private renderOptionsList(containerEl: HTMLElement, field: FrontmatterField, fieldIndex: number): void {
		containerEl.empty();

		if (!field.options || field.options.length === 0) {
			containerEl.createEl('small', {
				text: '暂无选项，点击"添加选项"添加。',
				cls: 'setting-item-description'
			});
			return;
		}

		field.options.forEach((option, optionIndex) => {
			const optionItem = containerEl.createDiv('fast-templater-option-item');

			const optionInput = optionItem.createEl('input', {
				type: 'text',
				value: option,
				placeholder: '选项值'
			});
			optionInput.addEventListener('input', () => {
				if (field.options) {
					field.options[optionIndex] = optionInput.value.trim();
				}
			});

			const removeOptionBtn = optionItem.createEl('button', {
				text: '🗑️',
				cls: 'mod-small mod-warning'
			});
			removeOptionBtn.onclick = () => this.removeOption(field, optionIndex, fieldIndex);
		});
	}

	/**
	 * 获取类型标签
	 */
	private getTypeLabel(type: string): string {
		const labels: Record<string, string> = {
			'text': '文本',
			'select': '单选',
			'date': '日期',
			'multi-select': '多选'
		};
		return labels[type] || type;
	}

	/**
	 * 添加新字段
	 */
	private addNewField(containerEl: HTMLElement): void {
		const newField: FrontmatterField = {
			key: '',
			type: 'text',
			label: '',
			default: '',
			options: []
		};
		this.fields.push(newField);
		this.renderFieldsList(containerEl);
	}

	/**
	 * 删除字段
	 */
	private removeField(index: number, containerEl: HTMLElement): void {
		this.fields.splice(index, 1);
		this.renderFieldsList(containerEl);
	}

	/**
	 * 添加选项
	 */
	private addOption(field: FrontmatterField, containerEl: HTMLElement, fieldIndex: number): void {
		if (!field.options) {
			field.options = [];
		}
		field.options.push('');
		this.renderOptionsList(containerEl, field, fieldIndex);
	}

	/**
	 * 删除选项
	 */
	private removeOption(field: FrontmatterField, optionIndex: number, _fieldIndex: number): void {
		if (field.options) {
			field.options.splice(optionIndex, 1);
		}
		// 重新渲染整个字段列表以更新选项显示
		const containerEl = this.contentEl.querySelector('.fast-templater-fields-list') as HTMLElement;
		if (containerEl) {
			this.renderFieldsList(containerEl);
		}
	}

	/**
	 * 验证字段数据
	 */
	private validateFields(): { isValid: boolean; errors: string[] } {
		const errors: string[] = [];

		this.fields.forEach((field, index) => {
			const fieldNum = index + 1;

			// 验证必填字段
			if (!field.key.trim()) {
				errors.push(`字段 ${fieldNum}: Frontmatter 键名不能为空`);
			}
			if (!field.label.trim()) {
				errors.push(`字段 ${fieldNum}: 显示名称不能为空`);
			}
			// 默认值现在可以为空，移除验证

			// 验证 key 格式
			const keyRegex = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
			if (field.key && !keyRegex.test(field.key)) {
				errors.push(`字段 ${fieldNum}: Frontmatter 键名格式不正确，只能包含字母、数字、下划线和连字符，且必须以字母或下划线开头`);
			}

			// 验证 select 和 multi-select 类型必须有选项
			if ((field.type === 'select' || field.type === 'multi-select') &&
				(!field.options || field.options.length === 0 || field.options.every(opt => !opt.trim()))) {
				errors.push(`字段 ${fieldNum}: ${field.type === 'select' ? '单选' : '多选'}类型必须至少有一个选项`);
			}
		});

		// 检查重复的 key
		const keys = this.fields.map(f => f.key).filter(k => k.trim());
		const duplicateKeys = keys.filter((key, index) => keys.indexOf(key) !== index);
		if (duplicateKeys.length > 0) {
			errors.push(`发现重复的 Frontmatter 键名: ${duplicateKeys.join(', ')}`);
		}

		return {
			isValid: errors.length === 0,
			errors
		};
	}

	/**
	 * 保存并关闭
	 */
	private async saveAndClose(): Promise<void> {
		// 验证字段数据
		const validation = this.validateFields();
		if (!validation.isValid) {
			new Notice(`❌ 验证失败:\n${validation.errors.join('\n')}`);
			return;
		}

		try {
			// 过滤掉空字段并保存（默认值现在可以为空）
			const filteredFields = this.fields.filter(field =>
				field.key.trim() &&
				field.label.trim()
			);

			const updatedPreset = await this.presetManager.updatePresetFields(this.preset.id, filteredFields);
			this.preset = updatedPreset;
			this.fields = updatedPreset.fields.map(field => ({ ...field }));

			// 通知父级刷新
			this.onPresetsChanged?.();

			new Notice('✅ 字段配置已保存');
			this.close();
		} catch (error) {
			console.error('Fast Templater: 保存字段配置失败', error);
			new Notice('❌ 保存字段配置失败');
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
