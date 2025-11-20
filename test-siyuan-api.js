// 测试SiYuan API响应格式
async function testSiYuanAPI() {
    try {
        // 1. 测试获取笔记本列表
        console.log('=== Testing notebook list ===');
        const notebooksResp = await fetch('http://127.0.0.1:6806/api/notebook/lsNotebooks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        const notebooks = await notebooksResp.json();
        console.log('Notebooks response:', JSON.stringify(notebooks, null, 2));

        if (notebooks.code === 0 && notebooks.data?.notebooks?.length > 0) {
            const notebookId = notebooks.data.notebooks[0].id;
            console.log(`\nUsing notebook ID: ${notebookId}`);

            // 2. 测试SQL查询获取文档
            console.log('\n=== Testing SQL query ===');
            const sqlResp = await fetch('http://127.0.0.1:6806/api/query/sql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    stmt: `SELECT id, content, hpath, created FROM blocks WHERE type = 'd' AND box = '${notebookId}' LIMIT 3`
                }),
            });
            const sqlData = await sqlResp.json();
            console.log('SQL response:', JSON.stringify(sqlData, null, 2));

            // 3. 测试getIDsByHPath API
            if (sqlData.code === 0 && sqlData.data?.length > 0) {
                const hpath = sqlData.data[0].hpath;
                console.log(`\n=== Testing getIDsByHPath with path: ${hpath} ===`);

                const pathResp = await fetch('http://127.0.0.1:6806/api/filetree/getIDsByHPath', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        notebook: notebookId,
                        path: hpath,
                    }),
                });
                const pathData = await pathResp.json();
                console.log('getIDsByHPath response:', JSON.stringify(pathData, null, 2));

                // 检查data数组的内容
                if (pathData.code === 0 && pathData.data) {
                    console.log('\n=== Analyzing data array ===');
                    console.log('Type of data:', typeof pathData.data);
                    console.log('Is array:', Array.isArray(pathData.data));
                    if (Array.isArray(pathData.data)) {
                        console.log('Data length:', pathData.data.length);
                        pathData.data.forEach((item, index) => {
                            console.log(`Item ${index}:`, typeof item, item);

                            // 检查是否是时间戳格式
                            if (typeof item === 'string' && item.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
                                console.log(`  WARNING: Item ${index} looks like an ISO timestamp!`);
                            }
                        });
                    }
                }
            }

            // 4. 测试一个不存在的路径
            console.log('\n=== Testing non-existent path ===');
            const notFoundResp = await fetch('http://127.0.0.1:6806/api/filetree/getIDsByHPath', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    notebook: notebookId,
                    path: '/non/existent/path.md',
                }),
            });
            const notFoundData = await notFoundResp.json();
            console.log('Response for non-existent path:', JSON.stringify(notFoundData, null, 2));
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

testSiYuanAPI();