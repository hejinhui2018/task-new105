import type { FlowStore } from '../lib/useFlowStore';
import type { Decision } from '../types';
import { formatClock } from '../lib/engine';
import { short } from '../lib/hash';
import { ACTION_META } from '../lib/statusMeta';
import { REASON_LABELS } from '../lib/reason';

function actorLabel(store: FlowStore, actor: Decision['actor']): string {
  if (actor === 'system') return '系统';
  if (actor === 'initiator') return '发起人';
  return store.state.roles[actor].title;
}

/** 该决定是否真正接入哈希链：它是当前链头，或被下一条入链决定引用 */
function isOnChain(decisions: Decision[], d: Decision): boolean {
  if (d.result !== 'ACCEPTED') return false;
  if (decisions.some((x) => x.prevHash === d.hash)) return true;
  return decisions[decisions.length - 1]?.hash === d.hash;
}

export function LedgerPanel({ store }: { store: FlowStore }) {
  const all = store.state.runs.flatMap((r) =>
    r.decisions.map((d) => ({ run: r, decision: d })),
  );
  const rejectedCount = all.filter((x) => x.decision.result === 'REJECTED').length;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>📒 审计台账</h2>
        <span className="sub">
          {all.length} 条决定 · {rejectedCount} 条拒收
        </span>
      </div>
      <div className="panel-body tight">
        {all.length === 0 ? (
          <p className="hint-text" style={{ padding: '10px 6px' }}>
            每个决定（含被拒收的回执）都会在此留痕，并绑定当时的文件指纹与前序哈希。
          </p>
        ) : (
          <div className="ledger">
            {[...all].reverse().map(({ run, decision: d }) => {
              const meta = ACTION_META[d.action];
              const onChain = isOnChain(run.decisions, d);
              return (
                <div key={d.id} className={`ledger-item ${d.result === 'REJECTED' ? 'rejected' : ''}`}>
                  <div className="ledger-time">{formatClock(d.at)}</div>
                  <div className="ledger-body">
                    <div className="ledger-line">
                      <span className={`badge ${meta.tone}`} style={{ marginRight: 6 }}>
                        {meta.icon} {meta.label}
                      </span>
                      <b>{actorLabel(store, d.actor)}</b>
                      {d.result === 'REJECTED' ? (
                        <span className="badge red" style={{ marginLeft: 6 }}>
                          拒收 · {d.reasonCode}
                        </span>
                      ) : onChain ? (
                        <span className="badge green" style={{ marginLeft: 6 }}>
                          已入链
                        </span>
                      ) : (
                        <span className="badge gray" style={{ marginLeft: 6 }}>
                          留痕不入链
                        </span>
                      )}
                      <span className="hint-text" style={{ marginLeft: 6 }}>
                        {run.label}
                      </span>
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 3 }}>
                      {d.detail}
                    </div>
                    {d.result === 'REJECTED' && d.reasonCode !== 'OK' && (
                      <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 2 }}>
                        判定依据：{REASON_LABELS[d.reasonCode]}
                      </div>
                    )}
                    <div className="ledger-hashes">
                      <span>FP {short(d.docFingerprint)}</span>
                      <span>prev {short(d.prevHash)}</span>
                      <span className={onChain ? 'chain-ok' : 'chain-skip'}>
                        hash {short(d.hash)} {onChain ? '🔗' : '↷'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
