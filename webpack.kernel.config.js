/**
 * kernel.js 独立构建（方案 §6.3）
 *
 * - 入口 src/kernel.ts → dist/kernel.js
 * - 纯脚本（无 library 包装），由内核 goja RunScript 求值
 * - 不外置任何依赖（luxon 等打进 bundle）；绝不 import 'siyuan' 前端包
 * - ZipPlugin 放在本配置（串行在主构建之后执行），确保 package.zip 含 kernel.js
 * - target es2020：保留原生 async/await（goja 支持；官方 sample 同等水平）
 */
const path = require("path");
const fs = require("fs");
const webpack = require("webpack");
const { EsbuildPlugin } = require("esbuild-loader");

module.exports = (env, argv) => {
    const isPro = argv.mode === "production";
    return {
        mode: argv.mode || "production",
        devtool: false,
        entry: {
            "dist/kernel": "./src/kernel.ts",
        },
        output: {
            filename: "[name].js",
            path: path.resolve(__dirname),
        },
        optimization: {
            minimize: isPro,
            minimizer: [new EsbuildPlugin()],
        },
        resolve: {
            extensions: [".ts", ".js", ".json"],
        },
        module: {
            rules: [
                {
                    test: /\.ts(x?)$/,
                    include: [path.resolve(__dirname, "src")],
                    use: [
                        {
                            loader: "esbuild-loader",
                            options: { target: "es2020", loader: "ts" },
                        },
                    ],
                },
            ],
        },
        plugins: [
            new webpack.BannerPlugin({
                banner: () => fs.readFileSync("LICENSE").toString(),
            }),
        ],
    };
};
