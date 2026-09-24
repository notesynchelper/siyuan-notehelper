/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/tests'],
    // E2E 下载的 Go 模块含 .snap 文件，不属于 Jest 测试/快照。
    modulePathIgnorePatterns: ['<rootDir>/tests/real-siyuan/.runs/'],
    moduleFileExtensions: ['ts', 'js', 'json'],
    transform: {
        '^.+\\.ts$': ['ts-jest', {
            tsconfig: {
                esModuleInterop: true,
            },
        }],
    },
    moduleNameMapper: {
        '^siyuan$': '<rootDir>/tests/__mocks__/siyuan.ts',
    },
};
