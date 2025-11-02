import { App, Modal, Setting } from 'obsidian';
import type NoteArchitect from '@core/plugin';
import type { FrontmatterPreset, Template } from '@types';
import { handleError } from '@core/error';
import { notifyInfo, notifyWarning } from '@utils/notify';
import { PresetMatcher, type PresetMatchResult } from '@utils/preset-matcher';

export class DynamicPresetSelectorModal extends Modal {
	private plugin: NoteArchitect;
	private template: Template;
	private onPresetSelected: (preset: FrontmatterPreset | null) => void;
	private searchQuery = '';
	private filteredPresets: PresetMatchResult[] = [];
	private selectedPresetIndex = 0;
	private matchResults: PresetMatchResult[] = [];
	private showRecommendations = true;

	constructor(
		app: App,
		plugin: NoteArchitect,
		template: Template,
		onPresetSelected: (preset: FrontmatterPreset | null) => void
	) {
		super(app);
		this.plugin = plugin;
		this.template = template;
		this.onPresetSelected = onPresetSelected;

		// 计算智能匹配结果
		this.matchResults = PresetMatcher.matchPresets(
			template,
			this.plugin.settings.frontmatterPresets,
			{
				enableContentAnalysis: true,
				enableFieldNameMatching: true,
				enableFieldCountScoring: true,
			}
		);

		this.filteredPresets = [...this.matchResults];
	}

