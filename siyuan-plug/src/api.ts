/**
 * API 服务层
 * 负责与后端服务器通信
 */

import { logger } from './utils/logger';
import { Article } from './utils/types';

// GraphQL 响应接口
interface GraphQLResponse<T> {
    data: T;
    errors?: Array<{ message: string }>;
}

// 搜索响应接口（Relay Cursor Pagination 格式）
// 注意：服务端直接在 data 字段中返回 edges 和 pageInfo，没有 search 包裹层
interface SearchResponse {
    edges: Array<{
        node: Article;
    }>;
    pageInfo: {
        hasNextPage: boolean;
        hasPreviousPage: boolean;
        startCursor: string;
        endCursor: string;
        totalCount: number;
    };
}

// 文章数量响应接口
interface ArticleCountResponse {
    count: number;
}

/**
 * 脱敏 API Key（显示前3位和后6位）
 */
function maskApiKey(apiKey?: string): string {
    if (!apiKey) return 'undefined';
    if (apiKey.length <= 9) return '***';
    return `${apiKey.substring(0, 3)}...${apiKey.substring(apiKey.length - 6)}`;
}

/**
 * 发送 GraphQL 请求
 */
async function fetchGraphQL<T>(
    endpoint: string,
    query: string,
    variables: Record<string, any>,
    apiKey?: string
): Promise<T> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };

    if (apiKey) {
        headers['x-api-key'] = apiKey;
    }

    // 记录请求信息
    const queryPreview = query.substring(0, 100).replace(/\s+/g, ' ').trim();
    logger.info(`GraphQL Request: POST ${endpoint}`);
    logger.info(`Query: ${queryPreview}...`);
    logger.info(`Variables: ${JSON.stringify(variables)}`);
    logger.info(`API Key: ${maskApiKey(apiKey)}`);

    try {
        const startTime = Date.now();
        const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                query,
                variables,
            }),
        });

        const responseTime = Date.now() - startTime;
        logger.info(`Response received: ${response.status} ${response.statusText} (${responseTime}ms)`);

        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unable to read response');
            logger.error(`HTTP error details:`, {
                status: response.status,
                statusText: response.statusText,
                endpoint,
                responseBody: errorText.substring(0, 500)
            });
            throw new Error(`HTTP error! status: ${response.status}, body: ${errorText.substring(0, 200)}`);
        }

        const responseText = await response.text();
        logger.info(`Response size: ${responseText.length} bytes`);

        let result: GraphQLResponse<T>;
        try {
            result = JSON.parse(responseText);
        } catch (parseError) {
            logger.error('Failed to parse JSON response:', {
                error: parseError,
                responsePreview: responseText.substring(0, 500)
            });
            throw new Error(`Invalid JSON response: ${parseError}`);
        }

        if (result.errors && result.errors.length > 0) {
            logger.error('GraphQL errors:', {
                endpoint,
                query: queryPreview,
                variables,
                errors: result.errors
            });
            throw new Error(result.errors.map(e => e.message).join(', '));
        }

        // 检查响应格式
        let responseData: T;
        if (result.data !== undefined) {
            // 标准 GraphQL 响应：{data: {search: {...}}}
            // 需要进一步检查是否有 search 包装
            if (result.data.search !== undefined) {
                // 完整的标准格式：data.search 包含实际数据
                responseData = result.data.search as T;
                logger.info('Standard GraphQL response with search wrapper');
            } else {
                // 标准格式但没有 search 包装：data 直接包含实际数据
                responseData = result.data;
                logger.info('Standard GraphQL response without search wrapper');
            }
        } else if (result.edges !== undefined && result.pageInfo !== undefined) {
            // 非标准响应：服务端直接返回 search 的内容（edges + pageInfo）
            responseData = result as unknown as T;
            logger.warn('Non-standard GraphQL response: server returns search content directly');
        } else {
            logger.error('Unexpected response structure:', {
                endpoint,
                query: queryPreview,
                variables,
                hasData: result.data !== undefined,
                hasEdges: result.edges !== undefined,
                hasPageInfo: result.pageInfo !== undefined,
                responseKeys: Object.keys(result),
                fullResponse: JSON.stringify(result).substring(0, 1000)
            });
            throw new Error('Unexpected response structure');
        }

        logger.info(`GraphQL request successful`);
        return responseData;
    } catch (error) {
        logger.error('GraphQL request failed:', {
            endpoint,
            error: String(error),
            apiKey: maskApiKey(apiKey)
        });
        throw error;
    }
}

/**
 * 搜索文章
 * @param endpoint API 端点
 * @param apiKey API 密钥
 * @param after 偏移量
 * @param first 每页数量
 * @param updatedAt 更新时间过滤
 * @param query 自定义查询
 * @param includeContent 是否包含内容
 * @returns [文章列表, 是否有下一页]
 */
