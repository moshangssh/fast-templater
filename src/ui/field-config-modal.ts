import { App, Modal, Notice } from 'obsidian';
import type { FrontmatterField, FrontmatterPreset } from '@types';
import { PresetManager } from '@presets';
import { validateAndSave } from './ui-utils';

export class FieldConfigModal extends Modal {
	private readonly presetManager: PresetManager;
	private preset: FrontmatterPreset;
	private fields: FrontmatterField[];
	private readonly onPresetsChanged?: () => void;
	private draggedIndex: number | null = null;
	private readonly fieldCollapseStates = new WeakMap<FrontmatterField, boolean>();

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
			text: '添加字段',
			cls: 'mod-cta fast-templater-field-config-actions__btn'
		});
		addFieldBtn.onclick = () => this.addNewField(fieldsContainer);

		// 按钮分隔
		actionsContainer.createEl('span', {
			text: ' | ',
			cls: 'fast-templater-field-config-actions__divider'
		});

		// 保存按钮
		const saveBtn = actionsContainer.createEl('button', {
			text: '保存',
			cls: 'mod-cta fast-templater-field-config-actions__btn'
		});
		saveBtn.onclick = () => this.saveAndClose();

		// 取消按钮
		const cancelBtn = actionsContainer.createEl('button', {
			text: '取消',
			cls: 'fast-templater-field-config-actions__btn'
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
		fieldItem.dataset.index = index.toString();
		const isCollapsed = this.isFieldCollapsed(field);

		// 仅通过拖拽手柄触发拖拽，避免影响输入框操作
		const headerEl = fieldItem.createDiv('fast-templater-field-header');
		headerEl.addClass('fast-templater-field-header--collapsible');
		headerEl.setAttr('tabindex', '0');
		headerEl.setAttr('role', 'button');
		const headerLeft = headerEl.createDiv('fast-templater-field-header__left');

		const dragHandle = headerLeft.createSpan({
			cls: 'fast-templater-field-drag-handle',
			text: '⠿'
		});
		dragHandle.setAttr('draggable', 'true');

		dragHandle.addEventListener('dragstart', event => {
			this.draggedIndex = index;
			fieldItem.classList.add('fast-templater-field-item--dragging');
			event.dataTransfer?.setData('text/plain', String(index));
			event.dataTransfer && (event.dataTransfer.effectAllowed = 'move');
		});

		dragHandle.addEventListener('dragend', () => {
			this.draggedIndex = null;
			fieldItem.classList.remove('fast-templater-field-item--dragging');
			this.clearDragStyles(containerEl);
		});

		fieldItem.addEventListener('dragover', event => {
			if (this.draggedIndex === null) {
				return;
			}
			event.preventDefault();
			event.dataTransfer && (event.dataTransfer.dropEffect = 'move');

			const isAfter = this.isDropAfter(event, fieldItem);
			fieldItem.classList.toggle('fast-templater-field-item--drag-over-before', !isAfter);
			fieldItem.classList.toggle('fast-templater-field-item--drag-over-after', isAfter);
		});

		fieldItem.addEventListener('dragleave', () => {
			fieldItem.classList.remove('fast-templater-field-item--drag-over-before', 'fast-templater-field-item--drag-over-after');
		});

		fieldItem.addEventListener('drop', event => {
			if (this.draggedIndex === null) {
				return;
			}
			event.preventDefault();
			const targetIndex = Number(fieldItem.dataset.index);
			if (Number.isNaN(targetIndex)) {
				return;
			}

			const isAfter = this.isDropAfter(event, fieldItem);
			this.handleReorder(this.draggedIndex, targetIndex, isAfter, containerEl);
		});

		// 字段头部标题
		const titleEl = headerLeft.createEl('h4', { text: `字段 ${index + 1}` });

		const summaryEl = headerLeft.createSpan({
			cls: 'fast-templater-field-header__summary'
		});
		const updateSummary = () => {
			// 更新标题：如果有显示名称则使用显示名称，否则使用默认的"字段 N"
			if (field.label?.trim()) {
				titleEl.setText(field.label);
			} else {
				titleEl.setText(`字段 ${index + 1}`);
			}

			// 更新摘要信息
			const summaryParts: string[] = [];
			if (field.key?.trim()) {
				summaryParts.push(`键名: ${field.key}`);
			}
			if (summaryParts.length === 0) {
				summaryEl.empty();
				return;
			}
			summaryEl.setText(summaryParts.join(' | '));
		};
		updateSummary();

		const headerActions = headerEl.createDiv('fast-templater-field-header__actions');

		// 删除字段按钮
		const deleteBtn = headerActions.createEl('button', {
			text: '删除',
			cls: 'mod-warning'
		});
		deleteBtn.onclick = event => {
			event.stopPropagation();
			this.removeField(index, containerEl);
		};

		// 字段配置容器
		const configContainer = fieldItem.createDiv('fast-templater-field-config');
		const applyCollapseState = (collapsed: boolean) => {
			this.fieldCollapseStates.set(field, collapsed);
			fieldItem.classList.toggle('fast-templater-field-item--collapsed', collapsed);
			configContainer.classList.toggle('fast-templater-field-config--collapsed', collapsed);
			headerEl.setAttr('aria-expanded', (!collapsed).toString());
			headerEl.classList.toggle('fast-templater-field-header--collapsed', collapsed);
		};
		applyCollapseState(isCollapsed);

		const shouldIgnoreToggle = (target: HTMLElement | null) => {
			if (!target) {
				return false;
			}
			return Boolean(
				target.closest('.fast-templater-field-header__actions') ||
				target.closest('.fast-templater-field-drag-handle')
			);
		};

		const toggleCollapse = () => {
			const nextState = !this.isFieldCollapsed(field);
			applyCollapseState(nextState);
		};

		headerEl.addEventListener('click', event => {
			const target = event.target as HTMLElement | null;
			if (shouldIgnoreToggle(target)) {
				return;
			}
			toggleCollapse();
		});

		headerEl.addEventListener('keydown', event => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				toggleCollapse();
			}
		});

		// Key 输入框
		const keyContainer = configContainer.createDiv('fast-templater-field-row');
		keyContainer.createEl('label', {
			text: 'Frontmatter 键名: *',
			cls: 'fast-templater-field-label'
		});
		const keyInput = keyContainer.createEl('input', {
			type: 'text',
			value: field.key,
			placeholder: '例如: status, category, priority',
			cls: 'fast-templater-field-input'
		});
		keyInput.addEventListener('input', () => {
			field.key = keyInput.value.trim();
			updateSummary();
		});

		// Label 输入框
		const labelContainer = configContainer.createDiv('fast-templater-field-row');
		labelContainer.createEl('label', {
			text: '显示名称: *',
			cls: 'fast-templater-field-label'
		});
		const labelInput = labelContainer.createEl('input', {
			type: 'text',
			value: field.label,
			placeholder: '例如: 状态, 分类, 优先级',
			cls: 'fast-templater-field-input'
		});
		labelInput.addEventListener('input', () => {
			field.label = labelInput.value.trim();
			updateSummary();
		});

		// Type 选择框
		const typeContainer = configContainer.createDiv('fast-templater-field-row');
		typeContainer.createEl('label', {
			text: '字段类型: *',
			cls: 'fast-templater-field-label'
		});
		const typeSelect = typeContainer.createEl('select', {
			cls: 'fast-templater-field-input fast-templater-field-select'
		});
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
		defaultContainer.createEl('label', {
			text: '默认值:',
			cls: 'fast-templater-field-label'
		});
		const defaultInput = defaultContainer.createEl('input', {
			type: 'text',
			value: field.default,
			placeholder: '默认值或 Templater 宏（可选）',
			cls: 'fast-templater-field-input'
		});
		defaultInput.addEventListener('input', () => {
			field.default = defaultInput.value;
		});

		// Options 配置（仅当类型为 select 或 multi-select 时显示）
		if (field.type === 'select' || field.type === 'multi-select') {
			const optionsContainer = configContainer.createDiv('fast-templater-field-row fast-templater-field-row--stacked');
			optionsContainer.createEl('label', {
				text: '选项列表:',
				cls: 'fast-templater-field-label'
			});

			const optionsListContainer = optionsContainer.createDiv('fast-templater-options-list');
			this.renderOptionsList(optionsListContainer, field, index);

			// 添加选项按钮
			const addOptionBtn = optionsContainer.createEl('button', {
				text: '添加选项',
				cls: 'mod-small fast-templater-field-options__btn'
			});
			addOptionBtn.onclick = () => this.addOption(field, optionsListContainer, index);
		}
	}

	/**
	 * 判断拖拽位置是否在目标元素下半部，用于决定插入位置
	 */
	private isDropAfter(event: DragEvent, targetEl: HTMLElement): boolean {
		const rect = targetEl.getBoundingClientRect();
		const offsetY = event.clientY - rect.top;
		return offsetY > rect.height / 2;
	}

	/**
	 * 清理拖拽样式
	 */
	private clearDragStyles(containerEl: HTMLElement): void {
		containerEl.querySelectorAll('.fast-templater-field-item').forEach(el => {
			el.classList.remove(
				'fast-templater-field-item--drag-over-before',
				'fast-templater-field-item--drag-over-after',
				'fast-templater-field-item--dragging'
			);
		});
	}

	/**
	 * 处理字段重新排序
	 */
	private handleReorder(fromIndex: number, targetIndex: number, isAfter: boolean, containerEl: HTMLElement): void {
		if (fromIndex === targetIndex && !isAfter) {
			this.clearDragStyles(containerEl);
			return;
		}

		const [movedField] = this.fields.splice(fromIndex, 1);
		let insertIndex = targetIndex;

		if (fromIndex < targetIndex) {
			insertIndex -= 1;
		}
		if (isAfter) {
			insertIndex += 1;
		}

		if (insertIndex < 0) {
			insertIndex = 0;
		}
		if (insertIndex > this.fields.length) {
			insertIndex = this.fields.length;
		}

		this.fields.splice(insertIndex, 0, movedField);
		this.draggedIndex = null;
		this.clearDragStyles(containerEl);
		this.renderFieldsList(containerEl);
	}

	/**
	 * 判断字段是否折叠
	 */
	private isFieldCollapsed(field: FrontmatterField): boolean {
		return this.fieldCollapseStates.get(field) ?? false;
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
				placeholder: '选项值',
				cls: 'fast-templater-field-input'
			});
			optionInput.addEventListener('input', () => {
				if (field.options) {
					field.options[optionIndex] = optionInput.value.trim();
				}
			});

			const removeOptionBtn = optionItem.createEl('button', {
				text: '删除',
				cls: 'mod-small mod-warning fast-templater-field-options__remove'
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
		const [removedField] = this.fields.splice(index, 1);
		if (removedField) {
			this.fieldCollapseStates.delete(removedField);
		}
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
			new Notice(`验证失败:\n${validation.errors.join('\n')}`);
			return;
		}

		// 使用 validateAndSave 工具函数简化保存流程
		await validateAndSave(
			this.fields,
			[], // 验证已在 validateFields() 中完成
			async (filteredFields) => {
				const updatedPreset = await this.presetManager.updatePresetFields(this.preset.id, filteredFields);
				this.preset = updatedPreset;
				this.fields = updatedPreset.fields.map(field => ({ ...field }));
			},
			{
				filterFn: (field) => Boolean(field.key.trim() && field.label.trim()),
				successMessage: '字段配置已保存',
				onSuccess: () => {
					this.onPresetsChanged?.();
					this.close();
				}
			}
		);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
