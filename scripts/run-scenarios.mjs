// 验收场景的命令行运行器：用 esbuild 把 TS 领域层打包后在 Node 中执行全部断言。
// 用法：npm test
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const result = await build({
  entryPoints: ['src/lib/scenarios.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
});

const dir = mkdtempSync(join(tmpdir(), 'signflow-'));
const file = join(dir, 'scenarios.mjs');
writeFileSync(file, result.outputFiles[0].text);

const { SCENARIOS, runScenario } = await import(pathToFileURL(file).href);

let failures = 0;
for (const scenario of SCENARIOS) {
  const r = runScenario(scenario);
  console.log(`\n${r.pass ? '✅' : '❌'} ${scenario.name}`);
  for (const a of r.assertions) {
    console.log(
      `   ${a.pass ? '✓' : '✕'} ${a.name}` +
        (a.pass ? '' : `\n       预期：${a.expected}｜实际：${a.actual}`),
    );
    if (!a.pass) failures += 1;
  }
}

console.log(
  `\n${failures === 0 ? '🎉 全部通过' : `💥 ${failures} 条断言失败`}：${SCENARIOS.length} 个场景，` +
    `${SCENARIOS.reduce((n, s) => n + s.assertions.length, 0)} 条断言`,
);
process.exit(failures ? 1 : 0);
