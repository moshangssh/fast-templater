export type AnyFunction = (...args: any[]) => unknown;

type TimeoutHandle = ReturnType<typeof setTimeout>;

export interface DebounceOptions {
	leading?: boolean;
	trailing?: boolean;
}

export interface DebouncedFunction<T extends AnyFunction> {
	(this: ThisParameterType<T>, ...args: Parameters<T>): void;
	cancel: () => void;
	flush: () => void;
}

export function debounce<T extends AnyFunction>(
	fn: T,
	wait: number,
	options: DebounceOptions = {},
): DebouncedFunction<T> {
	let timer: TimeoutHandle | null = null;
	let lastArgs: Parameters<T> | null = null;
	let lastThis: ThisParameterType<T> | undefined;

	const leading = options.leading ?? false;
	const trailing = options.trailing ?? true;

	const invoke = () => {
		if (!lastArgs) return;
		fn.apply(lastThis as ThisParameterType<T>, lastArgs);
		lastArgs = null;
		lastThis = undefined;
	};

	const startTimer = () => {
		if (timer !== null) {
			clearTimeout(timer);
		}

		timer = setTimeout(() => {
			timer = null;
			if (trailing) {
				invoke();
			} else {
				lastArgs = null;
				lastThis = undefined;
			}
		}, wait);
	};

	const debounced = function (this: ThisParameterType<T>, ...args: Parameters<T>) {
		lastArgs = args;
		lastThis = this;

		const shouldCallLeading = leading && timer === null;

		startTimer();

		if (shouldCallLeading) {
			invoke();
		}
	} as DebouncedFunction<T>;

	debounced.cancel = () => {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
		lastArgs = null;
		lastThis = undefined;
	};

	debounced.flush = () => {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
		if (lastArgs) {
			invoke();
		}
	};

	return debounced;
}
