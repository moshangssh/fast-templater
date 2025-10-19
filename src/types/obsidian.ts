import type { App, Plugin } from 'obsidian';

export interface AppWithSettings extends App {
	setting: {
		open(): void;
		openTabById(id: string): void;
	};
}

export interface TemplaterPlugin extends Plugin {
	templater?: {
		read_and_parse_template(config: unknown): Promise<string>;
	};
}

export interface Loc {
	line: number;
	col: number;
	offset: number;
}

export interface Pos {
	start: Loc;
	end: Loc;
}
