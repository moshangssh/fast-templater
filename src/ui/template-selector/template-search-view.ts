interface TemplateSearchViewOptions {
	onInput: (value: string) => void;
	onKeyDown: (event: KeyboardEvent) => void;
	onClear: () => void;
	placeholder?: string;
	initialQuery?: string;
}

/**
 * 负责渲染模板搜索输入框及其交互逻辑
 */
export class TemplateSearchView {
	private readonly options: TemplateSearchViewOptions;
	private readonly parentEl: HTMLElement;
	private containerEl: HTMLElement | null = null;
	private inputEl: HTMLInputElement | null = null;
	private clearButtonEl: HTMLButtonElement | null = null;

	constructor(parentEl: HTMLElement, options: TemplateSearchViewOptions) {
		this.parentEl = parentEl;
		this.options = options;
	}

	mount() {
		this.containerEl = this.parentEl.createDiv('note-architect-search-container');
		this.inputEl = this.containerEl.createEl('input', {
			type: 'text',
			placeholder: this.options.placeholder ?? '搜索模板...',
			cls: 'note-architect-search-input'
		});

		this.inputEl.addEventListener('input', this.handleInput);
		this.inputEl.addEventListener('keydown', this.handleKeyDown);

		this.clearButtonEl = this.containerEl.createEl('button', {
			type: 'button',
			text: '×',
			cls: 'note-architect-search-clear'
		});
		this.clearButtonEl.title = '清空搜索';
		this.clearButtonEl.setAttribute('aria-label', '清空搜索');
		this.clearButtonEl.addEventListener('click', this.handleClear);

		if (this.options.initialQuery) {
			this.setQuery(this.options.initialQuery, false);
		} else {
			this.updateClearButtonVisibility('');
		}
	}

	unmount() {
		if (this.inputEl) {
			this.inputEl.removeEventListener('input', this.handleInput);
			this.inputEl.removeEventListener('keydown', this.handleKeyDown);
		}
		this.clearButtonEl?.removeEventListener('click', this.handleClear);

		this.containerEl?.empty();
		this.containerEl = null;
		this.inputEl = null;
		this.clearButtonEl = null;
	}

	focus() {
		this.inputEl?.focus();
	}

	setQuery(value: string, trigger = true) {
		if (!this.inputEl) return;
		this.inputEl.value = value;
		this.updateClearButtonVisibility(value);
		if (trigger) {
			this.options.onInput(value);
		}
	}

	private handleInput = (event: Event) => {
		const target = event.target as HTMLInputElement;
		this.updateClearButtonVisibility(target.value);
		this.options.onInput(target.value);
	};

	private handleKeyDown = (event: KeyboardEvent) => {
		this.options.onKeyDown(event);
	};

	private handleClear = () => {
		this.setQuery('', false);
		this.options.onClear();
		this.focus();
	};

	private updateClearButtonVisibility(value: string) {
		if (!this.clearButtonEl) return;
		this.clearButtonEl.style.display = value.trim() ? 'block' : 'none';
	}
}
