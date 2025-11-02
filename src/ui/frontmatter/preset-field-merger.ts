import type { FrontmatterField, FrontmatterPreset } from '@types';

export interface OrderedField {
  field: FrontmatterField;
  order: number;
}

/**
 * 將 tags 欄位升級為 multi-select，並複製必要屬性避免修改原始預設
 */
export function upgradeTagsToMultiSelect(field: FrontmatterField): FrontmatterField {
  return {
    ...field,
    type: 'multi-select',
    options: field.options ? [...field.options] : [],
  };
}

/**
 * 合併 tags 欄位的選項並去重，保留原始順序
 */
export function mergeTagsOptions(
  existingOptions: string[] | undefined,
  incomingOptions: string[] | undefined,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  const append = (options?: string[]) => {
    if (!options) return;
    for (const option of options) {
      const trimmed = option.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      result.push(trimmed);
    }
  };

  append(existingOptions);
  append(incomingOptions);

  return result;
}

/**
 * 合併多個 tags 欄位定義，統一升級為 multi-select
 */
export function mergeTagsFields(tagFields: FrontmatterField[]): FrontmatterField | null {
  if (tagFields.length === 0) {
    return null;
  }

  let merged = upgradeTagsToMultiSelect(tagFields[0]);

  for (let index = 1; index < tagFields.length; index++) {
    const candidate = upgradeTagsToMultiSelect(tagFields[index]);
    merged = {
      ...merged,
      options: mergeTagsOptions(merged.options, candidate.options),
    };
  }

  return merged;
}

/**
 * 針對非 tags 欄位的衝突，採用第一個預設獲勝策略
 */
export function resolveFieldConflicts(fields: FrontmatterField[]): FrontmatterField | null {
  if (fields.length === 0) {
    return null;
  }

  const [winner] = fields;
  return { ...winner };
}

/**
 * 合併所有非 tags 欄位並保留最初的出現順序
 */
export function mergeNonTagsFields(presets: FrontmatterPreset[]): OrderedField[] {
  const buckets = new Map<string, FrontmatterField[]>();
  const firstOccurrence = new Map<string, number>();

  presets.forEach((preset, presetIndex) => {
    preset.fields.forEach((field, fieldIndex) => {
      if (field.key === 'tags') {
        return;
      }

      const order = presetIndex * 1000 + fieldIndex;
      if (!firstOccurrence.has(field.key)) {
        firstOccurrence.set(field.key, order);
      }

      const bucket = buckets.get(field.key) ?? [];
      bucket.push(field);
      buckets.set(field.key, bucket);
    });
  });

  const ordered: OrderedField[] = [];

  for (const [key, fields] of buckets.entries()) {
    const resolved = resolveFieldConflicts(fields);
    if (!resolved) continue;

    ordered.push({
      field: resolved,
      order: firstOccurrence.get(key) ?? Number.MAX_SAFE_INTEGER,
    });
  }

  ordered.sort((a, b) => a.order - b.order);
  return ordered;
}

export interface MergePresetResult {
  mergedPreset: FrontmatterPreset;
  sourcePresetIds: string[];
}

/**
 * 將多個預設合併為單一的 frontmatter 預設定義
 */
export function createMergedPreset(presets: FrontmatterPreset[]): MergePresetResult {
  if (presets.length === 0) {
    return {
      mergedPreset: {
        id: 'merged-empty',
        name: '合併預設',
        fields: [],
      },
      sourcePresetIds: [],
    };
  }

  const sourcePresetIds = presets.map(preset => preset.id);
  const tagFields: FrontmatterField[] = [];

  presets.forEach((preset) => {
    preset.fields.forEach((field) => {
      if (field.key === 'tags') {
        tagFields.push(field);
      }
    });
  });

  const mergedTags = mergeTagsFields(tagFields);
  const tagOrder = presets.reduce<number | null>((current, preset, presetIndex) => {
    const innerIndex = preset.fields.findIndex(field => field.key === 'tags');
    if (innerIndex < 0) {
      return current;
    }
    const computedOrder = presetIndex * 1000 + innerIndex;
    if (current === null || computedOrder < current) {
      return computedOrder;
    }
    return current;
  }, null);

  const mergedNonTags = mergeNonTagsFields(presets);

  const fieldEntries: OrderedField[] = [...mergedNonTags];
  if (mergedTags && tagOrder !== null) {
    fieldEntries.push({
      field: mergedTags,
      order: tagOrder,
    });
  }

  fieldEntries.sort((a, b) => a.order - b.order);

  const mergedPreset: FrontmatterPreset = {
    id: presets[0].id,
    name: presets.map(preset => preset.name).join(' + '),
    description: presets.length > 1 ? `合併自：${presets.map(preset => preset.name).join('、')}` : presets[0].description,
    fields: fieldEntries.map(entry => ({ ...entry.field })),
  };

  return {
    mergedPreset,
    sourcePresetIds,
  };
}
