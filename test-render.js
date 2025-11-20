// 测试模板渲染，看看是否会产生方括号中的时间戳

// 模拟article数据
const article = {
    id: "a1d1c62a-6406-4934-b0d9-c11bfc9a62e2",
    title: "同步助手_20251104_测试消息",
    savedAt: "2025-11-20T02:39:00.693Z",
    content: "测试内容 [2025-11-20T02:39:00.693Z] 这里有个时间戳",
    highlights: [],
    labels: []
};

console.log('Article savedAt:', article.savedAt);
console.log('Article content:', article.content);

// 检查content中是否有方括号时间戳
const timestampPattern = /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]/g;
const matches = article.content.match(timestampPattern);

if (matches) {
    console.log('\n找到方括号时间戳:');
    matches.forEach(match => {
        console.log(' -', match);
    });
} else {
    console.log('\n未找到方括号时间戳');
}

// 检查是否有其他类型的时间戳
const otherTimestampPattern = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g;
const otherMatches = article.content.match(otherTimestampPattern);

if (otherMatches) {
    console.log('\n找到其他时间戳格式:');
    otherMatches.forEach(match => {
        console.log(' -', match);
    });
}
