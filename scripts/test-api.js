/**
 * API 测试脚本
 * 用于独立测试 GraphQL API 连接和数据查询
 *
 * 使用方法: node scripts/test-api.js
 */

const https = require('https');
const http = require('http');

// 配置参数
const CONFIG = {
    endpoint: 'https://siyuan.notebooksyncer.com/api/graphql',
    apiKey: 'o56E7690LHHXd5zvCAqoPobIuqq4',
    testCases: [
        {
            name: '基础查询 - 获取前5条数据',
            variables: {
                after: 0,
                first: 5,
                query: ''
            }
        },
        {
            name: '空查询 - 测试空字符串',
            variables: {
                after: 0,
                first: 1,
                query: ''
            }
        },
        {
            name: '分页查询 - 获取第二页',
            variables: {
                after: 5,
                first: 5,
                query: ''
            }
        }
    ]
};

// GraphQL 查询语句（Relay Cursor Pagination 格式）
const QUERY = `
    query Search($after: Int, $first: Int, $query: String) {
        search(after: $after, first: $first, query: $query) {
            edges {
                node {
                    id
                    title
                    author
                    url
                    savedAt
                    publishedAt
                    description
                    siteName
                    type
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

/**
 * 脱敏 API Key
 */
function maskApiKey(apiKey) {
    if (!apiKey) return 'undefined';
    if (apiKey.length <= 9) return '***';
    return `${apiKey.substring(0, 3)}...${apiKey.substring(apiKey.length - 6)}`;
}

/**
 * 发送 GraphQL 请求
 */
function sendGraphQLRequest(endpoint, query, variables, apiKey) {
    return new Promise((resolve, reject) => {
        const url = new URL(endpoint);
        const requestBody = JSON.stringify({ query, variables });

        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(requestBody),
                'x-api-key': apiKey
            }
        };

        console.log('\n=== 请求信息 ===');
        console.log(`端点: ${endpoint}`);
        console.log(`API Key: ${maskApiKey(apiKey)}`);
        console.log(`变量: ${JSON.stringify(variables, null, 2)}`);
        console.log(`请求体大小: ${Buffer.byteLength(requestBody)} bytes`);

        const protocol = url.protocol === 'https:' ? https : http;
        const startTime = Date.now();

        const req = protocol.request(options, (res) => {
            const responseTime = Date.now() - startTime;
            let data = '';

            console.log('\n=== 响应信息 ===');
            console.log(`状态码: ${res.statusCode} ${res.statusMessage}`);
            console.log(`响应时间: ${responseTime}ms`);
            console.log(`响应头:`, res.headers);

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                console.log(`响应体大小: ${data.length} bytes`);

                try {
                    const result = JSON.parse(data);
                    console.log('\n=== JSON 解析成功 ===');

                    if (result.errors) {
                        console.log('\n⚠️  GraphQL 错误:');
                        console.log(JSON.stringify(result.errors, null, 2));
                        reject(new Error(`GraphQL errors: ${result.errors.map(e => e.message).join(', ')}`));
                        return;
                    }

                    // 检查响应格式：标准GraphQL (result.data) 或非标准（直接返回）
                    let responseData;
                    if (result.data !== undefined) {
                        console.log('✓ 标准 GraphQL 响应格式');
                        responseData = result.data;
                    } else if (result.edges !== undefined) {
                        console.log('⚠️  非标准响应格式：直接返回数据，没有 data 包裹层');
                        responseData = result;
                    } else {
                        console.log('\n❌ 响应数据为空');
                        console.log('完整响应:', JSON.stringify(result, null, 2));
                        reject(new Error('Response data is empty'));
                        return;
                    }

                    if (!responseData.edges) {
                        console.log('\n❌ 缺少 edges 字段');
                        console.log('Data 键值:', Object.keys(responseData));
                        console.log('完整 data:', JSON.stringify(responseData, null, 2));
                        reject(new Error('Invalid response: edges field is missing'));
                        return;
                    }

                    // 从 edges 中提取 items
                    const items = responseData.edges.map(edge => edge.node);
                    const pageInfo = responseData.pageInfo;

                    console.log('\n✅ 查询成功!');
                    console.log('=== 查询结果 ===');
                    console.log(`总数量: ${pageInfo.totalCount}`);
                    console.log(`当前页数量: ${items.length}`);
                    console.log(`是否有下一页: ${pageInfo.hasNextPage}`);
                    console.log(`是否有上一页: ${pageInfo.hasPreviousPage}`);
                    console.log(`游标范围: ${pageInfo.startCursor} - ${pageInfo.endCursor}`);

                    if (items.length > 0) {
                        console.log('\n前3条数据预览:');
                        items.slice(0, 3).forEach((item, index) => {
                            console.log(`\n[${index + 1}] ${item.title || '(无标题)'}`);
                            console.log(`    ID: ${item.id}`);
                            console.log(`    作者: ${item.author || '(未知)'}`);
                            console.log(`    类型: ${item.type}`);
                            console.log(`    保存时间: ${item.savedAt}`);
                            console.log(`    URL: ${item.url || '(无URL)'}`);
                        });
                    } else {
                        console.log('\n⚠️  没有数据返回');
                    }

                    resolve(result.data);
                } catch (parseError) {
                    console.log('\n❌ JSON 解析失败');
                    console.log('错误:', parseError.message);
                    console.log('响应预览 (前500字符):', data.substring(0, 500));
                    reject(new Error(`Failed to parse JSON: ${parseError.message}`));
                }
            });
        });

        req.on('error', (error) => {
            console.log('\n❌ 请求失败');
            console.log('错误:', error.message);
            console.log('错误详情:', error);
            reject(error);
        });

        req.write(requestBody);
        req.end();
    });
}

/**
 * 运行所有测试用例
 */
async function runTests() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║           SiYuan NoteHelper API 测试工具                   ║');
    console.log('╚════════════════════════════════════════════════════════════╝');

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < CONFIG.testCases.length; i++) {
        const testCase = CONFIG.testCases[i];
        console.log('\n\n');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`测试用例 ${i + 1}/${CONFIG.testCases.length}: ${testCase.name}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        try {
            await sendGraphQLRequest(
                CONFIG.endpoint,
                QUERY,
                testCase.variables,
                CONFIG.apiKey
            );
            successCount++;
        } catch (error) {
            console.log(`\n❌ 测试失败: ${error.message}`);
            failCount++;
        }

        // 延迟一下，避免请求过快
        if (i < CONFIG.testCases.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    console.log('\n\n');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                       测试总结                              ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log(`总测试数: ${CONFIG.testCases.length}`);
    console.log(`✅ 成功: ${successCount}`);
    console.log(`❌ 失败: ${failCount}`);
    console.log(`成功率: ${(successCount / CONFIG.testCases.length * 100).toFixed(1)}%`);
    console.log('\n');
}

// 运行测试
runTests().catch(error => {
    console.error('\n❌ 测试执行出错:', error);
    process.exit(1);
});
