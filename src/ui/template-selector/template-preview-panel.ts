import { Component, MarkdownRenderer } from 'obsidian';
import type { Template } from '@types';
import { handleError } from '@core/error';

/**
 * 模板预览面板，负责渲染模板内容或提示信息
 */
export class TemplatePreviewPanel {
	private readonly contentEl: HTMLElement;
	private readonly markdownComponent: Component;

	constructor(contentEl: HTMLElement) {
		this.contentEl = contentEl;
		this.markdownComponent = new Component();
		this.markdownComponent.load();
	}

	render(template: Template | null) {
		this.contentEl.empty();

		if (!template) {
			this.contentEl.createEl('p', {
				text: '悬停或点击模板名称以预览内容',
				cls: 'note-architect-preview-placeholder'
			});
			return;
		}

		try {
			const renderedEl = this.contentEl.createDiv('note-architect-preview-markdown');
			MarkdownRenderer.renderMarkdown(template.content, renderedEl, template.path, this.markdownComponent);
		} catch (error) {
			handleError(error, {
				context: 'TemplatePreviewPanel.render'
			});

			this.contentEl.createEl('p', {
				text: '预览渲染失败，显示原始内容：',
				cls: 'note-architect-preview-error'
			});
			this.contentEl.createEl('pre', {
				text: template.content,
				cls: 'note-architect-preview-raw'
			});
		}
	}

	destroy() {
		this.contentEl.empty();
		this.markdownComponent.unload();
	}
}
