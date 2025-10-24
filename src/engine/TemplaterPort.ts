import type { Template } from '@types';

export interface TemplaterPort {
	isAvailable(): boolean;
	processTemplate(template: Template): Promise<string>;
}
