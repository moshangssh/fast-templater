import type { FrontmatterPreset, Template } from '@types';
import * as TemplateEngine from '@engine';

export interface PresetMatchResult {
	preset: FrontmatterPreset;
	score: number;
	reasons: string[];
}

export interface PresetMatchOptions {
	enableContentAnalysis?: boolean;
	enableFieldNameMatching?: boolean;
	enableFieldCountScoring?: boolean;
	contentWeight?: number;
	fieldNameWeight?: number;
	fieldCountWeight?: number;
}

export class PresetMatcher {
	private static readonly DEFAULT_OPTIONS: Required<PresetMatchOptions> = {
		enableContentAnalysis: true,
		enableFieldNameMatching: true,
		enableFieldCountScoring: true,
		contentWeight: 0.4,
		fieldNameWeight: 0.4,
		fieldCountWeight: 0.2,
	};

	/**
	 * 为给定模板匹配最合适的预设
	 * @param template 模板对象
	 * @param presets 可用预设列表
	 * @param options 匹配选项
	 * @returns 匹配结果列表，按评分降序排列
	 */
	static matchPresets(
		template: Template,
		presets: FrontmatterPreset[],
		options: PresetMatchOptions = {}
	): PresetMatchResult[] {
		const opts = { ...this.DEFAULT_OPTIONS, ...options };
		const results: PresetMatchResult[] = [];

		for (const preset of presets) {
			const result = this.calculateMatchScore(template, preset, opts);
			results.push(result);
		}

		// 按评分降序排列
		return results.sort((a, b) => b.score - a.score);
	}

	/**
	 * 获取最佳匹配预设
	 * @param template 模板对象
	 * @param presets 可用预设列表
	 * @param options 匹配选项
	 * @returns 最佳匹配预设，如果没有匹配则返回null
	 */
	static getBestMatch(
		template: Template,
		presets: FrontmatterPreset[],
		options: PresetMatchOptions = {}
	): PresetMatchResult | null {
		const results = this.matchPresets(template, presets, options);
		return results.length > 0 && results[0].score > 0 ? results[0] : null;
	}

	/**
	 * 计算模板与预设的匹配评分
	 * @param template 模板对象
	 * @param preset 预设对象
	 * @param options 匹配选项
	 * @returns 匹配结果
	 */
	private static calculateMatchScore(
		template: Template,
		preset: FrontmatterPreset,
		options: Required<PresetMatchOptions>
	): PresetMatchResult {
		const reasons: string[] = [];
		let totalScore = 0;

		// 1. 内容分析评分
		if (options.enableContentAnalysis) {
			const contentScore = this.calculateContentScore(template, preset);
			if (contentScore > 0) {
				totalScore += contentScore * options.contentWeight;
				reasons.push(`内容匹配度: ${Math.round(contentScore * 100)}%`);
			}
		}

		// 2. 字段名匹配评分
		if (options.enableFieldNameMatching) {
			const fieldNameScore = this.calculateFieldNameScore(template, preset);
			if (fieldNameScore > 0) {
				totalScore += fieldNameScore * options.fieldNameWeight;
				reasons.push(`字段名匹配度: ${Math.round(fieldNameScore * 100)}%`);
			}
		}

		// 3. 字段数量评分
		if (options.enableFieldCountScoring) {
			const fieldCountScore = this.calculateFieldCountScore(template, preset);
			if (fieldCountScore > 0) {
				totalScore += fieldCountScore * options.fieldCountWeight;
				reasons.push(`字段数量匹配度: ${Math.round(fieldCountScore * 100)}%`);
			}
		}

		// 基础评分（至少有字段定义）
		if (preset.fields && preset.fields.length > 0 && totalScore === 0) {
			totalScore = 0.1; // 给一个很小的基础分
			reasons.push('基础匹配：预设包含字段定义');
		}

		return {
			preset,
			score: Math.min(totalScore, 1.0), // 确保评分不超过1.0
			reasons,
		};
	}

