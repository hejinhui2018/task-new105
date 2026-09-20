import { useState } from 'react';
import type { FlowStore } from '../lib/useFlowStore';
import type { RoleId } from '../types';
import { formatClock, TICK_MINUTES } from '../lib/engine';
import { short } from '../lib/hash';

/* ------------------------------ 文件版本面板 ------------------------------ */

export function DocumentPanel({ store }: { store: FlowStore }) {
  const { state, act } = store;
  const [label, setLabel] = useState('');
  const latest = state.versions[state.versions.length - 1];

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>📄 文件与版本</h2>
        <span className="sub">补页即换指纹</span>
      </div>
      <div className="panel-body">
        {state.versions.map((v) => {
          const isCurrent = v.version === latest.version;
          const addedCount = v.pages.length - (v.version === 1 ? 0 : state.versions[v.version - 2].pages.length);
          return (
            <div key={v.version} className={`version-card ${isCurrent ? 'current' : ''}`}>
              <div className="version-title">
                v{v.version}
                {isCurrent ? (
                  <span className="badge blue">当前版本</span>
                ) : (
                  <span className="badge gray">已被替换</span>
                )}
                <span className="version-meta" style={{ marginLeft: 'auto', marginBottom: 0 }}>
                  {formatClock(v.createdAt)}
                </span>
              </div>
              <div className="fingerprint">FP {v.fingerprint}</div>
              <ul className="page-list">
                {v.pages.map((p, i) => (
                  <li key={p} className={isCurrent && v.version > 1 && i >= v.pages.length - addedCount ? 'added' : ''}>
                    {p}
                  </li>
                ))}
              </ul>
              {v.parentFingerprint && (
                <div className="version-meta" style={{ marginTop: 6 }}>
                  替换自 <span className="mono">{short(v.parentFingerprint)}</span> · {v.reason}
                </div>
              )}
            </div>
          );
        })}

        <div className="field-label">补页 / 换版（进行中的签名会即时失效）</div>
        <input
          type="text"
          value={label}
          placeholder={`例如：第${state.pages.length + 1}页 · 数据处理附录`}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              act({ type: 'AMEND', pageLabel: label });
              setLabel('');
            }
          }}
        />
        <div className="inline-actions">
          <button
            className="danger"
            onClick={() => {
              act({ type: 'AMEND', pageLabel: label });
              setLabel('');
            }}
          >
            ➕ 补页并更换指纹
          </button>
        </div>
        {state.activeRunId && (
          <p className="hint-text" style={{ marginTop: 8 }}>
            ⚠ 当前有进行中的轮次：补页会让已完成的签名立即标为失效，未签署链接全部作废。
          </p>
        )}
      </div>
    </section>
  );
}

/* ------------------------------ 角色与身份面板 ------------------------------ */

