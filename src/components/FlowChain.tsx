import type { FlowStore } from '../lib/useFlowStore';
import type { FlowState, Slot } from '../types';
import { EXPIRE_TICKS, formatClock, TICK_MINUTES } from '../lib/engine';
import { short } from '../lib/hash';
import { END_STATE_LABELS, SLOT_META } from '../lib/statusMeta';

/* ------------------------------ 流程操作条 ------------------------------ */

export function FlowControls({ store }: { store: FlowStore }) {
  const { state, act } = store;
  const active = state.runs.find((r) => r.id === state.activeRunId);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>🔀 签署流程</h2>
        <span className="sub">
          发起即锁定文件指纹与角色顺序 · 链接有效期 {EXPIRE_TICKS * TICK_MINUTES} 分钟
        </span>
      </div>
      <div
        className="panel-body"
        style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}
      >
        <button className="primary" disabled={!!state.activeRunId} onClick={() => act({ type: 'START_RUN' })}>
          ▶ {state.runs.length === 0 ? '发起签署' : `重新发起（第 ${state.runs.length + 1} 轮）`}
        </button>
        <button className="danger" disabled={!state.activeRunId} onClick={() => act({ type: 'RECALL' })}>
          ↩ 撤回当前轮次
        </button>
        <div style={{ marginLeft: 'auto' }} className="hint-text">
          {active ? (
            <>
              当前轮次锁定指纹 <span className="mono" style={{ color: 'var(--cyan)' }}>{short(active.fingerprint)}</span>
              {active.fingerprint !== state.currentFingerprint && (
                <span className="badge red" style={{ marginLeft: 8 }}>
                  ⚠ 文件已换版，此轮旧回执将全部按指纹拒收
                </span>
              )}
            </>
          ) : state.runs.length > 0 ? (
            '当前没有进行中的轮次，可重新发起或查看历史轮次。'
          ) : (
            '尚未发起任何轮次。'
          )}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ 单槽位操作 ------------------------------ */

function dispatchSlotAction(act: FlowStore['act'], slot: Slot, kind: 'VIEW' | 'SIGN' | 'REFUSE') {
  if (kind === 'REFUSE') {
    const reason = window.prompt('请输入拒绝理由（将写入台账）', '需再确认费用条款');
    act({ type: 'ENQUEUE_DECISION', roleId: slot.roleId, kind: 'REFUSE', reason: reason ?? undefined });
    return;
  }
  act({ type: 'ENQUEUE_DECISION', roleId: slot.roleId, kind });
}

function SlotActions({
  store,
  runId,
  slot,
}: {
  store: FlowStore;
  runId: string;
  slot: Slot;
}) {
  const { state, act } = store;
  if (state.activeRunId !== runId) return null;
  if (slot.status !== 'sent' && slot.status !== 'viewed') return null;
  const identified = state.identity[slot.roleId];
  return (
    <div className="node-actions">
      <button
        className="small"
        disabled={slot.status === 'viewed'}
        onClick={() => dispatchSlotAction(act, slot, 'VIEW')}
      >
        👁 查看
      </button>
      <button className="small success" onClick={() => dispatchSlotAction(act, slot, 'SIGN')}>
        ✓ 签署{identified ? '' : '（身份未确认）'}
      </button>
      <button className="small danger" onClick={() => dispatchSlotAction(act, slot, 'REFUSE')}>
        ✕ 拒绝
      </button>
    </div>
  );
}

/* ------------------------------ 单槽位卡片 ------------------------------ */

function remainingMinutes(state: FlowState, slot: Slot): number | null {
  if (slot.expiresAt === null) return null;
  if (slot.status !== 'sent' && slot.status !== 'viewed') return null;
  return Math.max(0, slot.expiresAt - state.clock);
}

const BROKEN = ['refused', 'expired', 'recalled', 'invalidated'];

function SlotCard({
  store,
  runId,
  slot,
  first,
}: {
  store: FlowStore;
  runId: string;
  slot: Slot;
  first: boolean;
}) {
  const { state } = store;
  const meta = SLOT_META[slot.status];
  const role = state.roles[slot.roleId];
  const remain = remainingMinutes(state, slot);
  const linkState = slot.status === 'signed' ? 'linked' : BROKEN.includes(slot.status) ? 'broken' : '';

  return (
    <>
      {!first && (
        <div className={`chain-link ${linkState}`}>
          <span className="link-hash">{slot.status === 'signed' ? short(slot.signedPrevHash) : ''}</span>
          {slot.status === 'signed' ? '🔗→' : BROKEN.includes(slot.status) ? '✕→' : '···→'}
        </div>
      )}
      <div className="chain-node">
        <div className={`node-card ${slot.status}`}>
          <div className="nrole">
            <span className="order-no">{slot.index + 1}</span>
            {role.title}
            <span className={`badge ${meta.tone}`} style={{ marginLeft: 'auto' }}>
              {meta.icon} {meta.label}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
            {role.name} · {role.org}
          </div>
          {slot.status === 'signed' ? (
            <div className="nhash">
              <b>签名绑定</b>
              <br />
              FP {short(slot.signedFingerprint)}
              <br />
              前序 {short(slot.signedPrevHash)}
              <br />
              身份 {slot.identitySnapshot ? '✓ 已确认' : '✗ 未确认'}
            </div>
          ) : (
            <div className="nhash">
              {slot.sentAt !== null && <>发送于 {formatClock(slot.sentAt)}</>}
              {slot.viewedAt !== null && <> · 查看于 {formatClock(slot.viewedAt)}</>}
              {remain !== null && (
                <>
                  <br />
                  <span style={{ color: remain <= 30 ? 'var(--red)' : 'var(--text-dim)' }}>
                    ⏱ 剩余 {remain} 分钟
                  </span>
                </>
              )}
            </div>
          )}
          {slot.terminalReason && <div className="nreason">{slot.terminalReason}</div>}
          <div className="ntime">{slot.signedAt !== null ? `签署于 ${formatClock(slot.signedAt)}` : ''}</div>
        </div>
        <SlotActions store={store} runId={runId} slot={slot} />
      </div>
    </>
  );
}

