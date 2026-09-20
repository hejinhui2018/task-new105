// 真实 React DOM（jsdom）交互冒烟：
// 发起 → 员工签署 → 单步送达 → 补页即时失效 → 撤销/重做 → 卸载重挂载（模拟刷新恢复）→ 运行全部场景断言。
// 用法：npm run test:ui
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const STORAGE_KEY = 'signflow.state.v1';
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
});
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'MutationObserver', 'Event', 'MouseEvent', 'MessageChannel']) {
  try {
    if (globalThis[key] !== undefined) continue;
    globalThis[key] = dom.window[key];
  } catch {
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
  }
}
globalThis.localStorage = dom.window.localStorage;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

const result = await build({
  entryPoints: ['scripts/ui-harness.tsx'],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  write: false,
  jsx: 'automatic',
  logLevel: 'silent',
});
const dir = mkdtempSync(join(tmpdir(), 'signflow-ui-'));
const file = join(dir, 'harness.mjs');
writeFileSync(file, result.outputFiles[0].text);
const { mount } = await import(pathToFileURL(file).href);

const flush = () => new Promise((r) => setTimeout(r, 20));
const text = () => document.getElementById('root').textContent;
const buttons = () => Array.from(document.querySelectorAll('button'));
const findBtn = (substr) =>
  buttons().find((b) => !b.disabled && b.textContent.replace(/\s+/g, ' ').includes(substr));
const click = async (substr) => {
  const btn = findBtn(substr);
  if (!btn) throw new Error(`找不到可用按钮：${substr}\n当前按钮：${buttons().map((b) => b.textContent.trim()).join(' | ')}`);
  btn.click();
  await flush();
};

let failures = 0;
const check = (name, cond) => {
  console.log(`   ${cond ? '✓' : '✕'} ${name}`);
  if (!cond) failures++;
};

localStorage.clear();
const unmount = mount();
await flush();

console.log('▶ 初始渲染');
check('尚未发起时出现「发起签署」按钮', !!findBtn('发起签署'));

console.log('▶ 发起第一轮');
await click('发起签署');
check('出现创世锚点', text().includes('创世锚点'));
check('员工槽位为已发送', text().includes('已发送'));

console.log('▶ 员工提交签署回执（在途）并单步送达');
await click('✓ 签署'); // 当前唯一可签署槽位：员工
check('传输队列出现签署回执', text().includes('传输中的回执') && text().includes('签署回执'));
await click('单步 +10分');
check('员工状态变为已签署', text().includes('已签署'));
check('主管状态为已发送', text().includes('已发送'));

console.log('▶ 文件补页：旧签名应即时失效');
await click('补页并更换指纹');
check('员工旧签名即时标为已失效', text().includes('已失效'));
check('主管在途链接作废（已撤回）', text().includes('已撤回'));
check('出现「被新版本取代」终态', text().includes('被新版本取代'));
const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY));
check('localStorage 已持久化失效状态', persisted.present.runs[0].slots[0].status === 'invalidated');

console.log('▶ 撤销：回到补页前');
await click('撤销');
check('撤销后旧签名恢复为已签署', text().includes('已签署') && !text().includes('已失效'));
check('撤销后轮次恢复进行中', text().includes('进行中'));

console.log('▶ 重做：补页失效再次生效');
await click('重做');
check('重做后已失效恢复', text().includes('已失效'));

console.log('▶ 模拟刷新：卸载后重新挂载，从 localStorage 恢复');
unmount();
await flush();
const remount = mount();
await flush();
check('刷新后仍是已失效终态', text().includes('已失效'));
check('刷新后链上决定数完整（含 INVALIDATE）', text().includes('版本失效'));

console.log('▶ 运行右栏全部验收场景断言');
await click('一键运行全部断言');
await flush();
check('页面显示 5/5 场景通过', text().includes('5/5 通过'));

remount();
if (failures) {
  console.log(`\n💥 UI 冒烟存在 ${failures} 个失败`);
  process.exit(1);
}
console.log('\n🎉 UI 交互冒烟全部通过');
