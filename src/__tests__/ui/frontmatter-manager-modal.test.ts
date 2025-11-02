import type { FrontmatterField, FrontmatterPreset } from '@types';
import {
  upgradeTagsToMultiSelect,
  mergeTagsOptions,
  mergeTagsFields,
  resolveFieldConflicts,
  mergeNonTagsFields,
  createMergedPreset,
} from '@ui/frontmatter/preset-field-merger';

describe('preset-field-merger: tags 處理', () => {
  it('upgradeTagsToMultiSelect 會產生新物件並設為 multi-select', () => {
    const original: FrontmatterField = {
      key: 'tags',
      label: 'Tags',
      type: 'select',
      default: '',
      options: ['A'],
    };

    const upgraded = upgradeTagsToMultiSelect(original);
    expect(upgraded).not.toBe(original);
    expect(upgraded.type).toBe('multi-select');
    expect(upgraded.options).toEqual(['A']);
    expect(original.type).toBe('select');
  });

  it('mergeTagsOptions 會保留原始順序並去重', () => {
    expect(mergeTagsOptions(['A', 'B'], ['B', 'C', ' '])).toEqual(['A', 'B', 'C']);
  });

  it('mergeTagsFields 會統一升級並合併選項', () => {
    const merged = mergeTagsFields([
      {
        key: 'tags',
        label: 'Tags',
        type: 'select',
        default: 'A',
        options: ['A', 'B'],
      },
      {
        key: 'tags',
        label: '分類',
        type: 'multi-select',
        default: '',
        options: ['B', 'C'],
      },
    ]);

    expect(merged).not.toBeNull();
    expect(merged?.type).toBe('multi-select');
    expect(merged?.options).toEqual(['A', 'B', 'C']);
  });
});

describe('preset-field-merger: 非 tags 欄位', () => {
  it('resolveFieldConflicts 採用第一個預設獲勝策略', () => {
    const winner = resolveFieldConflicts([
      { key: 'status', label: '狀態', type: 'text', default: 'draft' },
      { key: 'status', label: 'Status', type: 'select', default: '', options: ['todo'] },
    ]);

    expect(winner).toEqual({ key: 'status', label: '狀態', type: 'text', default: 'draft' });
  });

  it('mergeNonTagsFields 會保留首度出現的順序', () => {
    const presets: FrontmatterPreset[] = [
      {
        id: 'preset-a',
        name: 'A',
        fields: [
          { key: 'status', label: '狀態', type: 'text', default: 'draft' },
          { key: 'priority', label: '優先級', type: 'select', default: '', options: ['High'] },
        ],
      },
      {
        id: 'preset-b',
        name: 'B',
        fields: [
          { key: 'priority', label: 'Priority', type: 'select', default: '', options: ['Low'] },
          { key: 'reviewer', label: '審核人', type: 'text', default: '' },
        ],
      },
    ];

    const merged = mergeNonTagsFields(presets);
    expect(merged.map(item => item.field.key)).toEqual(['status', 'priority', 'reviewer']);
    expect(merged[1].field.options).toEqual(['High']);
  });
});

describe('preset-field-merger: createMergedPreset', () => {
  it('可以合併多個預設並保留欄位順序', () => {
    const presets: FrontmatterPreset[] = [
      {
        id: 'preset-a',
        name: 'A',
        fields: [
          { key: 'title', label: '標題', type: 'text', default: '' },
          { key: 'tags', label: '標籤', type: 'select', default: '', options: ['Tech'] },
        ],
      },
      {
        id: 'preset-b',
        name: 'B',
        fields: [
          { key: 'tags', label: '分類', type: 'multi-select', default: '', options: ['Design'] },
          { key: 'status', label: '狀態', type: 'select', default: '', options: ['todo'] },
        ],
      },
    ];

    const { mergedPreset, sourcePresetIds } = createMergedPreset(presets);

    expect(sourcePresetIds).toEqual(['preset-a', 'preset-b']);
    expect(mergedPreset.fields.map(field => field.key)).toEqual(['title', 'tags', 'status']);
    const tagsField = mergedPreset.fields.find(field => field.key === 'tags');
    expect(tagsField?.type).toBe('multi-select');
    expect(tagsField?.options).toEqual(['Tech', 'Design']);
  });
});
