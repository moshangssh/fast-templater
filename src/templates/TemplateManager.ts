import { Notice, type App, TFile } from "obsidian";
import type { FastTemplaterSettings, Template, TemplateLoadResult } from "@types";
import { TemplateLoadStatus } from "@types";

type SettingsResolver = () => FastTemplaterSettings;

/**
 * 模板管理器负责处理模板文件的加载、缓存与检索，保持插件主类的单一职责。
 */
export class TemplateManager {
	private templates: Template[] = [];
	private loadResult: TemplateLoadResult = {
		status: TemplateLoadStatus.IDLE,
		count: 0,
	};

	constructor(
		private readonly app: App,
		private readonly resolveSettings: SettingsResolver,
	) {}

	/**
	 * 规范化路径，移除首尾空格和斜杠。
	 */
	private normalizePath(path: string): string {
		return path.trim().replace(/^\/+|\/+$/g, "");
	}

	/**
	 * 验证模板文件夹路径是否存在。
	 */
	async validateTemplatePath(path: string): Promise<boolean> {
		if (!path || path.trim() === "") {
			return false;
		}

		try {
			const normalizedPath = this.normalizePath(path);
			const folder = this.app.vault.getAbstractFileByPath(normalizedPath);
			return folder !== null && "children" in folder;
		} catch {
			return false;
		}
	}

	/**
	 * 加载模板文件到内存。
	 */
	async loadTemplates(): Promise<TemplateLoadResult> {
		this.loadResult = {
			status: TemplateLoadStatus.LOADING,
			count: 0,
			message: "正在加载模板...",
		};

		try {
			const settings = this.resolveSettings();
			const folderPath = settings.templateFolderPath?.trim();
			if (!folderPath) {
				this.loadResult = {
					status: TemplateLoadStatus.ERROR,
					count: 0,
					message: "模板文件夹路径未设置",
				};
				console.log("Fast Templater: 模板文件夹路径未设置");
				return this.loadResult;
			}

			const pathExists = await this.validateTemplatePath(folderPath);
			if (!pathExists) {
				this.loadResult = {
					status: TemplateLoadStatus.ERROR,
					count: 0,
					message: `模板文件夹路径 "${folderPath}" 无效或不存在`,
				};
				console.warn(`Fast Templater: 路径 "${folderPath}" 无效或不存在`);
				return this.loadResult;
			}

			const normalizedPath = this.normalizePath(folderPath);
			const folder = this.app.vault.getAbstractFileByPath(normalizedPath);
			if (!folder || !("children" in folder)) {
				this.loadResult = {
					status: TemplateLoadStatus.ERROR,
					count: 0,
					message: `模板文件夹路径 "${folderPath}" 无法访问`,
				};
				console.warn(`Fast Templater: 路径 "${folderPath}" 无法访问有效文件夹`);
				return this.loadResult;
			}

			const templateFiles = this.app.vault.getFiles().filter((file: TFile) => {
				return file.extension === "md" && file.path.startsWith(`${normalizedPath}/`);
			});

			this.templates = [];
			let errorCount = 0;

			for (const file of templateFiles) {
				try {
					const content = await this.app.vault.read(file);
					const template: Template = {
						id: file.path,
						name: file.basename,
						path: file.path,
						content,
					};
					this.templates.push(template);
				} catch (error) {
					errorCount++;
					console.warn(`Fast Templater: 无法读取模板文件 ${file.path}`, error);
				}
			}

			this.templates.sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { sensitivity: "base" }));

			if (this.templates.length === 0) {
				this.loadResult = {
					status: TemplateLoadStatus.EMPTY,
					count: 0,
					message: `文件夹 "${folderPath}" 中未找到 .md 模板文件`,
				};
			} else {
				this.loadResult = {
					status: TemplateLoadStatus.SUCCESS,
					count: this.templates.length,
					message: `成功加载 ${this.templates.length} 个模板文件`,
				};
			}

			console.log(`Fast Templater: ${this.loadResult.message}`);
			if (errorCount > 0) {
				console.warn(`Fast Templater: ${errorCount} 个文件读取失败`);
			}

			return this.loadResult;
		} catch (error) {
			const errorMessage = "Fast Templater: 加载模板失败";
			this.loadResult = {
				status: TemplateLoadStatus.ERROR,
				count: 0,
				message: errorMessage,
				error: error as Error,
			};
			console.error(errorMessage, error);
			new Notice(`${errorMessage}，请检查模板文件夹设置`);
			return this.loadResult;
		}
	}

	/**
	 * 重新加载模板文件。
	 */
	async reloadTemplates(showNotice: boolean = false): Promise<TemplateLoadResult> {
		const result = await this.loadTemplates();
		if (showNotice) {
			if (result.status === TemplateLoadStatus.SUCCESS) {
				new Notice(`✅ ${result.message}`);
			} else {
				new Notice(`⚠️ ${result.message}`);
			}
		}
		return result;
	}

	getTemplates(): Template[] {
		return [...this.templates];
	}

	getTemplateById(id: string): Template | undefined {
		return this.templates.find((template) => template.id === id);
	}

	getTemplateLoadStatus(): TemplateLoadResult {
		return { ...this.loadResult };
	}

	hasTemplates(): boolean {
		return (
			this.templates.length > 0 &&
			this.loadResult.status === TemplateLoadStatus.SUCCESS
		);
	}
}

export default TemplateManager;