export async function getItems(
    endpoint: string,
    apiKey: string,
    after: number = 0,
    first: number = 15,
    updatedAt?: string,
    query?: string,
    includeContent: boolean = true
): Promise<[Article[], boolean]> {
    // 构建查询字符串
    let searchQuery = query || '';
    if (updatedAt) {
        searchQuery += ` updated:>${updatedAt}`;
    }

    logger.info(`getItems called with params:`, {
        endpoint,
        after,
        first,
        updatedAt,
        customQuery: query,
        includeContent,
        finalSearchQuery: searchQuery
    });

    const graphqlQuery = `
        query Search($after: Int, $first: Int, $query: String) {
            search(after: $after, first: $first, query: $query) {
                edges {
                    node {
                        id
                        title
                        author
                        ${includeContent ? 'content' : ''}
                        url
                        savedAt
                        publishedAt
                        description
                        siteName
                        image
                        type
                        wordsCount
                        readLength
                        state
                        archivedAt
                        note
                        highlights {
                            id
                            quote
                            annotation
                            color
                            highlightedAt
                            updatedAt
                            patch
                            prefix
                            suffix
                        }
                        labels {
                            id
                            name
                            color
                            description
                        }
                    }
                }
                pageInfo {
                    hasNextPage
                    hasPreviousPage
                    startCursor
                    endCursor
                    totalCount
                }
            }
        }
    `;

    const variables = {
        after,
        first,
        query: searchQuery,
    };

    try {
        const data = await fetchGraphQL<SearchResponse>(
            endpoint,
            graphqlQuery,
            variables,
            apiKey
        );

        // 验证响应结构（Relay Cursor Pagination 格式）
        // 服务端直接在 data 中返回 edges，没有 search 包裹层
        if (!data.edges) {
            logger.error('Invalid response structure: missing edges field', {
                hasData: !!data,
                dataKeys: Object.keys(data || {}),
                fullData: JSON.stringify(data)
            });
            throw new Error('Invalid response: edges field is missing');
        }

        // 从 edges 中提取 items
        const items: Article[] = data.edges.map(edge => edge.node);
        const hasNextPage = data.pageInfo?.hasNextPage || false;
        const totalCount = data.pageInfo?.totalCount || 0;

        logger.info(`getItems result:`, {
            itemsCount: items.length,
            hasNextPage,
            totalCount,
            startCursor: data.pageInfo?.startCursor,
            endCursor: data.pageInfo?.endCursor,
            firstItemId: items.length > 0 ? items[0].id : 'none'
        });

        return [items, hasNextPage];
    } catch (error) {
        logger.error('Failed to fetch items:', {
            error: String(error),
            endpoint,
            after,
            first,
            searchQuery
        });
        throw error;
    }
}

/**
 * 删除文章
 * @param endpoint API 端点
 * @param apiKey API 密钥
 * @param articleId 文章 ID
 */
export async function deleteItem(
    endpoint: string,
    apiKey: string,
    articleId: string
): Promise<boolean> {
    const mutation = `
        mutation DeleteItem($id: ID!) {
            deleteItem(id: $id) {
                success
            }
        }
    `;

    const variables = {
        id: articleId,
    };

    try {
        await fetchGraphQL<any>(
            endpoint,
            mutation,
            variables,
            apiKey
        );

        logger.info(`Deleted article: ${articleId}`);
        return true;
    } catch (error) {
        logger.error('Failed to delete article:', error);
        throw error;
    }
}

/**
 * 获取文章数量
 * @param endpoint API 端点
 * @param apiKey API 密钥
 */
export async function getArticleCount(
    endpoint: string,
    apiKey: string
): Promise<number> {
    // 将 GraphQL 端点转换为统计端点
    const baseUrl = endpoint.replace(/\/api\/graphql$/, '');
    const statsUrl = `${baseUrl}/api/stats/article-count`;

    const headers: Record<string, string> = {
        'x-api-key': apiKey,
    };

    try {
        const response = await fetch(statsUrl, {
            method: 'GET',
            headers,
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data: ArticleCountResponse = await response.json();
        logger.info(`Article count: ${data.count}`);

        return data.count;
    } catch (error) {
        logger.error('Failed to get article count:', error);
        throw error;
    }
}

/**
 * 清空所有文章
 * @param endpoint API 端点
 * @param apiKey API 密钥
 */
export async function clearAllArticles(
    endpoint: string,
    apiKey: string
): Promise<boolean> {
    const baseUrl = endpoint.replace(/\/api\/graphql$/, '');
    const clearUrl = `${baseUrl}/api/articles/clear`;

    const headers: Record<string, string> = {
        'x-api-key': apiKey,
    };

    try {
        const response = await fetch(clearUrl, {
            method: 'POST',
            headers,
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        logger.info('All articles cleared');
        return true;
    } catch (error) {
        logger.error('Failed to clear all articles:', error);
        throw error;
    }
}

/**
 * 获取文章内容
 * @param endpoint API 端点
 * @param apiKey API 密钥
 * @param articleIds 文章 ID 列表
 */
export async function fetchContentForItems(
    endpoint: string,
    apiKey: string,
    articleIds: string[]
): Promise<Map<string, string>> {
    const baseUrl = endpoint.replace(/\/api\/graphql$/, '');
    const contentUrl = `${baseUrl}/api/content`;

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
    };

    try {
        const response = await fetch(contentUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({ ids: articleIds }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data: Record<string, string> = await response.json();
        const contentMap = new Map<string, string>(Object.entries(data));

        logger.info(`Fetched content for ${contentMap.size} items`);

        return contentMap;
    } catch (error) {
        logger.error('Failed to fetch content:', error);
        throw error;
    }
}

/**
 * 测试 API 连接
 * @param endpoint API 端点
 * @param apiKey API 密钥
 */
export async function testConnection(
    endpoint: string,
    apiKey: string
): Promise<boolean> {
    try {
        await getItems(endpoint, apiKey, 0, 1, undefined, undefined, false);
        return true;
    } catch (error) {
        logger.error('Connection test failed:', error);
        return false;
    }
}
