import { showMessage } from 'siyuan';
import Mustache from 'mustache';
import { formatDate } from '../utils/util';

export function validateTemplate(value: string, fieldName: string): boolean {
    if (!value) return true;
    try {
        Mustache.parse(value);
        return true;
    } catch (e) {
        showMessage(
            `${fieldName} 模板语法错误：${e instanceof Error ? e.message : String(e)}`,
            5000,
            'error'
        );
        return false;
    }
}

export function validateDateFormat(value: string, fieldName: string): boolean {
    if (!value) return true;
    try {
        const testDate = '2026-06-15T14:30:45.000Z';
        const result = formatDate(testDate, value);
        if (!/\d/.test(result)) {
            showMessage(
                `${fieldName} 日期格式无效：格式化结果不包含数字，请检查格式字符串`,
                5000,
                'error'
            );
            return false;
        }
        return true;
    } catch (e) {
        showMessage(
            `${fieldName} 日期格式错误：${e instanceof Error ? e.message : String(e)}`,
            5000,
            'error'
        );
        return false;
    }
}

export function validateNumberRange(
    value: string,
    fieldName: string,
    min: number,
    max: number,
    allowZero?: boolean
): boolean {
    const num = parseInt(value, 10);
    if (isNaN(num)) {
        showMessage(`${fieldName} 必须是数字`, 5000, 'error');
        return false;
    }
    if (allowZero && num === 0) return true;
    if (num < min || num > max) {
        showMessage(`${fieldName} 须在 ${min}-${max} 范围内`, 5000, 'error');
        return false;
    }
    return true;
}
