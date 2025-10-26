/**
 * 负责搭建模板选择模态窗口的基础布局
 */
export interface TemplateSelectorLayoutRefs {
	searchHostEl: HTMLElement;
	listContainerEl: HTMLElement;
	previewContentEl: HTMLElement;
	footerEl: HTMLElement;
}

export class TemplateSelectorLayout {
	private readonly contentEl: HTMLElement;

	constructor(contentEl: HTMLElement) {
		this.contentEl = contentEl;
	}

	mount(): TemplateSelectorLayoutRefs {
		this.contentEl.empty();

		this.contentEl.createEl('h2', {
			text: '选择模板',
			cls: 'fast-templater-modal-title'
		});

		const mainContainerEl = this.contentEl.createDiv('fast-templater-main-container');
		const leftContainerEl = mainContainerEl.createDiv('fast-templater-left-container');

		const searchHostEl = leftContainerEl.createDiv();
		const listContainerEl = leftContainerEl.createDiv('fast-templater-modal-container');

		const previewContainerEl = mainContainerEl.createDiv('fast-templater-preview-container');
		previewContainerEl.createEl('h3', {
			text: '预览',
			cls: 'fast-templater-preview-title'
		});
		const previewContentEl = previewContainerEl.createDiv('fast-templater-preview-content');

		const footerEl = this.contentEl.createDiv('fast-templater-modal-footer');

		return {
			searchHostEl,
			listContainerEl,
			previewContentEl,
			footerEl
		};
	}

	destroy() {
		this.contentEl.empty();
	}
}
