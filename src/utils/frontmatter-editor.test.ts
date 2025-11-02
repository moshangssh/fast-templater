import { parseFrontmatter, removeFrontmatterField, updateFrontmatter } from './frontmatter-editor';

describe('frontmatter-editor', () => {
    it('updateFrontmatter adds config when header is missing', () => {
        const content = '# Title\nBody section';
        const result = updateFrontmatter(content, (fm) => ({
            ...fm,
            'note-architect-config': 'preset-id',
        }));

        expect(result.changed).toBe(true);
        expect(result.frontmatter['note-architect-config']).toBe('preset-id');
        expect(result.previousFrontmatter).toEqual({});
        expect(result.content).toBe([
            '---',
            'note-architect-config: preset-id',
            '---',
            '',
            '# Title',
            'Body section',
        ].join('\n'));
    });

    it('updateFrontmatter overwrites existing binding and keeps extra fields', () => {
        const content = [
            '---',
            'note-architect-config: old-id',
            'another: value',
            '---',
            '',
            'Content',
        ].join('\n');

        const parsed = parseFrontmatter(content);
        const result = updateFrontmatter(content, (fm) => ({
            ...fm,
            'note-architect-config': 'new-id',
        }), parsed);

        expect(result.changed).toBe(true);
        expect(result.frontmatter).toEqual({
            'note-architect-config': 'new-id',
            another: 'value',
        });
        expect(result.content).toBe([
            '---',
            'note-architect-config: new-id',
            'another: value',
            '---',
            '',
            'Content',
        ].join('\n'));
    });

    it('updateFrontmatter skips rewrite when value is unchanged', () => {
        const content = [
            '---',
            'note-architect-config: same-id',
            '---',
            '',
            'Content',
        ].join('\n');

        const parsed = parseFrontmatter(content);
        const result = updateFrontmatter(content, (fm) => ({
            ...fm,
            'note-architect-config': 'same-id',
        }), parsed);

        expect(result.changed).toBe(false);
        expect(result.content).toBe(content);
    });

    it('removeFrontmatterField clears binding and drops empty header', () => {
        const content = [
            '---',
            'note-architect-config: preset-id',
            '---',
            '',
            'Content',
        ].join('\n');

        const parsed = parseFrontmatter(content);
        const result = removeFrontmatterField(content, 'note-architect-config', parsed);

        expect(result.changed).toBe(true);
        expect(result.frontmatter).toEqual({});
        expect(result.content).toBe('Content');
    });

    it('removeFrontmatterField keeps remaining frontmatter entries', () => {
        const content = [
            '---',
            'note-architect-config: preset-id',
            'another: value',
            '---',
            '',
            'Content',
        ].join('\n');

        const parsed = parseFrontmatter(content);
        const result = removeFrontmatterField(content, 'note-architect-config', parsed);

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
