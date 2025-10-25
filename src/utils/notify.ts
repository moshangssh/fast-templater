import { Notice } from 'obsidian';

export type NotifyLevel = 'success' | 'info' | 'warning' | 'error';

export interface NotifyOptions {
	duration?: number;
	prefix?: string | false;
}

const LEVEL_PREFIX: Record<NotifyLevel, string> = {
	success: '✅ ',
	info: 'ℹ️ ',
	warning: '⚠️ ',
	error: '❌ ',
};

function buildMessage(level: NotifyLevel, message: string, prefix: NotifyOptions['prefix']): string {
	if (prefix === false) {
		return message;
	}

	const resolvedPrefix = prefix ?? LEVEL_PREFIX[level] ?? '';
	return `${resolvedPrefix}${message}`;
}

export function notify(level: NotifyLevel, message: string, options?: NotifyOptions): void {
	const finalMessage = buildMessage(level, message, options?.prefix);
	new Notice(finalMessage, options?.duration);
}

export const notifySuccess = (message: string, options?: NotifyOptions) => notify('success', message, options);
export const notifyInfo = (message: string, options?: NotifyOptions) => notify('info', message, options);
export const notifyWarning = (message: string, options?: NotifyOptions) => notify('warning', message, options);
export const notifyError = (message: string, options?: NotifyOptions) => notify('error', message, options);
