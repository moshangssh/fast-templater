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
			cls: 'note-architect-modal-title'
		});

		const mainContainerEl = this.contentEl.createDiv('note-architect-main-container');
		const leftContainerEl = mainContainerEl.createDiv('note-architect-left-container');

		const searchHostEl = leftContainerEl.createDiv();
		const listContainerEl = leftContainerEl.createDiv('note-architect-modal-container');

		const previewContainerEl = mainContainerEl.createDiv('note-architect-preview-container');
		previewContainerEl.createEl('h3', {
			text: '预览',
			cls: 'note-architect-preview-title'
		});
		const previewContentEl = previewContainerEl.createDiv('note-architect-preview-content');

		const footerEl = this.contentEl.createDiv('note-architect-modal-footer');

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
