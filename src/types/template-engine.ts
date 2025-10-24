export interface TemplateProcessingResult {
	content: string;
	usedTemplater: boolean;
	error?: string;
}

export interface ParsedTemplateContent {
	frontmatter: Record<string, unknown>;
	body: string;
}

export interface TemplateInsertionResult {
	usedTemplater: boolean;
	templaterError?: string;
	mergedFrontmatter: Record<string, unknown>;
	mergeCount: number;
	frontmatterUpdated: boolean;
	templateBodyInserted: boolean;
	fallbackToBodyOnly: boolean;
}
