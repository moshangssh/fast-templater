export type FrontmatterFieldType = "text" | "select" | "date" | "multi-select";

export interface FrontmatterField {
	key: string;
	type: FrontmatterFieldType;
	label: string;
	default: string;
	options?: string[];
	useTemplaterTimestamp?: boolean;
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
	defaultDateFormat: string;
	recentlyUsedTemplates: string[]; // <-- 新增此行
}

export const DEFAULT_SETTINGS: FastTemplaterSettings = {
	templateFolderPath: "Templates",
	enableTemplaterIntegration: true,
	enableFrontmatterMerge: true,
	frontmatterPresets: [],
	defaultDateFormat: "YYYYMMDDHHmmss",
	recentlyUsedTemplates: [], // <-- 新增此行
};