	/**
	 * 计算内容匹配评分
	 */
	private static calculateContentScore(template: Template, preset: FrontmatterPreset): number {
		if (!preset.fields || preset.fields.length === 0) return 0;

		const templateContent = template.content.toLowerCase();
		let totalMatches = 0;
		let totalPossibleMatches = 0;

		for (const field of preset.fields) {
			totalPossibleMatches++;

			// 检查字段键是否在模板内容中出现
			if (field.key && templateContent.includes(field.key.toLowerCase())) {
				totalMatches++;
				continue;
			}

			// 检查字段标签或相关词汇
			const keywords = this.getFieldKeywords(field);
			const hasKeywordMatch = keywords.some(keyword =>
				templateContent.includes(keyword.toLowerCase())
			);
			if (hasKeywordMatch) {
				totalMatches++;
			}
		}

		return totalPossibleMatches > 0 ? totalMatches / totalPossibleMatches : 0;
	}

	/**
	 * 计算字段名匹配评分
	 */
	private static calculateFieldNameScore(template: Template, preset: FrontmatterPreset): number {
		if (!preset.fields || preset.fields.length === 0) return 0;

		// 解析模板中的变量引用
		const templateVars = this.extractTemplateVariables(template.content);
		if (templateVars.length === 0) return 0;

		let matches = 0;
		for (const field of preset.fields) {
			if (templateVars.includes(field.key)) {
				matches++;
			}
		}

		return matches / templateVars.length;
	}

	/**
	 * 计算字段数量匹配评分
	 */
	private static calculateFieldCountScore(template: Template, preset: FrontmatterPreset): number {
		if (!preset.fields || preset.fields.length === 0) return 0;

		// 解析模板中的变量引用数量
		const templateVarCount = this.extractTemplateVariables(template.content).length;
		if (templateVarCount === 0) return 0;

		const presetFieldCount = preset.fields.length;

		// 计算数量匹配度，越接近越高分
		const ratio = Math.min(presetFieldCount, templateVarCount) / Math.max(presetFieldCount, templateVarCount);
		return ratio;
	}

	/**
	 * 提取模板中的变量引用
	 */
	private static extractTemplateVariables(content: string): string[] {
		const variables = new Set<string>();

		// 匹配 {{variable}} 格式的变量
		const varMatches = content.match(/\{\{([^}]+)\}\}/g);
		if (varMatches) {
			for (const match of varMatches) {
				const varName = match.slice(2, -2).trim();
				variables.add(varName);
			}
		}

		// 匹配 frontmatter 中的变量引用
		const templateData = TemplateEngine.parseTemplateContent(content);
		if (templateData.frontmatter) {
			for (const [key, value] of Object.entries(templateData.frontmatter)) {
				if (typeof value === 'string' && value.includes('{{')) {
					variables.add(key);
				}
			}
		}

		return Array.from(variables);
	}

	/**
	 * 获取字段相关的关键词
	 */
	private static getFieldKeywords(field: import('@types').FrontmatterField): string[] {
		const keywords: string[] = [];

		if (field.key) {
			keywords.push(field.key);
		}

		if (field.label) {
			keywords.push(field.label);
		}

		// 根据字段类型添加相关关键词
		switch (field.type) {
			case 'date':
				keywords.push('日期', '时间', 'date', 'time', '创建', '更新');
				break;
			case 'text':
				keywords.push('文本', '内容', '描述', 'text', 'content', 'description');
				break;
			case 'multi-select':
				keywords.push('多选', '标签', '分类', 'tags', 'categories', 'multi-select');
				break;
			case 'select':
				keywords.push('选择', '选项', '类型', 'select', 'option', 'type');
				break;
		}

		return keywords;
	}

	/**
	 * 获取预设的推荐语
	 */
	static getRecommendationText(result: PresetMatchResult): string {
		if (result.score >= 0.8) {
			return `强烈推荐：${result.preset.name}（高度匹配）`;
		} else if (result.score >= 0.5) {
			return `推荐：${result.preset.name}（匹配度良好）`;
		} else if (result.score >= 0.3) {
			return `可考虑：${result.preset.name}（部分匹配）`;
		} else {
			return `${result.preset.name}（匹配度较低）`;
		}
	}
}