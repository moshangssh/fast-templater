import { Notice } from 'obsidian';

/**
 * UI 工具函数集合
 * 用于减少 Modal 类中的重复代码
 */

/**
 * 包装异步函数并提供统一的 UI 通知处理
 *
 * @example
 * ```ts
 * const result = await withUiNotice(
 *   async () => await presetManager.createPreset({ name: 'test' }),
 *   {
 *     success: (preset) => `已创建预设 "${preset.name}"`,
 *     fail: '创建预设失败'
 *   }
 * );
 * ```
 */
export async function withUiNotice<T>(
	asyncFn: () => Promise<T>,
	options: {
		success: string | ((result: T) => string);
		fail: string | ((error: Error) => string);
		onSuccess?: (result: T) => void;
		onFail?: (error: Error) => void;
	}
): Promise<T | null> {
	try {
		const result = await asyncFn();

		// 显示成功通知
		const successMessage = typeof options.success === 'function'
			? options.success(result)
			: options.success;
		new Notice(successMessage);

		// 执行成功回调
		options.onSuccess?.(result);

		return result;
	} catch (error) {
		console.error('Fast Templater: 操作失败', error);

		// 显示失败通知
		const failMessage = typeof options.fail === 'function'
			? options.fail(error as Error)
			: options.fail;
		new Notice(failMessage);

		// 执行失败回调
		options.onFail?.(error as Error);

		return null;
	}
}

/**
 * 验证字段并保存，提供标准的错误处理流程
 *
 * @example
 * ```ts
 * const success = await validateAndSave(
 *   this.fields,
 *   [
 *     (field) => !field.key.trim() ? '键名不能为空' : null,
 *     (field) => !field.label.trim() ? '显示名称不能为空' : null
 *   ],
 *   async (validFields) => {
 *     await this.presetManager.updatePresetFields(this.preset.id, validFields);
 *   },
 *   {
 *     filterFn: (field) => field.key.trim() && field.label.trim(),
 *     successMessage: '字段配置已保存',
 *     onSuccess: () => this.close()
 *   }
 * );
 * ```
 */
export async function validateAndSave<T>(
	fields: T[],
	validators: Array<(field: T, index: number) => string | null>,
	saveFn: (validFields: T[]) => Promise<void>,
	options?: {
		filterFn?: (field: T) => boolean;
		successMessage?: string;
		onSuccess?: () => void;
		onFail?: (error: Error) => void;
	}
): Promise<boolean> {
	// 执行验证
	const errors: string[] = [];
	fields.forEach((field, index) => {
		validators.forEach(validator => {
			const error = validator(field, index);
			if (error) {
				errors.push(error);
			}
		});
	});

	// 如果有验证错误，显示并返回
	if (errors.length > 0) {
		new Notice(`验证失败:\n${errors.join('\n')}`);
		return false;
	}

	try {
		// 过滤字段（如果提供了过滤函数）
		const fieldsToSave = options?.filterFn
			? fields.filter(options.filterFn)
			: fields;

		// 执行保存操作
		await saveFn(fieldsToSave);

		// 显示成功消息
		if (options?.successMessage) {
			new Notice(options.successMessage);
		}

		// 执行成功回调
		options?.onSuccess?.();

		return true;
	} catch (error) {
		console.error('Fast Templater: 保存失败', error);
		new Notice('保存失败');

		// 执行失败回调
		options?.onFail?.(error as Error);

		return false;
	}
}

/**
 * 确认并执行删除操作
 *
 * @example
 * ```ts
 * const deleted = await confirmAndDelete(
 *   preset.id,
 *   preset.name,
 *   async (id) => await presetManager.deletePreset(id),
 *   {
 *     success: '预设已删除',
 *     fail: '删除预设失败',
 *     onSuccess: () => this.refreshPresetList()
 *   }
 * );
 * ```
 */
export async function confirmAndDelete(
	id: string,
	itemName: string,
	deleteFn: (id: string) => Promise<void>,
	options?: {
		success?: string;
		fail?: string;
		onSuccess?: () => void;
		onFail?: (error: Error) => void;
	}
): Promise<boolean> {
	try {
		await deleteFn(id);

		const successMessage = options?.success || `已删除 "${itemName}"`;
		new Notice(successMessage);

		options?.onSuccess?.();

		return true;
	} catch (error) {
		console.error('Fast Templater: 删除失败', error);

		const failMessage = options?.fail || `删除 "${itemName}" 失败`;
		new Notice(failMessage);

		options?.onFail?.(error as Error);

		return false;
	}
}

