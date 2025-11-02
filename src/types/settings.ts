export type FrontmatterFieldType = 'text' | 'select' | 'date' | 'multi-select';

export interface FrontmatterField {
  key: string;
  type: FrontmatterFieldType;
  label: string;
  default: string;
  options?: string[];
  useTemplaterTimestamp?: boolean;
  description?: string;
}

export interface FrontmatterPreset {
  id: string;
  name: string;
  fields: FrontmatterField[];
  description?: string;
}

export interface NoteArchitectSettings {
  templateFolderPath: string;
  enableTemplaterIntegration: boolean;
  enableFrontmatterMerge: boolean;
  frontmatterPresets: FrontmatterPreset[];
  defaultDateFormat: string;
  recentlyUsedTemplates: string[];
  enableDynamicPresetSelection: boolean;
}

export const DEFAULT_SETTINGS: NoteArchitectSettings = {
  templateFolderPath: 'Templates',
  enableTemplaterIntegration: true,
  enableFrontmatterMerge: true,
  frontmatterPresets: [],
  defaultDateFormat: 'YYYYMMDDHHmmss',
  recentlyUsedTemplates: [],
  enableDynamicPresetSelection: true,
};
