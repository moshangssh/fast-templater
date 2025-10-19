export interface Template {
	id: string;
	name: string;
	path: string;
	content: string;
}

export enum TemplateLoadStatus {
	IDLE = "idle",
	LOADING = "loading",
	SUCCESS = "success",
	ERROR = "error",
	EMPTY = "empty",
}

export interface TemplateLoadResult {
	status: TemplateLoadStatus;
	count: number;
	message?: string;
	error?: Error;
}
