import { Plugin } from 'obsidian';
import type { FrontmatterPreset } from '@types';
import { UiRegistrar } from '@core/UiRegistrar';
import { notifyInfo, notifySuccess } from '@utils/notify';

jest.mock('@ui', () => {
  const mockTemplatePresetBindingModal = jest.fn().mockImplementation((_app, _options) => ({
    open: jest.fn(),
  }));

  return {
    TemplatePresetBindingModal: mockTemplatePresetBindingModal,
    TemplateSelectorModal: jest.fn(),
    NoteArchitectSettingTab: jest.fn(),
  };
});

jest.mock('@utils/notify', () => ({
  notifyInfo: jest.fn(),
  notifySuccess: jest.fn(),
  notifyWarning: jest.fn(),
}));

const mockTemplatePresetBindingModal = require('@ui').TemplatePresetBindingModal as jest.Mock;

describe('UiRegistrar note-architect-config 綁定流程', () => {
  const presets: FrontmatterPreset[] = [
    { id: 'preset-a', name: '预设 A', fields: [] },
    { id: 'preset-b', name: '预设 B', fields: [] },
  ];

  const createVault = (content: string) => ({
    read: jest.fn().mockResolvedValue(content),
    modify: jest.fn().mockResolvedValue(undefined),
  });

  const createRegistrar = (content: string) => {
    const vault = createVault(content);
    const app = { vault } as any;
    const manifest = { id: 'fast-templater' } as any;
    const plugin = {
      app,
      manifest,
      addRibbonIcon: jest.fn().mockReturnValue({ addClass: jest.fn() }),
      addCommand: jest.fn(),
      addSettingTab: jest.fn(),
    } as unknown as Plugin & {
      templateManager: { reloadTemplates: jest.Mock };
    };
    plugin.templateManager = { reloadTemplates: jest.fn() } as any;

    const presetManager = {
      getPresets: jest.fn().mockReturnValue(presets),
    };

    const settingsManager = {};

    const registrar = new UiRegistrar(plugin, settingsManager as any, presetManager as any);
    return { registrar, vault, presetManager, plugin };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('openTemplatePresetBindingModal 會標準化 existingIds 並傳遞到模態視窗', async () => {
    const { registrar } = createRegistrar(`---
note-architect-config:
  - preset-a
  - preset-b
---`);

    const file = { path: 'Templates/demo.md', basename: 'demo', extension: 'md' } as any;
    await (registrar as any).openTemplatePresetBindingModal(file);

    expect(mockTemplatePresetBindingModal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        existingIds: ['preset-a', 'preset-b'],
        onBind: expect.any(Function),
        onClear: expect.any(Function),
      }),
    );
  });

  it('bindPresetToTemplate 會將 note-architect-config 寫成陣列並保持去重', async () => {
    const { registrar, vault, plugin } = createRegistrar(`---
note-architect-config: preset-a
---`);

    const file = { path: 'Templates/demo.md', basename: 'demo' } as any;
    await (registrar as any).bindPresetToTemplate(file, presets[1]);

    expect(vault.modify).toHaveBeenCalledTimes(1);
    const updatedContent = (vault.modify as jest.Mock).mock.calls[0][1] as string;
    expect(updatedContent).toContain('note-architect-config:');
    expect(updatedContent).toContain('- preset-a');
    expect(updatedContent).toContain('- preset-b');
    expect(notifySuccess).toHaveBeenCalledWith('模板 “demo” 已绑定预设 “预设 B”。');
    expect(plugin.templateManager.reloadTemplates).toHaveBeenCalled();
  });

  it('bindPresetToTemplate 重複綁定時僅提示不重寫', async () => {
    const { registrar, vault } = createRegistrar(`---
note-architect-config:
  - preset-a
---`);

    const file = { path: 'Templates/demo.md', basename: 'demo' } as any;
    await (registrar as any).bindPresetToTemplate(file, presets[0]);

    expect(vault.modify).not.toHaveBeenCalled();
    expect(notifyInfo).toHaveBeenCalledWith('模板已绑定到预设 “预设 A”。');
  });

  it('clearPresetBinding 會移除 note-architect-config 並重新整理模板', async () => {
    const { registrar, vault, plugin } = createRegistrar(`---
note-architect-config:
  - preset-a
  - preset-b
---`);

    const file = { path: 'Templates/demo.md', basename: 'demo' } as any;
    await (registrar as any).clearPresetBinding(file);

    expect(vault.modify).toHaveBeenCalledTimes(1);
    const updatedContent = (vault.modify as jest.Mock).mock.calls[0][1] as string;
    expect(updatedContent).not.toContain('note-architect-config');
    expect(notifySuccess).toHaveBeenCalledWith('模板 “demo” 已解除预设绑定。');
    expect(plugin.templateManager.reloadTemplates).toHaveBeenCalled();
  });

  it('clearPresetBinding 在沒有綁定時僅提示使用者', async () => {
    const { registrar, vault } = createRegistrar(`---
title: demo
---`);

    const file = { path: 'Templates/demo.md', basename: 'demo' } as any;
    await (registrar as any).clearPresetBinding(file);

    expect(vault.modify).not.toHaveBeenCalled();
    expect(notifyInfo).toHaveBeenCalledWith('当前模板未绑定任何预设。');
  });
});
