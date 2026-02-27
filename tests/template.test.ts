/**
 * 模板变量转换测试
 *
 * 测试插件的文件名模板引擎能否正确将用户配置的模板变量
 * （如 {{{title}}} | {{{date}}} {{{hour}}}:{{{minute}}}:{{{second}}}）
 * 转换为实际值。
 */

import {
    renderFilename,
    renderFolderPath,
    renderSingleFilename,
} from '../src/settings/template';
import { DEFAULT_SETTINGS, PluginSettings } from '../src/settings/index';
import { Article } from '../src/utils/types';

// 构造测试用的文章数据
function createMockArticle(overrides: Partial<Article> = {}): Article {
    return {
        id: 'test-001',
        title: '测试文章标题',
        author: '测试作者',
        content: '这是测试内容',
        url: 'https://example.com/article',
        savedAt: '2025-06-15T14:30:45+08:00',
        ...overrides,
    };
}

// 构造测试用的设置，在默认设置基础上覆盖
function createSettings(overrides: Partial<PluginSettings> = {}): PluginSettings {
    return { ...DEFAULT_SETTINGS, ...overrides };
}

describe('renderFilename - 文件名模板变量转换', () => {
    test('完整模板: {{{title}}} | {{{date}}} {{{hour}}}:{{{minute}}}:{{{second}}}', () => {
        const article = createMockArticle();
        const settings = createSettings({
            filename: '{{{title}}} | {{{date}}} {{{hour}}}:{{{minute}}}:{{{second}}}',
            filenameDateFormat: 'yyyy-MM-dd',
        });

        const result = renderFilename(article, settings);

        // title 应被正确替换
        expect(result).toContain('测试文章标题');
        // date 应为 2025-06-15
        expect(result).toContain('2025-06-15');
        // hour:minute:second 应保留冒号，输出 14:30:45
        expect(result).toContain('14:30:45');
        // 完整匹配（思源虚拟路径支持冒号，: 不需要替换）
        expect(result).toBe('测试文章标题 | 2025-06-15 14:30:45');
    });

    test('仅 {{{title}}} 模板（默认设置）', () => {
        const article = createMockArticle();
        const settings = createSettings({ filename: '{{{title}}}' });

        const result = renderFilename(article, settings);
        expect(result).toBe('测试文章标题');
    });

    test('包含年月日独立变量: {{{year}}}-{{{month}}}-{{{day}}} {{{title}}}', () => {
        const article = createMockArticle();
        const settings = createSettings({
            filename: '{{{year}}}-{{{month}}}-{{{day}}} {{{title}}}',
        });

        const result = renderFilename(article, settings);
        expect(result).toBe('2025-06-15 测试文章标题');
    });

    test('包含 weekday 和 quarter 变量', () => {
        // 2025-06-15 是周日，Q2
        const article = createMockArticle({ savedAt: '2025-06-15T10:00:00+08:00' });
        const settings = createSettings({
            filename: '{{{title}}} ({{{weekday}}}, {{{quarter}}})',
        });

        const result = renderFilename(article, settings);
        expect(result).toBe('测试文章标题 (周日, Q2)');
    });

    test('自定义日期格式 yyyy/MM/dd', () => {
        const article = createMockArticle();
        const settings = createSettings({
            filename: '{{{title}}}_{{{date}}}',
            filenameDateFormat: 'yyyy/MM/dd',
        });

        const result = renderFilename(article, settings);
        // / 是非法文件名字符会被替换为 -
        expect(result).toBe('测试文章标题_2025-06-15');
    });

    test('空标题时使用 Untitled', () => {
        const article = createMockArticle({ title: '' });
        const settings = createSettings({
            filename: '{{{title}}} - {{{date}}}',
            filenameDateFormat: 'yyyy-MM-dd',
        });

        const result = renderFilename(article, settings);
        expect(result).toBe('Untitled - 2025-06-15');
    });

    test('模板渲染结果为空时使用 fallback', () => {
        const article = createMockArticle();
        const settings = createSettings({
            filename: '',
        });

        const result = renderFilename(article, settings);
        // 空模板会 fallback 到默认模板 {{{title}}}
        expect(result).toBe('测试文章标题');
    });

    test('hour/minute/second 使用零填充的两位数格式', () => {
        const article = createMockArticle({ savedAt: '2025-01-05T03:05:09+08:00' });
        const settings = createSettings({
            filename: '{{{hour}}}_{{{minute}}}_{{{second}}}',
        });

        const result = renderFilename(article, settings);
        expect(result).toBe('03_05_09');
    });

    test('所有时间变量组合', () => {
        const article = createMockArticle({ savedAt: '2025-03-20T08:15:30+08:00' });
        const settings = createSettings({
            filename: '{{{year}}}{{{month}}}{{{day}}}_{{{hour}}}{{{minute}}}{{{second}}}',
        });

        const result = renderFilename(article, settings);
        expect(result).toBe('20250320_081530');
    });
});

describe('renderFolderPath - 文件夹路径模板变量转换', () => {
    test('默认模板: 笔记同步助手/{{{date}}}', () => {
        const article = createMockArticle();
        const settings = createSettings({
            folder: '笔记同步助手/{{{date}}}',
            folderDateFormat: 'yyyy-MM-dd',
        });

        const result = renderFolderPath(article, settings);
        expect(result).toBe('笔记同步助手/2025-06-15');
    });

    test('包含年月独立变量的路径: 笔记/{{{year}}}/{{{month}}}', () => {
        const article = createMockArticle();
        const settings = createSettings({
            folder: '笔记/{{{year}}}/{{{month}}}',
        });

        const result = renderFolderPath(article, settings);
        expect(result).toBe('笔记/2025/06');
    });

    test('包含 quarter 的路径', () => {
        const article = createMockArticle({ savedAt: '2025-10-01T12:00:00+08:00' });
        const settings = createSettings({
            folder: '笔记/{{{year}}}/{{{quarter}}}',
        });

        const result = renderFolderPath(article, settings);
        expect(result).toBe('笔记/2025/Q4');
    });
});

describe('renderSingleFilename - 单文件模式文件名转换', () => {
    test('默认模板: 同步助手_{{{date}}}', () => {
        const settings = createSettings({
            singleFileName: '同步助手_{{{date}}}',
            singleFileDateFormat: 'yyyy-MM-dd',
        });

        const result = renderSingleFilename('2025-06-15T14:30:45+08:00', settings);
        expect(result).toBe('同步助手_2025-06-15');
    });

    test('包含时分秒的单文件名', () => {
        const settings = createSettings({
            singleFileName: '日记_{{{date}}}_{{{hour}}}{{{minute}}}',
            singleFileDateFormat: 'yyyyMMdd',
        });

        const result = renderSingleFilename('2025-06-15T14:30:45+08:00', settings);
        expect(result).toBe('日记_20250615_1430');
    });
});
