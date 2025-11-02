import { type App, type EventRef, TFile, TAbstractFile } from "obsidian";
import { handleError } from "@core/error";
import type { NoteArchitectSettings, Template, TemplateLoadResult } from "@types";
import { TemplateLoadStatus } from "@types";
import { notifyError, notifySuccess, notifyWarning } from "@utils/notify";
import { normalizePath } from "@utils/path";

type SettingsResolver = () => NoteArchitectSettings;

/**
 * 模板管理器负责处理模板文件的加载、缓存与检索，保持插件主类的单一职责。
 */
export class TemplateManager {
	private templates: Template[] = [];
	private loadResult: TemplateLoadResult = {
		status: TemplateLoadStatus.IDLE,
		count: 0,
	};
	private watcherRefs: EventRef[] = [];
	private reloadTimer: number | null = null;
	private watchedFolderPath?: string;
	private isWatching = false;

	constructor(
		private readonly app: App,
		private readonly resolveSettings: SettingsResolver,
	) {}

	/**
	 * 验证模板文件夹路径是否存在。
	 */
	async validateTemplatePath(path: string): Promise<boolean> {
		if (!path || path.trim() === "") {
			return false;
		}

		try {
			const normalizedPath = normalizePath(path);
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
		// 清空当前监听路径，避免在失败情况下继续处理事件
		this.watchedFolderPath = undefined;

		try {
			const settings = this.resolveSettings();
			const folderPath = settings.templateFolderPath?.trim();
			if (!folderPath) {
				this.loadResult = {
					status: TemplateLoadStatus.ERROR,
					count: 0,
					message: "模板文件夹路径未设置",
				};
				console.log("Note Architect: 模板文件夹路径未设置");
				return this.loadResult;
			}

			const pathExists = await this.validateTemplatePath(folderPath);
			if (!pathExists) {
				this.loadResult = {
					status: TemplateLoadStatus.ERROR,
					count: 0,
					message: `模板文件夹路径 "${folderPath}" 无效或不存在`,
				};
				console.warn(`Note Architect: 路径 "${folderPath}" 无效或不存在`);
				return this.loadResult;
			}

			const normalizedPath = normalizePath(folderPath);
			const folder = this.app.vault.getAbstractFileByPath(normalizedPath);
			if (!folder || !("children" in folder)) {
				this.loadResult = {
					status: TemplateLoadStatus.ERROR,
					count: 0,
					message: `模板文件夹路径 "${folderPath}" 无法访问`,
				};
				console.warn(`Note Architect: 路径 "${folderPath}" 无法访问有效文件夹`);
				return this.loadResult;
			}
			this.watchedFolderPath = normalizedPath;

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
					console.warn(`Note Architect: 无法读取模板文件 ${file.path}`, error);
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

			console.log(`Note Architect: ${this.loadResult.message}`);
			if (errorCount > 0) {
				console.warn(`Note Architect: ${errorCount} 个文件读取失败`);
			}

			return this.loadResult;
		} catch (error) {
			const normalizedError = handleError(error, {
				context: "TemplateManager.loadTemplates",
				userMessage: "加载模板失败，请检查模板文件夹设置",
			});
			this.loadResult = {
				status: TemplateLoadStatus.ERROR,
				count: 0,
				message: "加载模板失败，请检查模板文件夹设置",
				error: normalizedError,
			};
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
				notifySuccess(result.message ?? "模板加载完成");
			} else if (result.status === TemplateLoadStatus.ERROR) {
				notifyError(result.message ?? "模板加载失败");
			} else {
				notifyWarning(result.message ?? "模板状态更新");
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

	startWatching(): void {
		if (this.isWatching) {
			return;
		}

		const vault = this.app.vault;
		this.watcherRefs = [
			vault.on("create", this.handleVaultChange),
			vault.on("modify", this.handleVaultChange),
			vault.on("delete", this.handleVaultChange),
			vault.on("rename", this.handleVaultRename),
		];

		this.isWatching = true;
	}

	stopWatching(): void {
		if (this.reloadTimer !== null) {
			window.clearTimeout(this.reloadTimer);
			this.reloadTimer = null;
		}

		for (const ref of this.watcherRefs) {
			this.app.vault.offref(ref);
		}
		this.watcherRefs = [];
		this.isWatching = false;
	}

	dispose(): void {
		this.stopWatching();
	}

	private handleVaultChange = (file: TAbstractFile): void => {
		if (!this.shouldHandlePath(file?.path)) {
			return;
		}
		this.scheduleReload();
	};

	private handleVaultRename = (file: TAbstractFile, oldPath: string): void => {
		if (!this.shouldHandlePath(file?.path) && !this.shouldHandlePath(oldPath)) {
			return;
		}
		this.scheduleReload();
	};

	private shouldHandlePath(path?: string): boolean {
		if (!this.watchedFolderPath || !path) {
			return false;
		}

		const normalized = normalizePath(path);
		return normalized === this.watchedFolderPath || normalized.startsWith(`${this.watchedFolderPath}/`);
	}

	private scheduleReload(): void {
		if (this.reloadTimer !== null) {
			window.clearTimeout(this.reloadTimer);
		}

		this.reloadTimer = window.setTimeout(() => {
			this.reloadTimer = null;
			void this.reloadTemplates();
		}, 300);
	}
}

export default TemplateManager;
