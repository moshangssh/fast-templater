export const mockNoticeConstructor = jest.fn();

export class App {}
export class Editor {}
export class MarkdownView {}
export class Modal {}
export class Notice {
    constructor(message: string) {
        mockNoticeConstructor(message);
    }
}
export class Plugin {
    app: any;
    manifest: any;
    constructor(app?: any, manifest?: any) {
        this.app = app;
        this.manifest = manifest;
    }
}
export class PluginSettingTab {}
export class Setting {}
export class Component {}
export class MarkdownRenderer {}
