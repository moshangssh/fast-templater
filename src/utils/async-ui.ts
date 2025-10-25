import { handleError } from '@core/error';

export interface BusyTargetConfig {
	element: HTMLElement;
	disable?: boolean;
	busyClass?: string;
	busyText?: string;
}

export interface BusyOptions<T> {
	busyText?: string;
	busyClass?: string;
	disableTrigger?: boolean;
	linkedTargets?: Array<HTMLElement | BusyTargetConfig>;
	linkedBusyClass?: string;
	onSuccess?: (result: T) => void;
	onFail?: (error: Error) => void;
	onComplete?: (result: T | null) => void;
	eventName?: keyof HTMLElementEventMap;
	preventDefault?: boolean;
	errorContext?: string;
}

interface BusySnapshot {
	element: HTMLElement;
	disabled?: boolean;
	busyClass?: string;
	textContent?: string | null;
}

interface NormalizedTarget {
	element: HTMLElement;
	disable: boolean;
	busyClass?: string;
	busyText?: string;
}

function canDisable(element: HTMLElement): boolean {
	return 'disabled' in element;
}

function normalizeTargets(trigger: HTMLElement, options: BusyOptions<unknown>): NormalizedTarget[] {
	const targets: NormalizedTarget[] = [{
		element: trigger,
		disable: options.disableTrigger ?? canDisable(trigger),
		busyClass: options.busyClass,
		busyText: options.busyText,
	}];

	if (!options.linkedTargets) {
		return targets;
	}

	options.linkedTargets.forEach((target) => {
		if (target instanceof HTMLElement) {
			targets.push({
				element: target,
				disable: canDisable(target),
				busyClass: options.linkedBusyClass,
			});
		} else {
			targets.push({
				element: target.element,
				disable: target.disable ?? canDisable(target.element),
				busyClass: target.busyClass ?? options.linkedBusyClass,
				busyText: target.busyText,
			});
		}
	});

	return targets;
}

function applyBusyState(targets: NormalizedTarget[]): BusySnapshot[] {
	return targets.map((target) => {
		const snapshot: BusySnapshot = { element: target.element };

		if (target.disable && canDisable(target.element)) {
			const control = target.element as HTMLButtonElement | HTMLInputElement;
			snapshot.disabled = control.disabled;
			control.disabled = true;
		}

		if (target.busyClass) {
			target.element.classList.add(target.busyClass);
			snapshot.busyClass = target.busyClass;
		}

		if (typeof target.busyText === 'string') {
			snapshot.textContent = target.element.textContent;
			target.element.textContent = target.busyText;
		}

		return snapshot;
	});
}

function restoreBusyState(snapshots: BusySnapshot[]): void {
	snapshots.forEach((snapshot) => {
		if (snapshot.disabled !== undefined && canDisable(snapshot.element)) {
			(snapshot.element as HTMLButtonElement | HTMLInputElement).disabled = snapshot.disabled;
		}

		if (snapshot.busyClass) {
			snapshot.element.classList.remove(snapshot.busyClass);
		}

		if (snapshot.textContent !== undefined) {
			snapshot.element.textContent = snapshot.textContent ?? '';
		}
	});
}

export async function runWithBusy<T>(
	trigger: HTMLElement,
	asyncFn: () => Promise<T>,
	options: BusyOptions<T> = {},
): Promise<T | null> {
	const normalizedTargets = normalizeTargets(trigger, options);
	const snapshots = applyBusyState(normalizedTargets);

	try {
		const result = await asyncFn();
		options.onSuccess?.(result);
		options.onComplete?.(result);
		return result;
	} catch (error) {
		const normalizedError = handleError(error, {
			context: options.errorContext ?? 'AsyncUI.runWithBusy',
		});
		options.onFail?.(normalizedError);
		options.onComplete?.(null);
		return null;
	} finally {
		restoreBusyState(snapshots);
	}
}

export function withBusy<T>(
	trigger: HTMLElement,
	asyncFn: () => Promise<T>,
	options: BusyOptions<T> = {},
): () => void {
	const eventName = options.eventName ?? 'click';
	const preventDefault = options.preventDefault ?? true;

	const handler = async (event: Event) => {
		if (preventDefault) {
			event.preventDefault();
		}
		await runWithBusy(trigger, asyncFn, options);
	};

	trigger.addEventListener(eventName, handler);

	return () => trigger.removeEventListener(eventName, handler);
}
