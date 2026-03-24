import { showMessage } from 'siyuan';
import { validateTemplate, validateDateFormat, validateNumberRange } from '../src/settings/validation';

jest.mock('siyuan');
const mockShowMessage = showMessage as jest.MockedFunction<typeof showMessage>;

beforeEach(() => {
    mockShowMessage.mockClear();
});

describe('validateTemplate', () => {
    test('accepts empty string', () => {
        expect(validateTemplate('', '字段')).toBe(true);
        expect(mockShowMessage).not.toHaveBeenCalled();
    });

    test('accepts valid Mustache template', () => {
        expect(validateTemplate('{{{title}}}', '字段')).toBe(true);
    });

    test('accepts template with section', () => {
        expect(validateTemplate('{{#labels}}{{{name}}}{{/labels}}', '字段')).toBe(true);
    });

    test('rejects unclosed section', () => {
        expect(validateTemplate('{{#labels}}{{{name}}}', '字段')).toBe(false);
        expect(mockShowMessage).toHaveBeenCalledWith(
            expect.stringContaining('模板语法错误'), 5000, 'error'
        );
    });

    test('rejects unclosed tag', () => {
        expect(validateTemplate('{{title', '字段')).toBe(false);
    });
});

describe('validateDateFormat', () => {
    test('accepts empty string', () => {
        expect(validateDateFormat('', '字段')).toBe(true);
    });

    test('accepts valid date format', () => {
        expect(validateDateFormat('yyyy-MM-dd', '字段')).toBe(true);
    });

    test('accepts format with time', () => {
        expect(validateDateFormat('yyyy-MM-dd HH:mm:ss', '字段')).toBe(true);
    });
});

describe('validateNumberRange', () => {
    test('rejects NaN', () => {
        expect(validateNumberRange('abc', '频率', 15, 1440)).toBe(false);
        expect(mockShowMessage).toHaveBeenCalledWith(
            expect.stringContaining('必须是数字'), 5000, 'error'
        );
    });

    test('rejects below min', () => {
        expect(validateNumberRange('5', '频率', 15, 1440)).toBe(false);
        expect(mockShowMessage).toHaveBeenCalledWith(
            expect.stringContaining('15-1440'), 5000, 'error'
        );
    });

    test('rejects above max', () => {
        expect(validateNumberRange('2000', '频率', 15, 1440)).toBe(false);
    });

    test('accepts in range', () => {
        expect(validateNumberRange('60', '频率', 15, 1440)).toBe(true);
    });

    test('allows zero when allowZero is true', () => {
        expect(validateNumberRange('0', '频率', 15, 1440, true)).toBe(true);
    });

    test('rejects zero when allowZero is false', () => {
        expect(validateNumberRange('0', '频率', 15, 1440)).toBe(false);
    });
});
