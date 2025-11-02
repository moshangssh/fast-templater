import { App, Modal, MarkdownView } from 'obsidian';
import type NoteArchitect from '@core/plugin';
import type { FrontmatterPreset, Template, TemplateInsertionResult } from '@types';
import * as TemplateEngine from '@engine';
import { ObsidianTemplaterAdapter } from '@engine';
import { handleError } from '@core/error';
import { notifyInfo, notifySuccess, notifyWarning } from '@utils/notify';
import { createMergedPreset } from './frontmatter/preset-field-merger';

export class FrontmatterManagerModal extends Modal {
	private readonly plugin: NoteArchitect;
	private readonly template: Template;
	private readonly sourcePresets: FrontmatterPreset[];
	private readonly mergedPreset: FrontmatterPreset;
	private readonly sourcePresetIds: string[];
	private readonly sourcePresetNames: string[];
	private formData: Record<string, unknown>;
	private readonly multiSelectFieldRefs: Map<string, HTMLElement> = new Map();
	private resolvedDefaults: Map<string, string> = new Map();
	private isResolving = true;

	constructor(app: App, plugin: NoteArchitect, template: Template, presets: FrontmatterPreset[]) {
		super(app);
		this.plugin = plugin;
		this.template = template;
		this.sourcePresets = presets.length > 0 ? presets : [];
		const { mergedPreset, sourcePresetIds } = createMergedPreset(this.sourcePresets);
		this.mergedPreset = mergedPreset;
		this.sourcePresetIds = sourcePresetIds;
		this.sourcePresetNames = this.sourcePresets.map(preset => preset.name);
		this.formData = {};
	}

	onOpen() {
		const { contentEl } = this;

		// 设置模态窗口大小
		this.modalEl.style.width = '90vw';
		this.modalEl.style.maxWidth = '650px';
		this.modalEl.style.height = 'auto';
		this.modalEl.style.maxHeight = '85vh';

		// 创建标题
		contentEl.createEl('h2', {
			text: `配置模板: ${this.template.name}`,
			cls: 'note-architect-form-title'
		});

		// 创建主容器
		const mainContainer = contentEl.createDiv('note-architect-frontmatter-manager-container');

		// 创建说明区域
		const descriptionContainer = mainContainer.createDiv('note-architect-form-description');
		const descriptionText = this.sourcePresetNames.length > 1
			? `此模板引用了多个预设（${this.sourcePresetNames.join('、')}），请填写以下字段：`
			: `此模板引用了预设 "${this.mergedPreset.name}"，请填写以下字段：`;
		descriptionContainer.createEl('p', {
			text: descriptionText,
			cls: 'note-architect-form-description-text'
		});

		// 创建表单容器
		const formContainer = mainContainer.createDiv('note-architect-form-container');

		// 创建操作按钮容器
		const actionsContainer = mainContainer.createDiv('note-architect-form-actions');

		// 取消按钮
		const cancelBtn = actionsContainer.createEl('button', {
			text: '取消',
			cls: 'note-architect-form-btn note-architect-form-btn--cancel'
		});
		cancelBtn.onclick = () => this.handleCancel();

		// 确认按钮（暂时禁用，等 Templater 解析完成后启用）
		const confirmBtn = actionsContainer.createEl('button', {
			text: '确认插入',
			cls: 'mod-cta note-architect-form-btn note-architect-form-btn--confirm'
		});
		confirmBtn.disabled = true;
		confirmBtn.onclick = () => this.handleConfirm();

		// 先解析 Templater 默认值，再渲染表单
		this.parseTemplaterDefaults().then(() => {
			this.isResolving = false;
			this.renderFormFields(formContainer);
			confirmBtn.disabled = false;
		}).catch((error) => {
			handleError(error, {
				context: 'FrontmatterManagerModal.parseTemplaterDefaults',
			});
			notifyWarning('部分默认值解析失败，已使用原始字段默认值。');
			this.isResolving = false;
			this.renderFormFields(formContainer);
			confirmBtn.disabled = false;
		});
	}

