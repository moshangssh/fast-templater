import type { SaveSettingsOptions } from '@settings';

export class SettingsFacade {
	constructor(
		private readonly updateStatusBar?: () => void,
		private readonly reloadTemplates?: () => Promise<unknown>,
	) {}

	getDefaultSaveOptions(): SaveSettingsOptions {
		return {
			...(this.updateStatusBar && { onAfterSave: this.updateStatusBar }),
			...(this.reloadTemplates && { reloadTemplates: this.reloadTemplates }),
		};
	}
}
