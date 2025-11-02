import { App } from 'obsidian';
import type { FrontmatterPreset, Template } from '@types';
import { TemplatePresetBindingModal } from '@ui/template-preset-binding-modal';
import { runWithBusy } from '@utils/async-ui';

jest.mock('@utils/async-ui', () => ({
  runWithBusy: jest.fn(async (_element: unknown, task: () => Promise<unknown>) => {
    await task();
    return undefined;
  }),
}));

jest.mock('@utils/preset-matcher', () => ({
  PresetMatcher: {
    matchPresets: jest.fn((_template: Template, presets: FrontmatterPreset[]) =>
      presets.map((preset, index) => ({
        preset,
        score: 1 - index * 0.1,
        reasons: [],
      })),
    ),
  },
}));

const mockRunWithBusy = runWithBusy as jest.MockedFunction<typeof runWithBusy>;

const createTemplate = (): Template => ({
  id: 'template-001',
  name: '测试模板',
  path: 'Templates/template-001.md',
  content: '---\n---\n内容',
});

const createPresets = (): FrontmatterPreset[] => [
  { id: 'preset-a', name: '预设 A', fields: [] },
  { id: 'preset-b', name: '预设 B', fields: [] },
];

describe('TemplatePresetBindingModal 多重綁定支援', () => {
  const app = new App();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('建構函數會初始化 existingIds 並保存為集合', () => {
    const modal = new TemplatePresetBindingModal(app, {
      template: createTemplate(),
      presets: createPresets(),
      existingIds: ['preset-a', 'preset-a'],
      onBind: async () => {},
      onClear: async () => {},
    });

    const boundIds: Set<string> = (modal as unknown as { boundIds: Set<string> }).boundIds;
    const optionIds: string[] | undefined = (modal as unknown as { options: { existingIds?: string[] } }).options.existingIds;

    expect(Array.from(boundIds)).toEqual(['preset-a']);
    expect(optionIds).toEqual(['preset-a']);
  });

  it('isPresetBound 會正確回傳綁定狀態', () => {
    const modal = new TemplatePresetBindingModal(app, {
      template: createTemplate(),
      presets: createPresets(),
      existingIds: ['preset-a'],
      onBind: async () => {},
      onClear: async () => {},
    });

    const modalInternal = modal as unknown as { isPresetBound(id: string): boolean };

    expect(modalInternal.isPresetBound('preset-a')).toBe(true);
    expect(modalInternal.isPresetBound('preset-b')).toBe(false);
  });

  it('handleBind 成功後會更新狀態且不關閉視窗', async () => {
    const onBind = jest.fn().mockResolvedValue(undefined);
    const modal = new TemplatePresetBindingModal(app, {
      template: createTemplate(),
      presets: createPresets(),
      onBind,
      onClear: async () => {},
    });
    const modalInternal = modal as unknown as {
      boundIds: Set<string>;
      options: { existingIds?: string[] };
      renderPresetList: jest.Mock;
    };

    modal.close = jest.fn();
    modalInternal.renderPresetList = jest.fn();

    const buttonStub = { buttonEl: {} } as any;
    await (modal as unknown as { handleBind: (preset: FrontmatterPreset, button: any) => Promise<void> })
      .handleBind(createPresets()[0], buttonStub);

    expect(onBind).toHaveBeenCalledWith(expect.objectContaining({ id: 'preset-a' }));
    expect(mockRunWithBusy).toHaveBeenCalledWith(buttonStub.buttonEl, expect.any(Function), expect.objectContaining({
      errorContext: 'TemplatePresetBindingModal.handleBind',
    }));
    expect(modal.close).not.toHaveBeenCalled();
    expect(Array.from(modalInternal.boundIds)).toContain('preset-a');
    expect(modalInternal.options.existingIds).toEqual(['preset-a']);
    expect(modalInternal.renderPresetList).toHaveBeenCalledWith({ preserveScroll: true });
  });

  it('handleBind 會忽略已綁定的預設', async () => {
    const onBind = jest.fn();
    const modal = new TemplatePresetBindingModal(app, {
      template: createTemplate(),
      presets: createPresets(),
      existingIds: ['preset-a'],
      onBind,
      onClear: async () => {},
    });

    const modalInternal = modal as unknown as { renderPresetList: jest.Mock };
    modalInternal.renderPresetList = jest.fn();

    const buttonStub = { buttonEl: {} } as any;
    await (modal as unknown as { handleBind: (preset: FrontmatterPreset, button: any) => Promise<void> })
      .handleBind(createPresets()[0], buttonStub);

    expect(onBind).not.toHaveBeenCalled();
    expect(mockRunWithBusy).not.toHaveBeenCalled();
    expect(modalInternal.renderPresetList).not.toHaveBeenCalled();
  });

  it('handleClear 成功後會清空綁定並重新整理列表', async () => {
    const onClear = jest.fn().mockResolvedValue(undefined);
    const modal = new TemplatePresetBindingModal(app, {
      template: createTemplate(),
      presets: createPresets(),
      existingIds: ['preset-a'],
      onBind: async () => {},
      onClear,
    });
    const modalInternal = modal as unknown as {
      boundIds: Set<string>;
      options: { existingIds?: string[] };
      renderPresetList: jest.Mock;
    };
    modalInternal.renderPresetList = jest.fn();

    const buttonStub = { buttonEl: {} } as any;
    await (modal as unknown as { handleClear: (button: any) => Promise<void> }).handleClear(buttonStub);

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(mockRunWithBusy).toHaveBeenCalledWith(buttonStub.buttonEl, expect.any(Function), expect.objectContaining({
      errorContext: 'TemplatePresetBindingModal.handleClear',
    }));
    expect(Array.from(modalInternal.boundIds)).toHaveLength(0);
    expect(modalInternal.options.existingIds).toEqual([]);
    expect(modalInternal.renderPresetList).toHaveBeenCalledWith({ preserveScroll: true });
  });
});
