// 测试API响应格式
const apiKey = 'o56E7690LHHXd5zvCAqoPobIuqq4';
const endpoint = 'https://siyuan.notebooksyncer.com/api/graphql';

const query = `
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
    after: 0,
    first: 2,
    query: " updated:>2025-11-19T08:19:00.000Z"
};

async function testAPI() {
    try {
        console.log('Testing API endpoint:', endpoint);
        console.log('API Key:', apiKey.substring(0, 3) + '...' + apiKey.substring(apiKey.length - 6));
        console.log('Variables:', JSON.stringify(variables, null, 2));

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey
            },
            body: JSON.stringify({
                query,
                variables
            })
        });

        console.log('\nResponse Status:', response.status, response.statusText);

        const responseText = await response.text();
        console.log('\nRaw Response Text Length:', responseText.length);

        const data = JSON.parse(responseText);

        console.log('\n=== Response Structure ===');
        console.log('Top-level keys:', Object.keys(data));

        if (data.data) {
            console.log('Has standard GraphQL "data" field');
            console.log('data keys:', Object.keys(data.data));
            if (data.data.search) {
                console.log('data.search keys:', Object.keys(data.data.search));
            }
        } else {
            console.log('No "data" field - non-standard response');
            if (data.search) {
                console.log('Has "search" field at top level');
                console.log('search keys:', Object.keys(data.search));
            }
            if (data.edges) {
                console.log('Has "edges" field at top level');
                console.log('Number of edges:', data.edges.length);
            }
        }

        console.log('\n=== Full Response (pretty printed) ===');
        console.log(JSON.stringify(data, null, 2));

    } catch (error) {
        console.error('Error:', error);
    }
}

testAPI();