/**
 * 创建一个带有标准错误处理的表单提交处理器
 *
 * @example
 * ```ts
 * const handleSubmit = createFormSubmitHandler(
 *   async () => {
 *     const preset = await presetManager.createPreset({ name: this.nameInput.value });
 *     return preset;
 *   },
 *   {
 *     success: (preset) => `已创建预设 "${preset.name}"`,
 *     fail: '创建预设失败',
 *     onSuccess: () => {
 *       this.close();
 *       this.onPresetsChanged?.();
 *     }
 *   }
 * );
 *
 * submitButton.onclick = handleSubmit;
 * ```
 */
export function createFormSubmitHandler<T>(
	submitFn: () => Promise<T>,
	options: {
		success: string | ((result: T) => string);
		fail: string | ((error: Error) => string);
		onSuccess?: (result: T) => void;
		onFail?: (error: Error) => void;
		validate?: () => boolean | string; // 返回 true 表示验证通过，返回 string 表示验证失败并显示错误消息
	}
): () => Promise<void> {
	return async () => {
		// 执行验证（如果提供）
		if (options.validate) {
			const validationResult = options.validate();
			if (validationResult !== true) {
				const errorMessage = typeof validationResult === 'string'
					? validationResult
					: '验证失败';
				new Notice(errorMessage);
				return;
			}
		}

		// 执行提交操作
		await withUiNotice(submitFn, options);
	};
}

/**
 * 批量操作的进度通知包装器
 *
 * @example
 * ```ts
 * await withProgressNotice(
 *   async (updateProgress) => {
 *     for (let i = 0; i < items.length; i++) {
 *       await processItem(items[i]);
 *       updateProgress(i + 1, items.length);
 *     }
 *   },
 *   {
 *     start: '开始处理...',
 *     complete: '处理完成',
 *     fail: '处理失败'
 *   }
 * );
 * ```
 */
export async function withProgressNotice<T>(
	asyncFn: (updateProgress: (current: number, total: number) => void) => Promise<T>,
	options: {
		start?: string;
		complete: string | ((result: T) => string);
		fail: string | ((error: Error) => string);
		onComplete?: (result: T) => void;
		onFail?: (error: Error) => void;
	}
): Promise<T | null> {
	// 显示开始通知
	if (options.start) {
		new Notice(options.start);
	}

	const updateProgress = (current: number, total: number) => {
		// 简单显示进度通知，不尝试更新现有通知
		const message = `处理中... (${current}/${total})`;
		new Notice(message, 1000); // 1秒后自动关闭
	};

	try {
		const result = await asyncFn(updateProgress);

		// 显示完成通知
		const completeMessage = typeof options.complete === 'function'
			? options.complete(result)
			: options.complete;
		new Notice(completeMessage);

		options.onComplete?.(result);

		return result;
	} catch (error) {
		console.error('Fast Templater: 批量操作失败', error);

		// 显示失败通知
		const failMessage = typeof options.fail === 'function'
			? options.fail(error as Error)
			: options.fail;
		new Notice(failMessage);

		options.onFail?.(error as Error);

		return null;
	}
}

/**
 * 为按钮附加异步操作处理器，自动管理按钮的禁用/加载状态
 * 统一处理"按钮点击 → 禁用 → 异步操作 → 恢复"的模式
 *
 * @example
 * ```ts
 * // 基础用法：自动禁用按钮并显示加载文本
 * withBusyButton(
 *   reloadButton,
 *   async () => {
 *     await templateManager.reloadTemplates(true);
 *   },
 *   {
 *     busyText: '扫描中...',
 *     onComplete: () => this.refreshUI()
 *   }
 * );
 *
 * // 高级用法：带输入框联动
 * withBusyButton(
 *   reloadButton,
 *   async () => {
 *     const result = await templateManager.reloadTemplates(true);
 *     return result;
 *   },
 *   {
 *     busyText: '加载中...',
 *     linkedInputs: [searchInput], // 同时禁用关联的输入框
 *     busyClass: 'is-loading', // 添加自定义加载样式类
 *     onComplete: (result) => {
 *       this.updateTemplateList();
 *       searchInput.focus();
 *     }
 *   }
 * );
 * ```
 */
