import { App } from 'obsidian';
import { TEMPLATER_DYNAMIC_MODE } from '@core/constants';
import type { Template, TemplaterPlugin } from '@types';
import type { TemplaterPort } from './TemplaterPort';

export class ObsidianTemplaterAdapter implements TemplaterPort {
	constructor(private app: App) {}

	isAvailable(): boolean {
		const plugin = this.getPlugin();
		return Boolean(
			plugin?.templater &&
			typeof plugin.templater.read_and_parse_template === 'function'
		);
	}

	async processTemplate(template: Template): Promise<string> {
		const plugin = this.getPlugin();
		if (!plugin?.templater || typeof plugin.templater.parse_template !== 'function') {
			throw new Error('Templater 插件未启用');
		}

		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			throw new Error('无法获取当前活动文件');
		}

		if (!template.path) {
			return await plugin.templater.parse_template({
				target_file: activeFile,
				run_mode: TEMPLATER_DYNAMIC_MODE,
				active_file: activeFile
			}, template.content);
		}

		if (typeof plugin.templater.read_and_parse_template !== 'function') {
			throw new Error('Templater API 不可用');
		}

		const abstractFile = this.app.vault.getAbstractFileByPath(template.path);
		if (!abstractFile || !('extension' in abstractFile) || abstractFile.extension !== 'md') {
			throw new Error('无法获取有效的 TFile 对象');
		}

		return await plugin.templater.read_and_parse_template({
			template_file: abstractFile,
			target_file: activeFile,
			run_mode: TEMPLATER_DYNAMIC_MODE,
			active_file: activeFile
		});
	}

	private getPlugin(): TemplaterPlugin | null {
		const pluginManager = (this.app as App & { plugins?: { getPlugin?: <T>(id: string) => T; plugins?: Record<string, unknown> } }).plugins;
		if (!pluginManager) return null;

		const plugin = pluginManager.getPlugin?.('templater-obsidian') ?? pluginManager.plugins?.['templater-obsidian'];
		return (plugin && typeof plugin === 'object' && 'templater' in plugin) ? plugin as TemplaterPlugin : null;
	}
}