	onOpen() {
		const { contentEl } = this;

		// 设置模态窗口大小
		this.modalEl.style.width = '90vw';
		this.modalEl.style.maxWidth = '600px';
		this.modalEl.style.height = 'auto';
		this.modalEl.style.maxHeight = '80vh';

		// 创建标题
		contentEl.createEl('h2', {
			text: '选择预设',
			cls: 'note-architect-form-title'
		});

		// 创建说明区域
		const descriptionContainer = contentEl.createDiv('note-architect-form-description');
		descriptionContainer.createEl('p', {
			text: `模板 "${this.template.name}" 未配置预设，请从现有预设中选择一个：`,
			cls: 'note-architect-form-description-text'
		});

		// 添加智能推荐提示
		const hasRecommendations = this.matchResults.some(r => r.score >= 0.5);
		if (hasRecommendations) {
			const recommendationHint = descriptionContainer.createEl('p', {
				text: '🎯 已为您智能推荐匹配度较高的预设',
				cls: 'note-architect-recommendation-hint'
			});
			recommendationHint.style.fontSize = '12px';
			recommendationHint.style.color = 'var(--text-accent)';
			recommendationHint.style.marginTop = '5px';
		}

		// 搜索和过滤选项
		const searchContainer = contentEl.createDiv('note-architect-search-container');
		searchContainer.style.display = 'flex';
		searchContainer.style.alignItems = 'center';
		searchContainer.style.gap = '10px';
		searchContainer.style.marginBottom = '15px';

		const searchInput = searchContainer.createEl('input', {
			type: 'text',
			placeholder: '搜索预设...',
			cls: 'note-architect-search-input'
		});
		searchInput.style.flex = '1';

		// 添加显示推荐选项
		const showRecommendationsLabel = searchContainer.createEl('label', {
			text: '显示推荐',
			cls: 'note-architect-checkbox-label'
		});
		showRecommendationsLabel.style.display = 'flex';
		showRecommendationsLabel.style.alignItems = 'center';
		showRecommendationsLabel.style.fontSize = '12px';
		showRecommendationsLabel.style.cursor = 'pointer';

		const showRecommendationsCheckbox = showRecommendationsLabel.createEl('input', {
			type: 'checkbox',
		});
		showRecommendationsCheckbox.checked = this.showRecommendations;
		showRecommendationsCheckbox.style.marginRight = '5px';

		showRecommendationsCheckbox.addEventListener('change', (e) => {
			this.showRecommendations = (e.target as HTMLInputElement).checked;
			applyFilters();
		});

		// 创建预设列表容器
		const presetListContainer = contentEl.createDiv('note-architect-preset-list-container');
		presetListContainer.style.maxHeight = '300px';
		presetListContainer.style.overflowY = 'auto';

		// 过滤方法
		const applyFilters = () => {
			let filtered = [...this.matchResults];

			// 应用搜索过滤
			if (this.searchQuery) {
				filtered = filtered.filter(result => {
					const preset = result.preset;
					return preset.name.toLowerCase().includes(this.searchQuery.toLowerCase()) ||
						   preset.id.toLowerCase().includes(this.searchQuery.toLowerCase());
				});
			}

			// 应用推荐过滤
			if (this.showRecommendations) {
				filtered.sort((a, b) => b.score - a.score);
			}

			this.filteredPresets = filtered;
			this.selectedPresetIndex = 0;
			renderPresetList();
		};

		// 创建预设���表
		const renderPresetList = () => {
			presetListContainer.empty();

			if (this.filteredPresets.length === 0) {
				const emptyMessage = presetListContainer.createDiv('note-architect-empty-message');
				emptyMessage.textContent = this.searchQuery
					? '未找到匹配的预设'
					: '暂无可用预设，请先在设置中创建预设';
				return;
			}

			this.filteredPresets.forEach((matchResult, index) => {
				const preset = matchResult.preset;
				const presetItem = presetListContainer.createDiv('note-architect-preset-item');
				presetItem.style.padding = '12px';
				presetItem.style.border = '1px solid var(--background-modifier-border)';
				presetItem.style.borderRadius = '6px';
				presetItem.style.marginBottom = '8px';
				presetItem.style.cursor = 'pointer';
				presetItem.style.transition = 'all 0.2s ease';

				// 高亮选中项
				if (index === this.selectedPresetIndex) {
					presetItem.style.backgroundColor = 'var(--background-modifier-hover)';
					presetItem.style.borderColor = 'var(--interactive-accent)';
				}

				// 推荐标识
				if (matchResult.score >= 0.5) {
					const recommendationBadge = presetItem.createEl('span', {
						text: this.getRecommendationBadge(matchResult.score),
						cls: 'note-architect-recommendation-badge'
					});
					recommendationBadge.style.display = 'inline-block';
					recommendationBadge.style.padding = '2px 6px';
					recommendationBadge.style.borderRadius = '3px';
					recommendationBadge.style.fontSize = '10px';
					recommendationBadge.style.fontWeight = 'bold';
					recommendationBadge.style.marginBottom = '6px';

					if (matchResult.score >= 0.8) {
						recommendationBadge.style.backgroundColor = 'var(--background-modifier-success)';
						recommendationBadge.style.color = 'var(--text-on-accent)';
					} else {
						recommendationBadge.style.backgroundColor = 'var(--background-modifier-accent)';
						recommendationBadge.style.color = 'var(--text-accent)';
					}
				}

				// 预设名称
				const nameEl = presetItem.createEl('div', {
					text: preset.name,
					cls: 'note-architect-preset-name'
				});
				nameEl.style.fontWeight = 'bold';
				nameEl.style.marginBottom = '4px';

				// 预设ID
				const idEl = presetItem.createEl('div', {
					text: `ID: ${preset.id}`,
					cls: 'note-architect-preset-id'
				});
				idEl.style.fontSize = '12px';
				idEl.style.color = 'var(--text-muted)';

				// 匹配度和字段数量
				const fieldsCount = preset.fields?.length || 0;
				const metaInfo = presetItem.createEl('div', {
					text: `字段: ${fieldsCount} | 匹配度: ${Math.round(matchResult.score * 100)}%`,
					cls: 'note-architect-preset-meta'
				});
				metaInfo.style.fontSize = '12px';
				metaInfo.style.color = 'var(--text-muted)';
				metaInfo.style.marginTop = '4px';

				// 匹配原因（如果有）
				if (matchResult.reasons.length > 0) {
					const reasonsEl = presetItem.createEl('div', {
						text: `✓ ${matchResult.reasons.join(', ')}`,
						cls: 'note-architect-match-reasons'
					});
					reasonsEl.style.fontSize = '11px';
					reasonsEl.style.color = 'var(--text-accent)';
					reasonsEl.style.marginTop = '4px';
					reasonsEl.style.fontStyle = 'italic';
				}

				// 鼠标悬停效果
				presetItem.addEventListener('mouseenter', () => {
					presetItem.style.backgroundColor = 'var(--background-modifier-hover)';
				});

				presetItem.addEventListener('mouseleave', () => {
					if (index !== this.selectedPresetIndex) {
						presetItem.style.backgroundColor = '';
					}
				});

				// 点击选择预设
				presetItem.addEventListener('click', () => {
					this.selectPreset(matchResult.preset);
				});
			});
		};

		// 搜索功能
		searchInput.addEventListener('input', (e) => {
			this.searchQuery = (e.target as HTMLInputElement).value;
			applyFilters();
		});

		// 键盘导航
		searchInput.addEventListener('keydown', (e) => {
			switch (e.key) {
				case 'ArrowDown':
					e.preventDefault();
					this.selectedPresetIndex = Math.min(
						this.selectedPresetIndex + 1,
						this.filteredPresets.length - 1
					);
					renderPresetList();
					break;
				case 'ArrowUp':
					e.preventDefault();
					this.selectedPresetIndex = Math.max(this.selectedPresetIndex - 1, 0);
					renderPresetList();
					break;
				case 'Enter':
					e.preventDefault();
					if (this.filteredPresets[this.selectedPresetIndex]) {
						this.selectPreset(this.filteredPresets[this.selectedPresetIndex].preset);
					}
					break;
				case 'Escape':
					this.close();
					break;
			}
		});

		// 按钮区域
		const buttonContainer = contentEl.createDiv('note-architect-button-container');
		buttonContainer.style.display = 'flex';
		buttonContainer.style.justifyContent = 'flex-end';
		buttonContainer.style.gap = '10px';
		buttonContainer.style.marginTop = '20px';

		// 取消按钮
		const cancelButton = buttonContainer.createEl('button', {
			text: '取消',
			cls: 'mod-cta'
		});
		cancelButton.style.padding = '8px 16px';
		cancelButton.addEventListener('click', () => {
			this.close();
		});

		// 直接插入按钮（不使用预设）
		const directInsertButton = buttonContainer.createEl('button', {
			text: '直接插入模板',
			cls: 'mod-cta'
		});
		directInsertButton.style.padding = '8px 16px';
		directInsertButton.addEventListener('click', () => {
			this.onDirectInsert();
		});

		// 初始渲染
		renderPresetList();

		// 自动聚焦搜索框
		setTimeout(() => {
			searchInput.focus();
		}, 100);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}

	private selectPreset(preset: FrontmatterPreset) {
		try {
			notifyInfo(`已选择预设: ${preset.name}`);
			this.onPresetSelected(preset);
			this.close();
		} catch (error) {
			handleError(error, { context: '选择预设时发生错误' });
		}
	}

	private onDirectInsert() {
		try {
			notifyInfo('将直接插入模板，不使用预设');
			this.onPresetSelected(null);
			this.close();
		} catch (error) {
			handleError(error, { context: '直接插入模板时发生错误' });
		}
	}

	private getRecommendationBadge(score: number): string {
		if (score >= 0.8) {
			return '强烈推荐';
		} else if (score >= 0.5) {
			return '推荐';
		} else if (score >= 0.3) {
			return '可考虑';
		} else {
			return '';
		}
	}
}