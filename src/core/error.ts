import type { NotifyLevel, NotifyOptions } from '@utils/notify';
import { notify } from '@utils/notify';

export interface HandleErrorOptions {
	userMessage?: string | ((error: Error) => string);
	context?: string;
	rethrow?: boolean;
	notifyLevel?: NotifyLevel;
	notifyOptions?: NotifyOptions;
	onHandled?: (error: Error) => void;
}

export function ensureError(error: unknown): Error {
	if (error instanceof Error) {
		return error;
	}
	if (typeof error === 'string') {
		return new Error(error);
	}
	try {
		return new Error(JSON.stringify(error));
	} catch {
		return new Error('未知错误');
	}
}

export function handleError(error: unknown, options?: HandleErrorOptions): Error {
	const normalizedError = ensureError(error);
	const contextPrefix = options?.context ? `[${options.context}] ` : '';

	console.error(`Note Architect: ${contextPrefix}${normalizedError.message}`, normalizedError);

	if (options?.userMessage) {
		const finalMessage = typeof options.userMessage === 'function'
			? options.userMessage(normalizedError)
			: options.userMessage;
		const level = options.notifyLevel ?? 'error';
		notify(level, finalMessage, options.notifyOptions);
	}

	options?.onHandled?.(normalizedError);

	if (options?.rethrow) {
		throw normalizedError;
	}

	return normalizedError;
}
