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
		parse_template(config: unknown, template_content: string): Promise<string>;
	};
}
