import { useMemo, useState } from 'react';
import type { FlowStore } from '../lib/useFlowStore';
import type { ScenarioResult } from '../lib/scenarios';
import { runScenario, SCENARIOS } from '../lib/scenarios';
import { formatClock } from '../lib/engine';

type Results = Record<string, ScenarioResult | undefined>;

export function ScenariosPanel({ store }: { store: FlowStore }) {
  const [results, setResults] = useState<Results>({});
  const [openId, setOpenId] = useState<string | null>(SCENARIOS[0].id);

  const passedCount = useMemo(
    () => Object.values(results).filter((r) => r?.pass).length,
    [results],
  );

  const runOne = (id: string, loadCanvas: boolean) => {
    const scenario = SCENARIOS.find((s) => s.id === id)!;
    const result = runScenario(scenario);
    setResults((prev) => ({ ...prev, [id]: result }));
    setOpenId(id);
    if (loadCanvas) {
      store.loadState(result.final);
      store.setPlaying(false);
    }
  };

  const runAll = () => {
    const next: Results = {};
    for (const s of SCENARIOS) next[s.id] = runScenario(s);
    setResults(next);
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>✅ 验收场景与断言</h2>
        <span className="sub">{passedCount}/{SCENARIOS.length} 通过</span>
      </div>
      <div className="panel-body">
        <div className="scenario-summary">
          <button className="primary small" onClick={runAll}>
            一键运行全部断言
          </button>
          <span className="hint-text">断言在隔离环境中运行，不影响画布；可把最终态载入画布检视。</span>
        </div>

        {SCENARIOS.map((s) => {
          const result = results[s.id];
          const open = openId === s.id;
          return (
            <div key={s.id} className={`scenario-item ${open ? 'open' : ''}`}>
              <div className="scenario-head">
                <span className="s-name">{s.name}</span>
                {result && (
                  <span className={`badge ${result.pass ? 'green' : 'red'}`}>
                    {result.pass ? `✓ ${result.assertions.length}/${result.assertions.length}` : `✕ ${result.assertions.filter((a) => a.pass).length}/${result.assertions.length}`}
                  </span>
                )}
                <button className="small" onClick={() => setOpenId(open ? null : s.id)}>
                  {open ? '收起' : '展开'}
                </button>
              </div>

              {open && (
                <>
                  <p className="scenario-goal">{s.goal}</p>
                  <p className="scenario-expect">预期：{s.expect}</p>
                  <div className="inline-actions">
                    <button className="small" onClick={() => runOne(s.id, false)}>
                      ▶ 运行断言
                    </button>
                    <button className="small" onClick={() => runOne(s.id, true)}>
                      ⤓ 运行并载入最终态
                    </button>
                  </div>

                  <details style={{ marginTop: 8 }}>
                    <summary className="hint-text" style={{ cursor: 'pointer' }}>
                      脚本步骤（{s.steps.length} 步）
                    </summary>
                    <ul className="step-list">
                      {s.steps.map((step, i) => (
                        <li key={i} className={result ? 'done' : ''}>
                          {step.label}
                          {step.ticks ? (
                            <span className="hint-text">
                              {' '}
                              → +{step.ticks * 10} 分钟
                              {result ? `（${formatClock(result.steps[i].clock)}）` : ''}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </details>

                  {result && (
                    <ul className="assertion-list">
                      {result.assertions.map((a, i) => (
                        <li key={i} className={a.pass ? 'pass' : 'fail'}>
                          <span className="a-mark">{a.pass ? '✓' : '✕'}</span>
                          <span>
                            {a.name}
                            {!a.pass && (
                              <div className="a-detail">
                                预期：{a.expected} ｜ 实际：{a.actual}
                              </div>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