	/**
	 * 渲染表单字段
	 */
	private renderFormFields(containerEl: HTMLElement): void {
		containerEl.empty();
		this.multiSelectFieldRefs.clear();

		this.mergedPreset.fields.forEach((field) => {
			const fieldContainer = containerEl.createDiv('note-architect-form-field');
			fieldContainer.setAttr('data-field-key', field.key);

			// 字段标签
			fieldContainer.createEl('label', {
				text: `${field.label}:`,
				cls: 'note-architect-form-label'
			});

			// 获取解析后的默认值
			const resolvedRaw = this.resolvedDefaults.get(field.key) ?? field.default ?? '';
			const fallbackDefault = typeof field.default === 'string' ? field.default : '';
			const resolvedDefault = typeof resolvedRaw === 'string'
				? resolvedRaw
				: (resolvedRaw !== undefined && resolvedRaw !== null ? String(resolvedRaw) : fallbackDefault);
			const isTemplaterAutofill = field.type === 'date' && field.useTemplaterTimestamp === true;

			if (!(field.key in this.formData)) {
				this.formData[field.key] = resolvedDefault || fallbackDefault;
			}

			if (isTemplaterAutofill) {
				const previewValue = (this.formData[field.key] as string) || fallbackDefault;
				const previewInput = fieldContainer.createEl('input', {
					type: 'text',
					cls: 'note-architect-form-input note-architect-form-input--readonly'
				}) as HTMLInputElement;
				previewInput.value = previewValue;
				previewInput.readOnly = true;
				previewInput.tabIndex = -1;

				const hintText = previewValue.includes('<%')
					? 'Templater 未执行，将写入原始表达式。'
					: '已自动填入当前时间，保存时将写入以上格式。';
				fieldContainer.createEl('small', {
					cls: 'setting-item-description',
					text: hintText
				});

				return;
			}

			// 字段输入控件
			let inputEl: HTMLInputElement | HTMLSelectElement | undefined;

			switch (field.type) {
				case 'text':
					inputEl = fieldContainer.createEl('input', {
						type: 'text',
						cls: 'note-architect-form-input'
					}) as HTMLInputElement;
					break;

				case 'date':
					inputEl = fieldContainer.createEl('input', {
						type: 'date',
						cls: 'note-architect-form-input'
					}) as HTMLInputElement;
					break;

				case 'select': {
					const selectEl = fieldContainer.createEl('select', {
						cls: 'note-architect-form-select'
					}) as HTMLSelectElement;
					inputEl = selectEl;

					// 添加默认选项
					selectEl.createEl('option', {
						value: '',
						text: '请选择...'
					});

					// 添加预设选项
					if (field.options) {
						field.options.forEach(option => {
							selectEl.createEl('option', {
								value: option,
								text: option
							});
						});
					}
					break;
				}

				case 'multi-select': {
					// 多选框组
					const multiSelectContainer = fieldContainer.createDiv('note-architect-multi-select-container');
					this.multiSelectFieldRefs.set(field.key, multiSelectContainer);

					// 初始化多选字段的表单数据
					if (!this.formData[field.key]) {
						this.formData[field.key] = [];
					}

					if (field.options && field.options.length > 0) {
						field.options.forEach(option => {
							const optionContainer = multiSelectContainer.createDiv('note-architect-checkbox-container');

							const checkbox = optionContainer.createEl('input', {
								type: 'checkbox',
								value: option,
								cls: 'note-architect-form-checkbox'
							}) as HTMLInputElement;

						// 添加 change 事件监听器来实时更新表单数据
						checkbox.addEventListener('change', () => {
							this.collectMultiSelectData();
						});

						// 如果选项已在表单數據中，預選中
						const currentValue = this.formData[field.key];
						const shouldCheck = Array.isArray(currentValue)
							? currentValue.includes(option)
							: resolvedDefault === option;
						if (shouldCheck) {
							checkbox.checked = true;
						}

						optionContainer.createEl('label', {
							text: option,
							cls: 'note-architect-checkbox-label'
						});
						});
					} else {
						multiSelectContainer.createEl('small', {
							text: '暂无可用选项',
							cls: 'setting-item-description'
						});
					}
					break;
				}

				default:
					// 默认为文本输入
					inputEl = fieldContainer.createEl('input', {
						type: 'text',
						cls: 'note-architect-form-input'
					}) as HTMLInputElement;
					break;
			}

			// 为有 inputEl 的字段类型添加事件监听器
			if (inputEl && (field.type === 'text' || field.type === 'date' || field.type === 'select')) {
				// 初始化表单数据（保留已有值或使用解析后的默认值）
				if (!(field.key in this.formData)) {
					this.formData[field.key] = resolvedDefault;
				}

				// 设置初始值
				if (field.type === 'text' || field.type === 'date') {
					(inputEl as HTMLInputElement).value = this.formData[field.key] as string || '';
				} else if (field.type === 'select' && inputEl) {
					const selectEl = inputEl as HTMLSelectElement;
					const currentValue = this.formData[field.key] as string;
					const matchingOption = Array.from(selectEl.options).find(option => option.value === currentValue);
					if (matchingOption) {
						selectEl.value = currentValue;
					}
				}

				// 添加输入变化监听器
				inputEl.addEventListener('input', () => {
					this.formData[field.key] = field.type === 'select'
						? inputEl!.value
						: (inputEl as HTMLInputElement).value;
				});
			}
		});

		// 在所有字段渲染完成后，收集一次多选框数据以捕获默认选中的值
		setTimeout(() => {
			this.collectMultiSelectData();
		}, 0);
	}

