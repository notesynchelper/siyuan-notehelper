/**
 * 日志工具类
 */

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
}

class Logger {
    private level: LogLevel = LogLevel.INFO;
    private prefix = '[NoteHelper]';
    private showTimestamp = true;
    private colorEnabled = true;

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

        // 格式化对象为JSON字符串
        const formattedArgs = args.map(arg => {
            if (typeof arg === 'object' && arg !== null) {
                try {
                    return JSON.stringify(arg, null, 2);
                } catch (e) {
                    return arg;
                }
            }
            return arg;
        });

        return [this.prefix, timestamp, levelTag, ...formattedArgs].filter(Boolean);
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
