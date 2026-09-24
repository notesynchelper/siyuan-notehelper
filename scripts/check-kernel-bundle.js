#!/usr/bin/env node
/**
 * kernel.js 产物校验门（方案 §6.3）
 *
 * 确保 kernel bundle 不含浏览器/前端专属依赖：
 *  - require("siyuan") / import 'siyuan'（前端插件 SDK）
 *  - window / document / localStorage / FormData / Blob（goja 沙箱不可用或行为不符）
 *  - fetch( 裸调用（kernel 侧一切网络必须走 runtime adapter）
 *
 * 用法：node scripts/check-kernel-bundle.js [dist/kernel.js]
 */
const fs = require('fs');
const path = require('path');

const target = process.argv[2] || path.join(__dirname, '..', 'dist', 'kernel.js');
if (!fs.existsSync(target)) {
    console.error(`[check-kernel-bundle] FAIL: ${target} 不存在（先 npm run build）`);
    process.exit(1);
}
const code = fs.readFileSync(target, 'utf8');

const rules = [
    { re: /require\s*\(\s*["']siyuan["']\s*\)/, msg: 'require("siyuan") 前端 SDK' },
    { re: /\b(?:from|import)\s*["']siyuan["']/, msg: "import from 'siyuan'" },
    { re: /\bwindow\s*\./, msg: 'window.* 浏览器全局' },
    { re: /\bdocument\s*\./, msg: 'document.* DOM' },
    { re: /\blocalStorage\b/, msg: 'localStorage 浏览器存储' },
    { re: /\bnew\s+FormData\b/, msg: 'FormData 浏览器构造器' },
    { re: /\bnew\s+Blob\b/, msg: 'Blob 浏览器构造器' },
    { re: /(?<!\.\s*)\bfetch\s*\(/, msg: '裸 fetch( 调用（必须走 runtime adapter）' },
];

// 使用 JavaScript 词法器区分注释、字符串、模板插值和正则字面量。
// 普通字面量用占位符隔开；只保留 SDK 字符串供 require/import 规则检查。
const { tokenizer } = require('acorn');
let noComments;
try {
    noComments = Array.from(tokenizer(code, { ecmaVersion: 'latest', sourceType: 'module' }), (token) => {
        const label = token.type.label;
        if (label === 'string') return token.value === 'siyuan' ? '"siyuan"' : '""';
        if (label === 'regexp' || label === 'template' || label === 'invalidTemplate') return '""';
        return code.slice(token.start, token.end);
    }).join(' ');
} catch (error) {
    console.error(`[check-kernel-bundle] FAIL: 无法解析 bundle: ${error.message}`);
    process.exit(1);
}

const failures = [];
for (const r of rules) {
    const m = noComments.match(r.re);
    if (m) {
        const idx = noComments.indexOf(m[0]);
        const ctx = noComments.slice(Math.max(0, idx - 60), idx + 80).replace(/\n/g, '\\n');
        failures.push(`  [${r.msg}] …${ctx}…`);
    }
}

if (failures.length) {
    console.error(`[check-kernel-bundle] FAIL: dist/kernel.js 含 ${failures.length} 处违禁引用：`);
    for (const f of failures) {
        console.error(f);
    }
    process.exit(1);
}

const kb = (code.length / 1024).toFixed(1);
console.log(`[check-kernel-bundle] PASS: ${target} (${kb} KB) 无浏览器/前端依赖`);