export function withBusyButton<T>(
	button: HTMLButtonElement,
	asyncFn: () => Promise<T>,
	options?: {
		/** 按钮在执行期间显示的文本（默认：原文本） */
		busyText?: string;
		/** 关联的输入框，执行期间会同时禁用 */
		linkedInputs?: HTMLInputElement[];
		/** 执行期间添加到按钮的 CSS 类名 */
		busyClass?: string;
		/** 执行期间添加到关联输入框的 CSS 类名 */
		linkedInputBusyClass?: string;
		/** 操作完成后的回调（无论成功或失败） */
		onComplete?: (result: T | null) => void;
		/** 操作成功后的回调 */
		onSuccess?: (result: T) => void;
		/** 操作失败后的回调 */
		onFail?: (error: Error) => void;
	}
): void {
	const originalText = button.textContent || '';
	const busyText = options?.busyText || originalText;
	const linkedInputs = options?.linkedInputs || [];

	button.onclick = async () => {
		// 1. 禁用按钮和关联输入框
		button.disabled = true;
		button.textContent = busyText;
		if (options?.busyClass) {
			button.classList.add(options.busyClass);
		}

		linkedInputs.forEach(input => {
			input.disabled = true;
			if (options?.linkedInputBusyClass) {
				input.classList.add(options.linkedInputBusyClass);
			}
		});

		try {
			// 2. 执行异步操作
			const result = await asyncFn();

			// 3. 成功回调
			options?.onSuccess?.(result);
			options?.onComplete?.(result);

			return result;
		} catch (error) {
			console.error('Fast Templater: 按钮操作失败', error);

			// 4. 失败回调
			options?.onFail?.(error as Error);
			options?.onComplete?.(null);

			return null;
		} finally {
			// 5. 恢复按钮和关联输入框状态
			button.disabled = false;
			button.textContent = originalText;
			if (options?.busyClass) {
				button.classList.remove(options.busyClass);
			}

			linkedInputs.forEach(input => {
				input.disabled = false;
				if (options?.linkedInputBusyClass) {
					input.classList.remove(options.linkedInputBusyClass);
				}
			});
		}
	};
}

/**
 * 为输入框附加异步操作处理器，自动管理输入框的禁用/加载状态
 * 适用于搜索框、清空按钮等场景
 *
 * @example
 * ```ts
 * // 为清空按钮附加处理器
 * withBusyInput(
 *   clearButton,
 *   searchInput,
 *   async () => {
 *     this.searchQuery = '';
 *     this.filteredTemplates = [...this.templates];
 *     this.updateTemplateList();
 *   },
 *   {
 *     onComplete: () => {
 *       searchInput.value = '';
 *       searchInput.focus();
 *       clearButton.style.display = 'none';
 *     }
 *   }
 * );
 * ```
 */
export function withBusyInput<T>(
	triggerElement: HTMLElement,
	targetInput: HTMLInputElement,
	asyncFn: () => Promise<T>,
	options?: {
		/** 执行期间添加到输入框的 CSS 类名 */
		busyClass?: string;
		/** 操作完成后的回调（无论成功或失败） */
		onComplete?: (result: T | null) => void;
		/** 操作成功后的回调 */
		onSuccess?: (result: T) => void;
		/** 操作失败后的回调 */
		onFail?: (error: Error) => void;
	}
): void {
	triggerElement.onclick = async () => {
		// 1. 禁用输入框
		targetInput.disabled = true;
		if (options?.busyClass) {
			targetInput.classList.add(options.busyClass);
		}

		try {
			// 2. 执行异步操作
			const result = await asyncFn();

			// 3. 成功回调
			options?.onSuccess?.(result);
			options?.onComplete?.(result);

			return result;
		} catch (error) {
			console.error('Fast Templater: 输入框操作失败', error);

			// 4. 失败回调
			options?.onFail?.(error as Error);
			options?.onComplete?.(null);

			return null;
		} finally {
			// 5. 恢复输入框状态
			targetInput.disabled = false;
			if (options?.busyClass) {
				targetInput.classList.remove(options.busyClass);
			}
		}
	};
}

