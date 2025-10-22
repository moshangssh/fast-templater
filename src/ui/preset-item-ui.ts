import { Notice } from 'obsidian';
import type { FrontmatterPreset } from '@types';

export interface RenderPresetItemContext {
	listContainerEl: HTMLElement;
	itemEl: HTMLElement;
	nameInputEl: HTMLInputElement;
	configButtonEl: HTMLButtonElement;
	deleteButtonEl: HTMLButtonElement;
	infoEl: HTMLElement;
}

export interface RenderPresetItemCallbacks {
	onRename?: (
		preset: FrontmatterPreset,
		newName: string,
		context: RenderPresetItemContext,
	) => Promise<void> | void;
	onConfigure?: (
		preset: FrontmatterPreset,
		context: RenderPresetItemContext,
	) => Promise<void> | void;
	onDelete?: (
		preset: FrontmatterPreset,
		context: RenderPresetItemContext,
	) => Promise<void> | void;
}

export interface RenderPresetItemOptions {
	containerEl: HTMLElement;
	preset: FrontmatterPreset;
	callbacks?: RenderPresetItemCallbacks;
	disableNameEditing?: boolean;
	disableDelete?: boolean;
}

export interface RenderPresetListOptions {
	containerEl: HTMLElement;
	presets: FrontmatterPreset[];
	callbacks?: RenderPresetItemCallbacks;
	disableNameEditing?: boolean;
	disableDelete?: boolean;
	emptyStateMessage?: string;
}

const DEFAULT_EMPTY_STATE_MESSAGE =
	'暂无配置预设，点击"添加新预设"开始创建。';

export function renderPresetItemUI(
	options: RenderPresetItemOptions,
): RenderPresetItemContext {
	const { containerEl, preset, callbacks } = options;
	const itemEl = containerEl.createDiv('fast-templater-preset-item');

	// 主内容区域
	const contentContainer = itemEl.createDiv('fast-templater-preset-content');

	// 名称输入框
	const nameContainer = contentContainer.createDiv('fast-templater-preset-name');
	const nameInputEl = nameContainer.createEl('input', {
		type: 'text',
		value: preset.name,
		cls: 'fast-templater-preset-name-input',
	}) as HTMLInputElement;

	// 信息区域
	const infoEl = contentContainer.createDiv('fast-templater-preset-info');
	const fieldCountText = preset.fields.length === 1 ? '1 个字段' : `${preset.fields.length} 个字段`;
	infoEl.createEl('span', {
		text: fieldCountText,
		cls: 'fast-templater-preset-field-count',
	});
	infoEl.createEl('span', {
		text: '•',
		cls: 'fast-templater-preset-separator',
	});
	infoEl.createEl('span', {
		text: `ID: ${preset.id}`,
		cls: 'fast-templater-preset-id',
	});

	// 操作按钮
	const actionsContainer = itemEl.createDiv('fast-templater-preset-actions');
	const configButtonEl = actionsContainer.createEl('button', {
		text: '配置字段',
		cls: 'fast-templater-preset-btn-config',
	}) as HTMLButtonElement;
	const deleteButtonEl = actionsContainer.createEl('button', {
		text: '删除',
		cls: 'fast-templater-preset-btn-delete',
	}) as HTMLButtonElement;

	const context: RenderPresetItemContext = {
		listContainerEl: containerEl,
		itemEl,
		nameInputEl,
		configButtonEl,
		deleteButtonEl,
		infoEl,
	};

	const disableNameInput =
		options.disableNameEditing ?? callbacks?.onRename === undefined;
	if (disableNameInput) {
		nameInputEl.disabled = true;
	}

	const disableDeleteButton =
		options.disableDelete ?? callbacks?.onDelete === undefined;
	if (disableDeleteButton) {
		deleteButtonEl.disabled = true;
	}

	if (callbacks?.onRename && !disableNameInput) {
		nameInputEl.addEventListener('change', async () => {
			const newName = nameInputEl.value.trim();
			if (!newName) {
				nameInputEl.value = preset.name;
				new Notice('预设名称不能为空');
				return;
			}

			if (newName === preset.name) {
				nameInputEl.value = preset.name;
				return;
			}

			try {
				await callbacks.onRename?.(preset, newName, context);
				preset.name = newName;
				nameInputEl.value = newName;
			} catch (error) {
				nameInputEl.value = preset.name;
			}
		});
	}

	if (callbacks?.onConfigure) {
		configButtonEl.addEventListener('click', async () => {
			try {
				await callbacks.onConfigure?.(preset, context);
			} catch (_error) {
				// 由上层回调负责处理错误反馈
			}
		});
	} else {
		configButtonEl.disabled = true;
	}

	if (callbacks?.onDelete && !disableDeleteButton) {
		deleteButtonEl.addEventListener('click', async () => {
			try {
				await callbacks.onDelete?.(preset, context);
			} catch (_error) {
				// 由上层回调负责处理错误反馈
			}
		});
	}

	return context;
}

export function renderPresetListUI(options: RenderPresetListOptions): void {
	const {
		containerEl,
		presets,
		callbacks,
		disableNameEditing,
		disableDelete,
		emptyStateMessage = DEFAULT_EMPTY_STATE_MESSAGE,
	} = options;

	containerEl.empty();

	if (presets.length === 0) {
		const emptyEl = containerEl.createDiv('fast-templater-empty-presets');
		emptyEl.createEl('p', {
			text: emptyStateMessage,
			cls: 'setting-item-description',
		});
		return;
	}

	presets.forEach((preset) => {
		renderPresetItemUI({
			containerEl,
			preset,
			callbacks,
			disableNameEditing,
			disableDelete,
		});
	});
}
