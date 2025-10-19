import { App, Modal, Notice } from 'obsidian';
import type FastTemplater from '@core/plugin';
import type { FrontmatterPreset, Template } from '@types';
import * as TemplateEngine from '@engine';

export class FrontmatterManagerModal extends Modal {
	private plugin: FastTemplater;
	private template: Template;
	private preset: FrontmatterPreset;
	private formData: Record<string, unknown>;

	constructor(app: App, plugin: FastTemplater, template: Template, preset: FrontmatterPreset) {
		super(app);
		this.plugin = plugin;
		this.template = template;
		this.preset = preset;
		this.formData = {}; // 初始化表单数据
	}

	onOpen() {
		const { contentEl } = this;

		// 设置模态窗口大小
		this.modalEl.style.width = '85vw';
		this.modalEl.style.maxWidth = '700px';
		this.modalEl.style.height = '80vh';

		// 创建标题
		contentEl.createEl('h2', { text: `配置模板: ${this.template.name}` });

		// 创建主容器
		const mainContainer = contentEl.createDiv('fast-templater-frontmatter-manager-container');

		// 创建说明文字
		mainContainer.createEl('p', {
			text: `此模板引用了预设 "${this.preset.name}"，请填写以下字段：`,
			cls: 'setting-item-description'
		});

		// 创建表单容器
		const formContainer = mainContainer.createDiv('fast-templater-form-container');

		// 渲染表单字段
		this.renderFormFields(formContainer);

		// 创建操作按钮容器
		const actionsContainer = mainContainer.createDiv('fast-templater-form-actions');

		// 取消按钮
		const cancelBtn = actionsContainer.createEl('button', {
			text: '❌ 取消',
			cls: 'mod-cta'
		});
		cancelBtn.onclick = () => this.handleCancel();

		// 按钮分隔
		actionsContainer.createEl('span', { text: ' | ' });

		// 确认按钮（暂时禁用，等 Templater 解析完成后启用）
		const confirmBtn = actionsContainer.createEl('button', {
			text: '✅ 确认插入',
			cls: 'mod-cta'
		});
		confirmBtn.disabled = true;
		confirmBtn.onclick = () => this.handleConfirm();

		// 异步解析 Templater 默认值
		this.parseTemplaterDefaults().then(() => {
			confirmBtn.disabled = false;
		});
	}

