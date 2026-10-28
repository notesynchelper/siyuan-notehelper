/**
 * 日志工具类
 */

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
}

const MAX_CAPTURED_LOGS = 100;
const MAX_LOG_ENTRY_LENGTH = 12000;
const SENSITIVE_KEYS = new Set([
    'apikey', 'xapikey', 'authorization', 'cookie', 'setcookie', 'token', 'secret', 'password',
]);
const CONTENT_KEYS = new Set(['content', 'fulldata', 'fullresponse']);

/** URL 中的账号、查询参数和片段可能带有签名或令牌，诊断日志只保留源和路径。 */
export function sanitizeUrlForLog(rawUrl: string): string {
    return rawUrl
        .replace(/(\w+:\/\/)[^/@\s]+@/g, '$1[REDACTED]@')
        .replace(/[?#].*$/, '');
}

function redactString(value: string): string {
    return value.replace(
        /((?:x-api-key|api[_-]?key|authorization|cookie)\s*[:=]\s*)([^\s,}]+)/gi,
        '$1[REDACTED]'
    );
}

function sanitizeValue(value: any, seen: WeakSet<object>): any {
    if (typeof value === 'string') return redactString(value);
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return '[Circular]';
    seen.add(value);

    if (value instanceof Error || (value.message && value.name && value.stack)) {
        const error = value as any;
        const result: Record<string, any> = {
            name: error.name || 'Error',
            message: redactString(String(error.message || '')),
            stack: error.stack ? redactString(String(error.stack)) : undefined,
        };
        Object.keys(error).forEach(key => {
            result[key] = sanitizeValue(error[key], seen);
        });
        if (error.cause !== undefined && result.cause === undefined) {
            result.cause = sanitizeValue(error.cause, seen);
        }
        seen.delete(value);
        return result;
    }

    if (Array.isArray(value)) {
        const result = value.map(item => sanitizeValue(item, seen));
        seen.delete(value);
        return result;
    }

    const result: Record<string, any> = {};
    Object.keys(value).forEach(key => {
        const normalizedKey = key.toLowerCase().replace(/[-_]/g, '');
        if (SENSITIVE_KEYS.has(normalizedKey)) {
            result[key] = '[REDACTED]';
        } else if (CONTENT_KEYS.has(normalizedKey)) {
            result[key] = '[OMITTED]';
        } else {
            result[key] = sanitizeValue(value[key], seen);
        }
    });
    seen.delete(value);
    return result;
}

class Logger {
    private level: LogLevel = LogLevel.INFO;
    private prefix = '[NoteHelper]';
    private showTimestamp = true;
    private colorEnabled = true;
    private capturedLogs: string[] = [];

    setLevel(level: LogLevel) {
        this.level = level;
    }

    setShowTimestamp(show: boolean) {
        this.showTimestamp = show;
    }

    setColorEnabled(enabled: boolean) {
        this.colorEnabled = enabled;
    }

    private getTimestamp(): string {
        if (!this.showTimestamp) return '';
        const now = new Date();
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        const seconds = now.getSeconds().toString().padStart(2, '0');
        const ms = now.getMilliseconds().toString().padStart(3, '0');
        return `[${hours}:${minutes}:${seconds}.${ms}]`;
    }

    private formatArgs(level: string, args: any[]): any[] {
        const timestamp = this.getTimestamp();
        const levelTag = `[${level}]`;

        const formattedArgs = args.map(arg => {
            if (typeof arg === 'object' && arg !== null) {
                try {
                    return JSON.stringify(sanitizeValue(arg, new WeakSet<object>()), null, 2);
                } catch (e) {
                    return String(arg);
                }
            }
            return typeof arg === 'string' ? redactString(arg) : arg;
        });

        return [this.prefix, timestamp, levelTag, ...formattedArgs].filter(Boolean);
    }

    private capture(level: 'WARN' | 'ERROR', args: any[]) {
        const text = this.formatArgs(level, args).map(arg => String(arg)).join(' ');
        const entry = `[${new Date().toISOString()}] ${text}`;
        this.capturedLogs.push(entry.length > MAX_LOG_ENTRY_LENGTH
            ? `${entry.substring(0, MAX_LOG_ENTRY_LENGTH)}... [truncated]`
            : entry);
        if (this.capturedLogs.length > MAX_CAPTURED_LOGS) {
            this.capturedLogs.splice(0, this.capturedLogs.length - MAX_CAPTURED_LOGS);
        }
    }

    /** 导出当前会话内捕获的插件 WARN/ERROR；不读取或修改全局 console。 */
    getDiagnosticReport(context: Record<string, string> = {}): string {
        const header = [
            '[NoteHelper 诊断报告]',
            `生成时间: ${new Date().toISOString()}`,
            `日志条数: ${this.capturedLogs.length}（最多保留 ${MAX_CAPTURED_LOGS} 条 WARN/ERROR）`,
            ...Object.keys(context).map(key => `${key}: ${redactString(context[key])}`),
            '',
        ];
        return header.join('\n') + (this.capturedLogs.length > 0
            ? this.capturedLogs.join('\n\n')
            : '暂无插件错误日志');
    }

    getCapturedLogCount(): number {
        return this.capturedLogs.length;
    }

    clearCapturedLogs() {
        this.capturedLogs = [];
    }

    debug(...args: any[]) {
        if (this.level <= LogLevel.DEBUG) {
            const formatted = this.formatArgs('DEBUG', args);
            if (this.colorEnabled) {
                console.debug('%c' + formatted[0], 'color: #888', ...formatted.slice(1));
            } else {
                console.debug(...formatted);
            }
        }
    }

    info(...args: any[]) {
        if (this.level <= LogLevel.INFO) {
            const formatted = this.formatArgs('INFO', args);
            if (this.colorEnabled) {
                console.info('%c' + formatted[0], 'color: #4CAF50', ...formatted.slice(1));
            } else {
                console.info(...formatted);
            }
        }
    }

    warn(...args: any[]) {
        this.capture('WARN', args);
        if (this.level <= LogLevel.WARN) {
            const formatted = this.formatArgs('WARN', args);
            if (this.colorEnabled) {
                console.warn('%c' + formatted[0], 'color: #FF9800', ...formatted.slice(1));
            } else {
                console.warn(...formatted);
            }
        }
    }

    error(...args: any[]) {
        this.capture('ERROR', args);
        if (this.level <= LogLevel.ERROR) {
            const formatted = this.formatArgs('ERROR', args);
            if (this.colorEnabled) {
                console.error('%c' + formatted[0], 'color: #F44336', ...formatted.slice(1));
            } else {
                console.error(...formatted);
            }
        }
    }

    // 新增：记录性能时间
    time(label: string) {
        if (this.level <= LogLevel.DEBUG) {
            console.time(`${this.prefix} ${label}`);
        }
    }

    timeEnd(label: string) {
        if (this.level <= LogLevel.DEBUG) {
            console.timeEnd(`${this.prefix} ${label}`);
        }
    }

    // 新增：分组日志
    group(label: string) {
        if (this.level <= LogLevel.DEBUG) {
            console.group(`${this.prefix} ${label}`);
        }
    }

    groupEnd() {
        if (this.level <= LogLevel.DEBUG) {
            console.groupEnd();
        }
    }
}

export const logger = new Logger();