/**
 * 统一的状态块渲染工具
 * 用于在设置页面和模态窗口中显示状态信息和操作按钮
 * 自动检测异步操作并应用 busy 状态管理
 *
 * @example
 * ```ts
 * // 基础用法：显示状态信息
 * renderStatusBlock(containerEl, {
 *   icon: '✅',
 *   title: '模板状态',
 *   items: [
 *     { label: '当前路径', content: '/Templates', type: 'code' },
 *     { label: '状态', content: '成功加载 10 个模板', type: 'status', color: 'var(--text-success)' }
 *   ]
 * });
 *
 * // 高级用法：带操作按钮
 * renderStatusBlock(containerEl, {
 *   icon: '⚠️',
 *   title: '加载失败',
 *   items: [
 *     { label: '', content: '模板文件夹不存在，请检查路径设置。', type: 'text' }
 *   ],
 *   actions: [
 *     {
 *       text: '重新扫描',
 *       onClick: async () => await templateManager.reloadTemplates(true),
 *       busyText: '扫描中...',
 *       cls: 'mod-cta'
 *     },
 *     {
 *       text: '打开设置',
 *       onClick: () => openSettings()
 *     }
 *   ]
 * });
 * ```
 */
export function renderStatusBlock(containerEl: HTMLElement, config: {
	icon: string;
	title: string;
	items: Array<{
		label: string;
		content: string;
		type?: 'text' | 'code' | 'status';
		color?: string;
	}>;
	actions?: Array<{
		text: string;
		onClick: () => void | Promise<unknown>;
		cls?: string;
		/** 异步操作时显示的加载文本（可选） */
		busyText?: string;
	}>;
	/** 自定义容器 CSS 类名 */
	containerClass?: string;
}): HTMLElement {
	const statusEl = containerEl.createDiv({
		cls: config.containerClass || 'fast-templater-status-block setting-item-description'
	});

	// 标题区域
	const headerEl = statusEl.createDiv('fast-templater-status-block__header');
	headerEl.createSpan({
		cls: 'fast-templater-status-block__icon',
		text: config.icon
	});
	headerEl.createSpan({
		cls: 'fast-templater-status-block__title',
		text: config.title
	});

	// 状态内容区域
	const itemsEl = statusEl.createDiv('fast-templater-status-block__items');
	config.items.forEach(item => {
		const itemEl = itemsEl.createDiv({
			cls: [
				'fast-templater-status-block__item',
				item.label ? '' : 'fast-templater-status-block__item--note'
			].join(' ').trim()
		});

		if (item.label) {
			itemEl.createSpan({
				cls: 'fast-templater-status-block__item-label',
				text: item.label
			});
		}

		const contentWrapper = itemEl.createDiv('fast-templater-status-block__item-content');
		let contentElement: HTMLElement;
		switch (item.type) {
			case 'code':
				contentElement = contentWrapper.createEl('code', { text: item.content });
				break;
			case 'status':
				contentElement = contentWrapper.createSpan({
					text: item.content,
					cls: 'fast-templater-status-block__status'
				});
				if (item.color) {
					contentElement.style.color = item.color;
				}
				break;
			default:
				contentElement = contentWrapper.createSpan({ text: item.content });
		}
		contentElement.classList.add('fast-templater-status-block__value');
	});

	// 操作按钮区域
	if (config.actions && config.actions.length > 0) {
		const actionsEl = statusEl.createDiv('fast-templater-status-block__actions');
		config.actions.forEach(action => {
			const button = actionsEl.createEl('button', {
				text: action.text,
				type: 'button',
				cls: action.cls || 'mod-cta'
			});

			// 检测是否是异步操作（通过检查函数是否返回 Promise）
			const originalAction = action.onClick;
			button.onclick = async () => {
				const result = originalAction();

				// 如果返回 Promise，说明是异步操作，应用 busy 状态
				if (result instanceof Promise) {
					const originalText = button.textContent || '';
					const busyText = action.busyText || '处理中...';

					button.disabled = true;
					button.textContent = busyText;

					try {
						await result;
					} finally {
						button.disabled = false;
						button.textContent = originalText;
					}
				}
			};
		});
	}

	return statusEl;
}
