export type FrontmatterFieldType = "text" | "select" | "date" | "multi-select";

export interface FrontmatterField {
	key: string;
	type: FrontmatterFieldType;
	label: string;
	default: string;
	options?: string[];
}

export interface FrontmatterPreset {
	id: string;
	name: string;
	fields: FrontmatterField[];
}

export interface FastTemplaterSettings {
	templateFolderPath: string;
	enableTemplaterIntegration: boolean;
	enableFrontmatterMerge: boolean;
	frontmatterPresets: FrontmatterPreset[];
	recentlyUsedTemplates: string[]; // <-- 新增此行
}

export const DEFAULT_SETTINGS: FastTemplaterSettings = {
	templateFolderPath: "Templates",
	enableTemplaterIntegration: true,
	enableFrontmatterMerge: true,
	frontmatterPresets: [],
	recentlyUsedTemplates: [], // <-- 新增此行
};