	/**
	 * 渲染表单字段
	 */
	private renderFormFields(containerEl: HTMLElement): void {
		containerEl.empty();

		this.preset.fields.forEach((field) => {
			const fieldContainer = containerEl.createDiv('fast-templater-form-field');

			// 字段标签
			fieldContainer.createEl('label', {
				text: `${field.label}:`,
				cls: 'fast-templater-form-label'
			});

			// 字段输入控件
			let inputEl: HTMLInputElement | HTMLSelectElement | undefined;

			switch (field.type) {
				case 'text':
					inputEl = fieldContainer.createEl('input', {
						type: 'text',
						cls: 'fast-templater-form-input'
					}) as HTMLInputElement;
					break;

				case 'date':
					inputEl = fieldContainer.createEl('input', {
						type: 'date',
						cls: 'fast-templater-form-input'
					}) as HTMLInputElement;
					break;

				case 'select': {
					const selectEl = fieldContainer.createEl('select', {
						cls: 'fast-templater-form-select'
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
					const multiSelectContainer = fieldContainer.createDiv('fast-templater-multi-select-container');

					// 初始化多选字段的表单数据
					this.formData[field.key] = [];

					if (field.options && field.options.length > 0) {
						field.options.forEach(option => {
							const optionContainer = multiSelectContainer.createDiv('fast-templater-checkbox-container');

							const checkbox = optionContainer.createEl('input', {
								type: 'checkbox',
								value: option,
								cls: 'fast-templater-form-checkbox'
							}) as HTMLInputElement;

							// 添加 change 事件监听器来实时更新表单数据
							checkbox.addEventListener('change', () => {
								this.collectMultiSelectData();
							});

							// 如果选项是默认值，则预选中
							if (field.default === option) {
								checkbox.checked = true;
							}

							optionContainer.createEl('label', {
								text: option,
								cls: 'fast-templater-checkbox-label'
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
						cls: 'fast-templater-form-input'
					}) as HTMLInputElement;
					break;
			}

			// 为有 inputEl 的字段类型添加事件监听器
			if (inputEl && (field.type === 'text' || field.type === 'date' || field.type === 'select')) {
				// 初始化表单数据
				this.formData[field.key] = field.default;

				// 设置初始值
				if (field.type === 'text' || field.type === 'date') {
					(inputEl as HTMLInputElement).value = field.default;
				} else if (field.type === 'select' && inputEl) {
					const selectEl = inputEl as HTMLSelectElement;
					const matchingOption = Array.from(selectEl.options).find(option => option.value === field.default);
					if (matchingOption) {
						selectEl.value = field.default;
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
		try {
			const tempTemplate: Template = {
				id: 'temp-templater-parsing',
				name: 'Temp Templater Parsing',
				path: this.template.path,
				content: ''
			};

			for (const field of this.preset.fields) {
				if (field.default && field.default.includes('<%')) {
					try {
						if (this.plugin.settings.enableTemplaterIntegration && TemplateEngine.isTemplaterEnabled(this.app)) {
							tempTemplate.content = field.default;
							const parsedValue = await TemplateEngine.runTemplater(this.app, tempTemplate);
							field.default = parsedValue;
							this.formData[field.key] = parsedValue;
						}
					} catch (error) {
						console.warn(`Fast Templater: 字段 "${field.label}" 的默认值 Templater 解析失败`, error);
						new Notice(`⚠️ 字段 "${field.label}" 的默认值解析失败，显示原始宏内容`);
					}
				} else {
					this.formData[field.key] = field.default;
				}
			}

			const formContainer = this.contentEl.querySelector('.fast-templater-form-container') as HTMLElement;
			if (formContainer) {
				this.renderFormFields(formContainer);
			}
		} catch (error) {
			console.error('Fast Templater: Templater 默认值解析过程失败', error);
			new Notice('⚠️ 默认值解析过程中出现错误，将显示原始值');
		}
	}

	
	/**
	 * 收集多选框数据
	 */
	private collectMultiSelectData(): void {
		this.preset.fields.forEach(field => {
			if (field.type === 'multi-select') {
				const fieldContainer = this.contentEl.querySelector('.fast-templater-form-container');
				if (!fieldContainer) return;

				// 找到当前字段的所有 checkbox
				const checkboxes = fieldContainer.querySelectorAll('input[type="checkbox"]') as unknown as NodeListOf<HTMLInputElement>;
				const selectedValues: string[] = [];

				checkboxes.forEach(checkbox => {
					if ((checkbox as HTMLInputElement).checked && (checkbox as HTMLInputElement).value) {
						selectedValues.push((checkbox as HTMLInputElement).value);
					}
				});

				this.formData[field.key] = selectedValues;
			}
		});
	}

	
	/**
	 * 处理取消按钮点击事件
	 */
	private handleCancel(): void {
		this.close();
	}

	/**
	 * 处理确认按钮点击事件 - 核心逻辑实现
	 * Task 1: 表单数据收集和预处理
	 * Task 2-6: 完整的模板插入流程
	 */
	private async handleConfirm(): Promise<void> {
		try {
			// Subtask 1.1: 收集多选框数据
			this.collectMultiSelectData();

			// Subtask 1.2: 验证表单数据
			const validation = this.plugin.presetManager.validateFormData(this.preset, this.formData);
			if (!validation.isValid) {
				new Notice(`❌ 表单验证失败:\n${validation.errors.join('\n')}`);
				return;
			}

			// Subtask 1.3: 转换表单数据为 Frontmatter 格式
			const userFrontmatter = TemplateEngine.convertFormDataToFrontmatter(this.preset, this.formData);

			// 执行完整的模板插入流程
			const result = await TemplateEngine.insertTemplateWithUserInput(
				this.app,
				this.plugin,
				this.template,
				this.preset,
				userFrontmatter
			);

			// 有 Templater 警告时展示提示
			if (result.templaterError) {
				new Notice(`⚠️ ${result.templaterError}，将使用原始模板内容进行插入`);
			}

			if (result.fallbackToBodyOnly) {
				new Notice('⚠️ Frontmatter 更新失败，尝试仅插入模板内容');
				new Notice('✅ 已插入模板内容（Frontmatter 更新失败）');
			} else {
				const templaterInfo = result.usedTemplater ? '并使用 Templater 处理' : '';
				const mergeInfo = result.mergeCount > 0 ? `已合并 ${result.mergeCount} 个 frontmatter 字段` : '';

				let successMessage = `✅ 模板 "${this.template.name}" 已插入`;
				if (templaterInfo || mergeInfo) {
					successMessage += `（${templaterInfo}${templaterInfo && mergeInfo ? '，' : ''}${mergeInfo}）`;
				}
				successMessage += '。';

				new Notice(successMessage);
			}

			// Task 6.2: 操作完成后关闭模态窗口
			this.close();

		} catch (error) {
			console.error('Fast Templater: 处理确认操作失败', error);

			// Task 4: 错误处理机制
			const errorMessage = error instanceof Error ? error.message : '未知错误';
			new Notice(`❌ 插入模板失败: ${errorMessage}`);

			// Task 4.4: 用户友好的错误通知系统
			// 提供回退建议
			if (errorMessage.includes('编辑器')) {
				new Notice('💡 请确保在 Markdown 文件中使用此功能');
			} else if (errorMessage.includes('Templater')) {
				new Notice('💡 可以尝试禁用 Templater 集成后重试');
			}
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
