import { Article } from '../utils/types';

export function sortArticlesByTime(articles: Article[], order: string): Article[] {
    return [...articles].sort((a, b) => {
        const timeA = new Date(a.savedAt).getTime();
        const timeB = new Date(b.savedAt).getTime();
        return order === 'ASC' ? timeA - timeB : timeB - timeA;
    });
}
