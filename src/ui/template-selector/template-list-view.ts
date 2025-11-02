import type { Template } from '@types';
import { renderStatusBlock } from '../ui-utils';

export interface TemplateListStatusAction {
	text: string;
	action: () => void | Promise<unknown>;
	primary?: boolean;
	busyText?: string;
}

export interface TemplateListStatus {
	icon: string;
	title: string;
	message: string;
	actions?: TemplateListStatusAction[];
	containerClass?: string;
}

export interface TemplateListRenderOptions {
	recentTemplates: Template[];
	allTemplates: Template[];
	selectedTemplateId?: string | null;
	activeIndex: number;
	highlightActive?: boolean;
	onHover: (template: Template) => void;
	onClick: (template: Template) => void;
	onActiveChange?: (index: number) => void;
}

/**
 * 模板列表视图，负责渲染列表、状态提示及事件绑定
 */
export class TemplateListView {
	private readonly containerEl: HTMLElement;
	private allListEl: HTMLElement | null = null;
	private allTemplates: Template[] = [];
	private activeIndex = -1;
	private highlightActive = false;
	private selectedTemplateId: string | null = null;
	private onActiveChange: ((index: number) => void) | null = null;

	constructor(containerEl: HTMLElement) {
		this.containerEl = containerEl;
	}

	renderLoading(title: string, message: string) {
		this.renderStatus({
			icon: '',
			title,
			message
		});
	}

	renderStatus(status: TemplateListStatus) {
		this.resetState();
		const containerClass = [
			'note-architect-status-container',
			status.containerClass ?? ''
		].filter(Boolean).join(' ');

		renderStatusBlock(this.containerEl, {
			icon: status.icon,
			title: status.title,
			items: [
				{
					label: '',
					content: status.message,
					type: 'text'
				}
			],
			actions: status.actions?.map(action => ({
				text: action.text,
				onClick: action.action,
				cls: action.primary ? 'mod-cta' : '',
				busyText: action.busyText
			})),
			containerClass
		});
	}

	renderTemplates(options: TemplateListRenderOptions) {
		this.resetState();

		this.allTemplates = options.allTemplates;
		this.selectedTemplateId = options.selectedTemplateId ?? null;
		this.activeIndex = this.clampActiveIndex(options.activeIndex);
		this.highlightActive = options.highlightActive ?? false;
		this.onActiveChange = options.onActiveChange ?? null;

		const { recentTemplates } = options;

		if (recentTemplates.length > 0) {
			this.renderSection('最近使用', recentTemplates, options.onHover, options.onClick, false);
		}

		if (this.allTemplates.length > 0) {
			this.allListEl = this.renderSection('所有模板', this.allTemplates, options.onHover, options.onClick, true);
			this.applyActiveState();
		}
	}

	setActiveIndex(index: number) {
		this.highlightActive = true;
		this.activeIndex = this.clampActiveIndex(index);
		this.applyActiveState();
		this.onActiveChange?.(this.activeIndex);
	}

	getTemplateAt(index: number): Template | null {
		if (index < 0) {
			return null;
		}
		return this.allTemplates[index] ?? null;
	}

	getAllTemplateCount(): number {
		return this.allTemplates.length;
	}

	destroy() {
		this.resetState();
		this.containerEl.empty();
	}

	private renderSection(
		title: string,
		templates: Template[],
		onHover: (template: Template) => void,
		onClick: (template: Template) => void,
		isAllSection: boolean
	): HTMLElement {
		this.containerEl.createEl('h4', { text: title, cls: 'note-architect-list-header' });
		const listEl = this.containerEl.createEl('ul', { cls: 'note-architect-template-list' });
		templates.forEach((template, index) => {
			const itemEl = listEl.createEl('li', { cls: 'note-architect-template-item' });
			if (isAllSection && this.highlightActive && index === this.activeIndex) {
				itemEl.addClass('note-architect-template-item-active');
			}
			if (this.selectedTemplateId && template.id === this.selectedTemplateId) {
				itemEl.addClass('note-architect-template-item-selected');
			}

			itemEl.createEl('span', {
				text: template.name,
				cls: 'note-architect-template-name'
			});

			itemEl.addEventListener('mouseenter', () => {
				if (isAllSection) {
					this.activeIndex = index;
					if (this.highlightActive) {
						this.applyActiveState();
					}
					this.onActiveChange?.(index);
				}
				onHover(template);
			});

			itemEl.addEventListener('click', () => onClick(template));
		});

		return listEl;
	}

	private applyActiveState() {
		if (!this.allListEl) return;

		const prevActive = this.allListEl.querySelector('.note-architect-template-item-active');
		prevActive?.classList.remove('note-architect-template-item-active');

		if (!this.highlightActive || this.activeIndex < 0) {
			return;
		}

		const child = this.allListEl.children[this.activeIndex];
		if (!child) return;

		const newActive = child as HTMLElement;
		if (newActive) {
			newActive.classList.add('note-architect-template-item-active');
			newActive.scrollIntoView({ block: 'nearest' });
		}
	}

	private resetState() {
		this.containerEl.empty();
		this.allListEl = null;
		this.allTemplates = [];
		this.selectedTemplateId = null;
		this.activeIndex = -1;
		this.highlightActive = false;
		this.onActiveChange = null;
	}

	private clampActiveIndex(index: number): number {
		if (this.allTemplates.length === 0) {
			return -1;
		}
		if (index < -1) {
			return -1;
		}
		if (index >= this.allTemplates.length) {
			return this.allTemplates.length - 1;
		}
		return index;
	}
}
