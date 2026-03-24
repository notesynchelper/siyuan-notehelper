import { sortArticlesByTime } from '../src/sync/batchSortHelper';

describe('sortArticlesByTime', () => {
    const articles = [
        { id: '3', savedAt: '2026-03-24T12:30:00Z', title: 'c' },
        { id: '1', savedAt: '2026-03-24T12:00:00Z', title: 'a' },
        { id: '2', savedAt: '2026-03-24T12:15:00Z', title: 'b' },
    ] as any[];

    test('ASC sorts oldest first', () => {
        const sorted = sortArticlesByTime(articles, 'ASC');
        expect(sorted.map(a => a.id)).toEqual(['1', '2', '3']);
    });

    test('DESC sorts newest first', () => {
        const sorted = sortArticlesByTime(articles, 'DESC');
        expect(sorted.map(a => a.id)).toEqual(['3', '2', '1']);
    });

    test('does not mutate original array', () => {
        const original = [...articles];
        sortArticlesByTime(articles, 'ASC');
        expect(articles.map(a => a.id)).toEqual(original.map(a => a.id));
    });

    test('handles single item', () => {
        const sorted = sortArticlesByTime([articles[0]], 'ASC');
        expect(sorted).toHaveLength(1);
    });

    test('handles empty array', () => {
        expect(sortArticlesByTime([], 'ASC')).toEqual([]);
    });
});