	/**
	 * 解析 Templater 默认值
	 */
	private async parseTemplaterDefaults(): Promise<void> {
		const templater = new ObsidianTemplaterAdapter(this.app);
		for (const field of this.mergedPreset.fields) {
			if (field.default && field.default.includes('<%')) {
				try {
					if (this.plugin.settings.enableTemplaterIntegration && templater.isAvailable()) {
						const tempTemplate: Template = {
							id: 'temp-templater-parsing',
							name: 'Temp Templater Parsing',
							path: '',
							content: field.default
						};
						const parsedValue = await templater.processTemplate(tempTemplate);
						this.resolvedDefaults.set(field.key, parsedValue.trim());
					} else {
						this.resolvedDefaults.set(field.key, field.default);
					}
				} catch (error) {
					console.warn(`Note Architect: 字段 "${field.label}" 的默认值 Templater 解析失败`, error);
					this.resolvedDefaults.set(field.key, field.default);
				}
			} else {
				this.resolvedDefaults.set(field.key, field.default);
			}
		}
	}

	
	/**
	 * 收集多选框数据
	 */
	private collectMultiSelectData(): void {
		for (const [fieldKey, container] of this.multiSelectFieldRefs.entries()) {
			const checkboxes = container.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
			const selectedValues: string[] = [];

			checkboxes.forEach((checkbox) => {
				if (checkbox.checked && checkbox.value) {
					selectedValues.push(checkbox.value);
				}
			});

			this.formData[fieldKey] = selectedValues;
		}
	}

	
	/**
	 * 处理取消按钮点击事件
	 */
	private handleCancel(): void {
		this.close();
	}

	private notifyValidationFailure(errors: string[]): void {
		notifyWarning(`表单验证失败:\n${errors.join('\n')}`, { prefix: false });
	}

	private handleInsertionResult(result: TemplateInsertionResult): void {
		if (result.templaterError) {
			notifyWarning(`${result.templaterError}，将使用原始模板内容进行插入`);
		}

		if (result.fallbackToBodyOnly) {
			notifyWarning('Frontmatter 更新失败，已插入模板正文内容。');
			return;
		}

		const details: string[] = [];
		if (result.usedTemplater) {
			details.push('并使用 Templater 处理');
		}
		if (result.mergeCount > 0) {
			details.push(`已合并 ${result.mergeCount} 个 frontmatter 字段`);
		}

		const suffix = details.length > 0 ? `（${details.join('，')}）` : '';
		notifySuccess(`模板 "${this.template.name}" 已插入${suffix}。`);
	}

	private handleInsertionFailure(error: unknown): void {
		const normalizedError = handleError(error, {
			context: 'FrontmatterManagerModal.handleConfirm',
			userMessage: '插入模板失败，请稍后重试。',
		});

		const message = normalizedError.message || '';
		if (message.includes('编辑器')) {
			notifyInfo('提示：请确保在 Markdown 文件中使用此功能');
		} else if (message.includes('Templater')) {
			notifyInfo('提示：可以尝试禁用 Templater 集成后重试');
		}
	}

	/**
	 * 处理确认按钮点击事件 - 核心逻辑实现
	 * Task 1: 表单数据收集和预处理
	 * Task 2-6: 完整的模板插入流程
	 */
	private async handleConfirm(): Promise<void> {
		this.collectMultiSelectData();

		const validation = this.plugin.presetManager.validateFormData(this.mergedPreset, this.formData);
		if (!validation.isValid) {
			this.notifyValidationFailure(validation.errors);
			return;
		}

		try {
			const userFrontmatter = TemplateEngine.convertFormDataToFrontmatter(this.mergedPreset, this.formData);
			const preparation = await TemplateEngine.prepareTemplateWithUserInput(
				this.app,
				this.plugin,
				this.template,
				this.mergedPreset,
				userFrontmatter,
			);

			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!activeView || !activeView.editor) {
				throw new Error('无法获取当前编辑器，请确保在 Markdown 文件中使用此功能');
			}

			const editor = activeView.editor;
			let templateBodyInserted = false;

			try {
				if (preparation.hasTemplateBody) {
					editor.replaceSelection(preparation.templateBody);
					templateBodyInserted = true;
				}

				TemplateEngine.updateNoteFrontmatter(
					editor,
					preparation.mergedFrontmatter,
					preparation.noteMetadata.position,
				);

				const result: TemplateInsertionResult = {
					usedTemplater: preparation.usedTemplater,
					templaterError: preparation.templaterError,
					mergedFrontmatter: preparation.mergedFrontmatter,
					mergeCount: preparation.mergeCount,
					frontmatterUpdated: true,
					templateBodyInserted,
					fallbackToBodyOnly: false,
				};

				this.handleInsertionResult(result);
				await this.plugin.addRecentTemplate(this.template.id);
				this.close();
			} catch (error) {
				console.error('Note Architect: 插入操作失败', error);

				try {
					editor.replaceSelection(preparation.templateBody);
					templateBodyInserted = preparation.hasTemplateBody;

					const fallbackResult: TemplateInsertionResult = {
						usedTemplater: preparation.usedTemplater,
						templaterError: preparation.templaterError,
						mergedFrontmatter: preparation.mergedFrontmatter,
						mergeCount: preparation.mergeCount,
						frontmatterUpdated: false,
						templateBodyInserted,
						fallbackToBodyOnly: true,
					};

					this.handleInsertionResult(fallbackResult);
					await this.plugin.addRecentTemplate(this.template.id);
					this.close();
				} catch (fallbackError) {
					console.error('Note Architect: 回退插入也失败', fallbackError);
					throw new Error('模板插入完全失败，请手动复制模板内容');
				}
			}
		} catch (error) {
			this.handleInsertionFailure(error);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
