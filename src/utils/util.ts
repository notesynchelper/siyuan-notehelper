/**
 * 工具函数
 */

import { DateTime } from 'luxon';
import { logger } from './logger';

/**
 * 格式化日期
 */
export function formatDate(date: string | Date, format: string): string {
    try {
        const dt = typeof date === 'string' ? DateTime.fromISO(date) : DateTime.fromJSDate(date);
        return dt.toFormat(format);
    } catch (error) {
        logger.error('Date formatting error:', error);
        return '';
    }
}

/**
 * 解析日期时间
 */
export function parseDateTime(dateStr: string): DateTime {
    return DateTime.fromISO(dateStr);
}

/**
 * 清理文件名（移除非法字符）
 */
export function sanitizeFileName(filename: string): string {
    // 移除或替换 Windows 和 Unix 文件系统中的非法字符
    return filename
        .replace(/[<>:"/\\|?*]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * 生成唯一 ID
 */
export function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 延迟执行
 */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 防抖函数
 */
export function debounce<T extends (...args: any[]) => any>(
    func: T,
    wait: number
): (...args: Parameters<T>) => void {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    return function (...args: Parameters<T>) {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

/**
 * 节流函数
 */
export function throttle<T extends (...args: any[]) => any>(
    func: T,
    limit: number
): (...args: Parameters<T>) => void {
    let inThrottle: boolean;
    return function (...args: Parameters<T>) {
        if (!inThrottle) {
            func(...args);
            inThrottle = true;
            setTimeout(() => (inThrottle = false), limit);
        }
    };
}

/**
 * 检测是否为企微消息
 */
export function isWeChatMessage(title: string): boolean {
    // 格式：同步助手_yyyyMMdd_xxx_类型
    return /^同步助手_\d{8}/.test(title);
}

/**
 * 从企微消息标题中提取日期
 */
export function extractDateFromWeChatTitle(title: string): string | null {
    const match = title.match(/同步助手_(\d{4})(\d{2})(\d{2})/);
    if (match) {
        return `${match[1]}-${match[2]}-${match[3]}`;
    }
    return null;
}

/**
 * 确保字符串以指定后缀结尾
 */
export function ensureEndsWith(str: string, suffix: string): string {
    return str.endsWith(suffix) ? str : str + suffix;
}

/**
 * 确保字符串以指定前缀开始
 */
export function ensureStartsWith(str: string, prefix: string): string {
    return str.startsWith(prefix) ? str : prefix + str;
}

/**
 * 移除 Markdown 语法
 */
export function stripMarkdown(text: string): string {
    return text
        .replace(/[*_~`#]/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
        .trim();
}

/**
 * 规范化文件路径
 * - 将反斜杠替换为正斜杠（Windows兼容）
 * - 移除重复的斜杠
 * - 移除开头和结尾的斜杠
 */
export function normalizePath(path: string): string {
    if (!path) return '';

    return path
        .replace(/\\/g, '/')    // Windows路径兼容
        .replace(/\/+/g, '/')   // 移除重复斜杠
        .replace(/^\//, '')     // 移除开头斜杠
        .replace(/\/$/, '');    // 移除结尾斜杠
}

/**
 * 连接路径片段并规范化
 */
export function joinPath(...parts: string[]): string {
    const joined = parts
        .filter(Boolean)  // 移除空字符串
        .join('/');
    return normalizePath(joined);
}
