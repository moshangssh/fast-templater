import type { FrontmatterPreset } from '@types';

/**
 * 將 frontmatter 中的 note-architect-config 值標準化為唯一且有序的 ID 陣列
 */
export function normalizeConfigIds(rawValue: unknown): string[] {
  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim();
    return trimmed ? [trimmed] : [];
  }

  if (Array.isArray(rawValue)) {
    const seen = new Set<string>();
    const normalized: string[] = [];

    for (const candidate of rawValue) {
      if (typeof candidate !== 'string') continue;
      const trimmed = candidate.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      normalized.push(trimmed);
    }

    return normalized;
  }

  return [];
}

export interface CollectMatchingPresetsResult {
  matched: FrontmatterPreset[];
  missing: string[];
}

/**
 * 根據標準化後的 ID 陣列收集對應的預設，並保留順序
 */
export function collectMatchingPresets(
  configIds: string[],
  availablePresets: FrontmatterPreset[],
): CollectMatchingPresetsResult {
  if (configIds.length === 0) {
    return { matched: [], missing: [] };
  }

  const presetMap = new Map<string, FrontmatterPreset>();
  for (const preset of availablePresets) {
    presetMap.set(preset.id, preset);
  }

  const matched: FrontmatterPreset[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();

  for (const id of configIds) {
    if (seen.has(id)) continue;
    seen.add(id);

    const preset = presetMap.get(id);
    if (preset) {
      matched.push(preset);
    } else {
      missing.push(id);
    }
  }

  return { matched, missing };
}
