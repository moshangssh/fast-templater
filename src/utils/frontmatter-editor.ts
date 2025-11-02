import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export interface ParsedFrontmatter {
    frontmatter: Record<string, unknown>;
    body: string;
    hasFrontmatter: boolean;
    newline: string;
}

export interface FrontmatterUpdateResult {
    content: string;
    frontmatter: Record<string, unknown>;
    previousFrontmatter: Record<string, unknown>;
    changed: boolean;
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(content: string): ParsedFrontmatter {
    const newline = content.includes('\r\n') ? '\r\n' : '\n';
    const match = content.match(FRONTMATTER_REGEX);

    if (!match) {
        return {
            frontmatter: {},
            body: content,
            hasFrontmatter: false,
            newline,
        };
    }

    const [, frontmatterText] = match;
    const body = content.slice(match[0].length);
    const frontmatter = (parseYaml(frontmatterText) ?? {}) as Record<string, unknown>;

    return {
        frontmatter,
        body,
        hasFrontmatter: true,
        newline,
    };
}

export function updateFrontmatter(
    content: string,
    updater: (frontmatter: Record<string, unknown>) => Record<string, unknown>,
    parsed?: ParsedFrontmatter
): FrontmatterUpdateResult {
    const base = parsed ?? parseFrontmatter(content);
    const updatedFrontmatter = sanitizeFrontmatter(updater({ ...base.frontmatter }));
    const changed = !areFrontmattersEqual(updatedFrontmatter, base.frontmatter);
    const newContent = changed ? composeContent(updatedFrontmatter, base) : content;

    return {
        content: newContent,
        frontmatter: updatedFrontmatter,
        previousFrontmatter: base.frontmatter,
        changed,
    };
}

export function removeFrontmatterField(
    content: string,
    key: string,
    parsed?: ParsedFrontmatter
): FrontmatterUpdateResult {
    return updateFrontmatter(
        content,
        (frontmatter) => {
            const next = { ...frontmatter };
            delete next[key];
            return next;
        },
        parsed
    );
}

function composeContent(frontmatter: Record<string, unknown>, parsed: ParsedFrontmatter): string {
    const newline = parsed.newline;
    const hasFields = Object.keys(frontmatter).length > 0;

    if (!hasFields) {
        if (!parsed.hasFrontmatter) {
            return parsed.body;
        }
        if (parsed.body.startsWith(newline)) {
            return parsed.body.slice(newline.length);
        }
        return parsed.body;
    }

    const yamlText = stringifyYaml(frontmatter, {
        indent: 2,
        lineWidth: 0,
        aliasDuplicateObjects: false,
    });
    const normalizedYaml = yamlText.endsWith('\n') ? yamlText : `${yamlText}\n`;
    const header = `---${newline}${normalizedYaml}---${newline}`;

    let bodySection = parsed.body;
    if (bodySection.length > 0 && !bodySection.startsWith(newline)) {
        bodySection = `${newline}${bodySection}`;
    }

    return `${header}${bodySection}`;
}

function sanitizeFrontmatter(frontmatter: Record<string, unknown> | null | undefined): Record<string, unknown> {
    if (!frontmatter) {
        return {};
    }

    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(frontmatter)) {
        if (value !== undefined) {
            sanitized[key] = value;
        }
    }

    return sanitized;
}

function areFrontmattersEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) {
        return false;
    }

    for (const key of keysA) {
        if (!Object.prototype.hasOwnProperty.call(b, key)) {
            return false;
        }
        if (!isValueEqual(a[key], b[key])) {
            return false;
        }
    }

    return true;
}

function isValueEqual(a: unknown, b: unknown): boolean {
    if (a === b) {
        return true;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) {
            return false;
        }
        for (let i = 0; i < a.length; i++) {
            if (!isValueEqual(a[i], b[i])) {
                return false;
            }
        }
        return true;
    }
    if (isPlainObject(a) && isPlainObject(b)) {
        return areFrontmattersEqual(a, b);
    }
    return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
