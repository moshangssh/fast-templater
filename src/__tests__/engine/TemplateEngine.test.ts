import { mergeFrontmatters } from '@engine/TemplateEngine';

describe('TemplateEngine.mergeFrontmatters', () => {
  it('會將 tags 欄位合併並去重', () => {
    const base = { tags: ['design', 'note'], status: 'draft' };
    const override = { tags: ['note', 'idea'], status: 'published' };

    const merged = mergeFrontmatters(base, override);
    expect(merged.tags).toEqual(['design', 'note', 'idea']);
    expect(merged.status).toBe('published');
  });

  it('支援 tags 為單一字串時的合併', () => {
    const base = { tags: 'draft' };
    const override = { tags: ['ready'], owner: 'Alex' };

    const merged = mergeFrontmatters(base, override);
    expect(merged.tags).toEqual(['draft', 'ready']);
    expect(merged.owner).toBe('Alex');
  });
});