/* ------------------------------ 轮次区块 ------------------------------ */

export function FlowChain({ store }: { store: FlowStore }) {
  const { state } = store;
  const runs = [...state.runs].reverse();

  if (runs.length === 0) {
    return (
      <section className="panel">
        <div className="empty-hint">
          还没有签署轮次。
          <br />
          点击上方「发起签署」开始第一轮，或直接运行右栏的验收场景。
        </div>
      </section>
    );
  }

  return (
    <>
      {runs.map((run) => {
        const active = run.id === state.activeRunId;
        const end = run.endState ? END_STATE_LABELS[run.endState] : null;
        return (
          <section key={run.id} className={`panel run-block ${active ? 'active' : ''}`}>
            <div className="run-head">
              <span className="run-title">{run.label}</span>
              {active ? (
                <span className="badge blue">● 进行中</span>
              ) : run.status === 'completed' ? (
                <span className="badge green">✓ {end?.label ?? '已完成'}</span>
              ) : (
                <span className="badge red">✕ {end?.label ?? '已终止'}</span>
              )}
              <span className="hint-text" style={{ marginLeft: 'auto' }}>
                发起 {formatClock(run.startedAt)} · 顺序 {run.order.map((r) => state.roles[r].title).join('→')}
              </span>
            </div>
            <div className="genesis-line">
              创世锚点（指纹+顺序）：<span className="mono">{short(run.genesisHash)}</span>
              <span style={{ marginLeft: 'auto' }}>
                当前链头：<span className="mono" style={{ color: 'var(--green)' }}>{short(run.headHash)}</span>
              </span>
            </div>
            <div className="chain-wrap">
              <div className="chain">
                {run.slots.map((slot, i) => (
                  <SlotCard key={slot.index} store={store} runId={run.id} slot={slot} first={i === 0} />
                ))}
              </div>
            </div>
          </section>
        );
      })}
    </>
  );
}

/* ------------------------------ 传输队列 ------------------------------ */

export function QueuePanel({ store }: { store: FlowStore }) {
  const { state } = store;
  const items = [...state.queue].sort((a, b) => a.deliverAt - b.deliverAt);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>📡 传输中的回执</h2>
        <span className="sub">{items.length} 份在途</span>
      </div>
      <div className="panel-body">
        {items.length === 0 ? (
          <p className="hint-text" style={{ margin: 0 }}>
            暂无在途回执。点击角色卡片的「查看 / 签署 / 拒绝」会先生成一份锁定指纹与前序哈希的回执，
            经过基础延迟后在下一个时钟步到达并校验。
          </p>
        ) : (
          items.map((m) => {
            const total = Math.max(1, m.deliverAt - m.enqueuedAt);
            const elapsed = Math.min(total, state.clock - m.enqueuedAt);
            const pct = Math.max(6, Math.round((elapsed / total) * 100));
            const kindLabel =
              m.kind === 'VIEW' ? '查看回执' : m.kind === 'SIGN' ? '签署回执' : '拒绝回执';
            return (
              <div key={m.id} className="queue-item">
                <span className="q-icon">
                  {m.dropped ? '🕳' : m.kind === 'SIGN' ? '✎' : m.kind === 'VIEW' ? '👁' : '✕'}
                </span>
                <div className="q-main">
                  <div className="q-title">
                    {state.roles[m.roleId].title} · {kindLabel}
                    {m.duplicate && (
                      <span className="badge orange" style={{ marginLeft: 6 }}>重复</span>
                    )}
                    {m.source === 'replay' && (
                      <span className="badge purple" style={{ marginLeft: 6 }}>重放</span>
                    )}
                    {m.garbledHead && (
                      <span className="badge red" style={{ marginLeft: 6 }}>哈希篡改</span>
                    )}
                    {m.dropped && (
                      <span className="badge red" style={{ marginLeft: 6 }}>将丢失</span>
                    )}
                  </div>
                  <div className="q-sub">
                    {m.dropped
                      ? '到达时仅登记丢失，不入链'
                      : `应到 ${formatClock(m.deliverAt)} · 锁定 ${short(m.fingerprint)} / prev ${short(m.expectedPrevHash)}`}
                  </div>
                  <div className="progress-track">
                    <div
                      className="progress-bar"
                      style={{ width: `${m.dropped ? 100 : pct}%`, opacity: m.dropped ? 0.3 : 1 }}
                    />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