export function RolesPanel({ store }: { store: FlowStore }) {
  const { state, act } = store;
  const locked = !!state.activeRunId;

  const move = (index: number, dir: -1 | 1) => {
    const next = [...state.order];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    act({ type: 'REORDER', order: next });
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>👥 签署角色 · 顺序 · 身份确认</h2>
      </div>
      <div className="panel-body">
        <div className="role-order">
          {state.order.map((roleId: RoleId, i) => {
            const role = state.roles[roleId];
            const identified = state.identity[roleId];
            return (
              <div key={roleId} className="role-row">
                <span className="order-no">{i + 1}</span>
                <div className="role-info">
                  <div className="rname">
                    {role.title} · {role.name}{' '}
                    <span className={`badge ${role.kind === 'external' ? 'purple' : 'gray'}`}>
                      {role.kind === 'external' ? '外部' : '内部'}
                    </span>
                  </div>
                  <div className="rorg">{role.org}</div>
                </div>
                <button
                  className={`identity-pill ${identified ? 'on' : 'off'}`}
                  onClick={() => act({ type: 'TOGGLE_IDENTITY', roleId })}
                  title="模拟该角色是否完成身份确认（人脸/口令/二次验证）"
                >
                  {identified ? '✓ 身份已确认' : '! 身份未确认'}
                </button>
                <div className="order-arrows">
                  <button className="small" disabled={locked || i === 0} onClick={() => move(i, -1)}>
                    ▲
                  </button>
                  <button
                    className="small"
                    disabled={locked || i === state.order.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    ▼
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <p className="hint-text" style={{ marginBottom: 0 }}>
          {locked
            ? '签署进行中不可调整顺序；身份确认状态会随下一份回执冻结。'
            : '可调整签署顺序；身份确认在签署回执到达时校验，未确认的签署会被拒收。'}
        </p>
      </div>
    </section>
  );
}

/* ------------------------------ 故障注入面板 ------------------------------ */

const FAULTS: {
  key: 'dropNext' | 'duplicateNext' | 'garbleHeadNext';
  icon: string;
  name: string;
  desc: string;
}[] = [
  { key: 'dropNext', icon: '🕳', name: '下一回执丢包', desc: '对方已操作，但回执永远不到达服务端' },
  { key: 'duplicateNext', icon: '📮', name: '下一回执重复重传', desc: '网络层重放，第二份应判重复签署' },
  { key: 'garbleHeadNext', icon: '🔐', name: '篡改下一回执前序哈希', desc: '模拟中间人改写，应判哈希不匹配' },
];

export function FaultPanel({ store }: { store: FlowStore }) {
  const { state, act } = store;
  const armed = state.faults;
  const replayRoles: RoleId[] = state.runs.length > 0 ? state.order : [];

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>🧪 传输故障注入</h2>
        <span className="sub">对下一份回执生效一次</span>
      </div>
      <div className="panel-body">
        <div className="fault-grid">
          {FAULTS.map((f) => (
            <button
              key={f.key}
              className={`fault-btn ${armed[f.key] ? 'toggle-on' : ''}`}
              onClick={() => act({ type: 'SET_FAULT', patch: { [f.key]: !armed[f.key] } })}
            >
              <span className="f-icon">{f.icon}</span>
              <span className="f-text">
                <div className="f-name">{f.name}</div>
                <div className="f-desc">{f.desc}</div>
              </span>
              <span className="badge">{armed[f.key] ? '已装填' : '关闭'}</span>
            </button>
          ))}

          <button
            className={`fault-btn ${armed.delayNext > 0 ? 'toggle-on' : ''}`}
            onClick={() =>
              act({ type: 'SET_FAULT', patch: { delayNext: armed.delayNext > 0 ? 0 : 3 } })
            }
          >
            <span className="f-icon">🐢</span>
            <span className="f-text">
              <div className="f-name">下一回执延迟 30 分钟</div>
              <div className="f-desc">晚到但链未变仍有效；跨过补页/过期则被拒收</div>
            </span>
            <span className="badge">{armed.delayNext > 0 ? `+${armed.delayNext * TICK_MINUTES}分` : '关闭'}</span>
          </button>
        </div>

        {(armed.dropNext || armed.duplicateNext || armed.garbleHeadNext || armed.delayNext > 0) && (
          <div className="armed-note">
            📌 故障已装填，将在该角色下一次「查看 / 签署 / 拒绝」时消耗。
          </div>
        )}

        <div className="latency-row">
          <span>基础传输延迟</span>
          <input
            type="range"
            min={1}
            max={6}
            value={state.baseLatency}
            onChange={(e) => act({ type: 'SET_LATENCY', ticks: Number(e.target.value) })}
          />
          <span className="mono">{state.baseLatency * TICK_MINUTES} 分</span>
        </div>

        <div className="section-divider" />

        <div className="field-label" style={{ marginTop: 0 }}>
          手动注入异常回执（重放 / 晚到，锁定最近一轮的旧指纹与前序哈希）
        </div>
        {replayRoles.length === 0 ? (
          <p className="hint-text" style={{ marginBottom: 0 }}>先发起一轮签署后，才能注入回执。</p>
        ) : (
          <div className="fault-grid">
            {replayRoles.map((rid) => (
              <div key={rid} className="queue-item" style={{ marginBottom: 0 }}>
                <span className="q-icon">📨</span>
                <span className="q-main">
                  <span className="q-title">{state.roles[rid].title}</span>
                </span>
                <button
                  className="small"
                  onClick={() => act({ type: 'INJECT_RECEIPT', roleId: rid, kind: 'VIEW', delayTicks: 1 })}
                >
                  重放查看
                </button>
                <button
                  className="small"
                  onClick={() => act({ type: 'INJECT_RECEIPT', roleId: rid, kind: 'SIGN', delayTicks: 1 })}
                >
                  重放签署
                </button>
              </div>
            ))}
            <p className="hint-text" style={{ marginBottom: 0 }}>
              回执将在 10 分钟后到达；若期间补页、撤回、过期或已有他人签名，到达时会给出对应拒收原因。
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
