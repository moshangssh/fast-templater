import { parseFrontmatter, removeFrontmatterField, updateFrontmatter } from './frontmatter-editor';

describe('frontmatter-editor', () => {
    it('updateFrontmatter adds config when header is missing', () => {
        const content = '# Title\nBody section';
        const result = updateFrontmatter(content, (fm) => ({
            ...fm,
            'fast-templater-config': 'preset-id',
        }));

        expect(result.changed).toBe(true);
        expect(result.frontmatter['fast-templater-config']).toBe('preset-id');
        expect(result.previousFrontmatter).toEqual({});
        expect(result.content).toBe([
            '---',
            'fast-templater-config: preset-id',
            '---',
            '',
            '# Title',
            'Body section',
        ].join('\n'));
    });

    it('updateFrontmatter overwrites existing binding and keeps extra fields', () => {
        const content = [
            '---',
            'fast-templater-config: old-id',
            'another: value',
            '---',
            '',
            'Content',
        ].join('\n');

        const parsed = parseFrontmatter(content);
        const result = updateFrontmatter(content, (fm) => ({
            ...fm,
            'fast-templater-config': 'new-id',
        }), parsed);

        expect(result.changed).toBe(true);
        expect(result.frontmatter).toEqual({
            'fast-templater-config': 'new-id',
            another: 'value',
        });
        expect(result.content).toBe([
            '---',
            'fast-templater-config: new-id',
            'another: value',
            '---',
            '',
            'Content',
        ].join('\n'));
    });

    it('updateFrontmatter skips rewrite when value is unchanged', () => {
        const content = [
            '---',
            'fast-templater-config: same-id',
            '---',
            '',
            'Content',
        ].join('\n');

        const parsed = parseFrontmatter(content);
        const result = updateFrontmatter(content, (fm) => ({
            ...fm,
            'fast-templater-config': 'same-id',
        }), parsed);

        expect(result.changed).toBe(false);
        expect(result.content).toBe(content);
    });

    it('removeFrontmatterField clears binding and drops empty header', () => {
        const content = [
            '---',
            'fast-templater-config: preset-id',
            '---',
            '',
            'Content',
        ].join('\n');

        const parsed = parseFrontmatter(content);
        const result = removeFrontmatterField(content, 'fast-templater-config', parsed);

        expect(result.changed).toBe(true);
        expect(result.frontmatter).toEqual({});
        expect(result.content).toBe('Content');
    });

    it('removeFrontmatterField keeps remaining frontmatter entries', () => {
        const content = [
            '---',
            'fast-templater-config: preset-id',
            'another: value',
            '---',
            '',
            'Content',
        ].join('\n');

        const parsed = parseFrontmatter(content);
        const result = removeFrontmatterField(content, 'fast-templater-config', parsed);

        expect(result.changed).toBe(true);
        expect(result.frontmatter).toEqual({ another: 'value' });
        expect(result.content).toBe([
            '---',
            'another: value',
            '---',
            '',
            'Content',
        ].join('\n'));
    });
});
