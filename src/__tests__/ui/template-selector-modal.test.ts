import type { FrontmatterPreset } from '@types';
import { normalizeConfigIds, collectMatchingPresets } from '@utils/note-architect-config';

describe('normalizeConfigIds', () => {
  it('將單一字串標準化為陣列', () => {
    expect(normalizeConfigIds('preset-a')).toEqual(['preset-a']);
  });

  it('過濾無效值並去重', () => {
    const raw = ['preset-a', '  ', 42, 'preset-b', 'preset-a'];
    expect(normalizeConfigIds(raw)).toEqual(['preset-a', 'preset-b']);
  });

  it('對於非支援型別返回空陣列', () => {
    expect(normalizeConfigIds(undefined)).toEqual([]);
    expect(normalizeConfigIds(123)).toEqual([]);
  });
});

describe('collectMatchingPresets', () => {
  const availablePresets: FrontmatterPreset[] = [
    { id: 'preset-a', name: 'Preset A', fields: [] },
    { id: 'preset-b', name: 'Preset B', fields: [] },
  ];

  it('依照配置順序返回匹配的預設並跳過重複', () => {
    const { matched, missing } = collectMatchingPresets(
      ['preset-b', 'preset-c', 'preset-b', 'preset-a'],
      availablePresets,
    );

    expect(matched.map(preset => preset.id)).toEqual(['preset-b', 'preset-a']);
    expect(missing).toEqual(['preset-c']);
  });

  it('當沒有任何匹配時返回空結果', () => {
    const { matched, missing } = collectMatchingPresets(['unknown'], availablePresets);
    expect(matched).toEqual([]);
    expect(missing).toEqual(['unknown']);
  });
});
