/**
 * 版本号比较和更新逻辑测试
 */

import { compareVersions } from '../src/updater';

describe('compareVersions - 版本号比较', () => {
    test('远程版本更高时返回 true', () => {
        expect(compareVersions('1.7.6', '1.7.5')).toBe(true);
        expect(compareVersions('1.8.0', '1.7.5')).toBe(true);
        expect(compareVersions('2.0.0', '1.7.5')).toBe(true);
    });

    test('远程版本相同时返回 false', () => {
        expect(compareVersions('1.7.5', '1.7.5')).toBe(false);
        expect(compareVersions('0.0.0', '0.0.0')).toBe(false);
    });

    test('远程版本更低时返回 false', () => {
        expect(compareVersions('1.7.4', '1.7.5')).toBe(false);
        expect(compareVersions('1.6.9', '1.7.0')).toBe(false);
        expect(compareVersions('0.9.9', '1.0.0')).toBe(false);
    });

    test('主版本号差异优先于次版本号', () => {
        expect(compareVersions('2.0.0', '1.9.9')).toBe(true);
        expect(compareVersions('1.0.0', '0.99.99')).toBe(true);
    });

    test('次版本号差异优先于修订号', () => {
        expect(compareVersions('1.8.0', '1.7.9')).toBe(true);
        expect(compareVersions('1.7.0', '1.6.99')).toBe(true);
    });

    test('处理缺少部分版本号的情况', () => {
        // 缺少的部分视为 0
        expect(compareVersions('1.0.1', '1.0.0')).toBe(true);
        expect(compareVersions('0.0.1', '0.0.0')).toBe(true);
    });

    test('本地版本为 0.0.0 时（首次安装/读取失败）', () => {
        expect(compareVersions('1.7.5', '0.0.0')).toBe(true);
        expect(compareVersions('0.0.1', '0.0.0')).toBe(true);
    });

    test('大版本号数值比较正确（非字符串比较）', () => {
        // 字符串比较 "9" > "10"，数值比较 9 < 10
        expect(compareVersions('1.10.0', '1.9.0')).toBe(true);
        expect(compareVersions('1.9.0', '1.10.0')).toBe(false);
    });
});
