import type {
  Action,
  Decision,
  DecisionAction,
  DocVersion,
  FlowState,
  PendingMessage,
  ReasonCode,
  Role,
  RoleId,
  SignRun,
  Slot,
} from '../types';
import { decisionHash, docFingerprint, genesisHash } from './hash';
import { REASON_LABELS } from './reason';

/** 虚拟时钟：每一步 10 分钟；签署链接 9 步（90 分钟）后过期 */
export const TICK_MINUTES = 10;
export const EXPIRE_TICKS = 9;

export const ROLE_ORDER: RoleId[] = ['employee', 'manager', 'partner'];

export const ROLES: Record<RoleId, Role> = {
  employee: {
    id: 'employee',
    name: '李晓',
    title: '员工',
    kind: 'internal',
    org: '本公司法务部',
  },
  manager: {
    id: 'manager',
    name: '王敏',
    title: '主管',
    kind: 'internal',
    org: '本公司合规组',
  },
  partner: {
    id: 'partner',
    name: '陈睿',
    title: '外部合作方',
    kind: 'external',
    org: '祥云咨询（外部）',
  },
};

const INITIAL_PAGES = [
  '首页 · 服务协议条款',
  '第2页 · 保密与竞业',
  '第3页 · 费用与结算',
  '第4页 · 签署页',
];

/** 模块级序号配合 state.idCounter：LOAD 恢复后也不会产生重复 id */
let uid = 0;
function nextId(state: FlowState, prefix: string): string {
  state.idCounter += 1;
  uid = Math.max(uid, state.idCounter);
  return `${prefix}-${state.idCounter}`;
}

export function formatClock(clock: number): string {
  const day = Math.floor(clock / 1440) + 1;
  const h = Math.floor((clock % 1440) / 60);
  const m = clock % 60;
  return `D${day} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function makeSlot(index: number, roleId: RoleId): Slot {
  return {
    index,
    roleId,
    status: 'waiting',
    sentAt: null,
    viewedAt: null,
    signedAt: null,
    signedFingerprint: null,
    signedPrevHash: null,
    identitySnapshot: null,
    expiresAt: null,
    terminalReason: null,
    decisionIds: [],
  };
}

export function createInitialState(): FlowState {
  const fingerprint = docFingerprint(1, INITIAL_PAGES);
  const v1: DocVersion = {
    version: 1,
    reason: '文件定稿，首次发起',
    pages: [...INITIAL_PAGES],
    fingerprint,
    parentFingerprint: null,
    createdAt: 0,
  };
  return {
    clock: 0,
    roles: ROLES,
    order: [...ROLE_ORDER],
    pages: [...INITIAL_PAGES],
    versions: [v1],
    currentFingerprint: fingerprint,
    runs: [],
    activeRunId: null,
    queue: [],
    identity: { employee: true, manager: true, partner: false },
    faults: { dropNext: false, duplicateNext: false, delayNext: 0, garbleHeadNext: false },
    baseLatency: 1,
    idCounter: 0,
  };
}

interface DecisionInput {
  run: SignRun;
  action: DecisionAction;
  actor: RoleId | 'system' | 'initiator';
  fingerprint: string;
  accepted: boolean;
  /** 是否推动 headHash。查看类回执留痕但不改链，避免阻断后续签署。 */
  advanceChain: boolean;
  reasonCode: ReasonCode;
  detail: string;
}

/**
 * 追加一条决定：accepted 且 advanceChain 的决定把自身哈希接到链头；
 * 被拒绝的决定、查看回执留痕但不改变链头。
 */
function appendDecision(state: FlowState, input: DecisionInput): Decision {
  const { run } = input;
  const decision: Decision = {
    id: nextId(state, 'dec'),
    action: input.action,
    actor: input.actor,
    at: state.clock,
    docFingerprint: input.fingerprint,
    prevHash: run.headHash,
    hash: '',
    result: input.accepted ? 'ACCEPTED' : 'REJECTED',
    reasonCode: input.reasonCode,
    detail: input.detail,
  };
  decision.hash = decisionHash({
    action: decision.action,
    actor: decision.actor,
    at: decision.at,
    fingerprint: decision.docFingerprint,
    prevHash: decision.prevHash,
    result: decision.result,
    reasonCode: decision.reasonCode,
    detail: decision.detail,
  });
  run.decisions.push(decision);
  if (input.accepted && input.advanceChain) run.headHash = decision.hash;
  return decision;
}

function roleName(state: FlowState, roleId: RoleId): string {
  return state.roles[roleId].title;
}

function startRun(draft: FlowState): void {
  if (draft.activeRunId) return;
  const round = draft.runs.length + 1;
  const g = genesisHash(draft.currentFingerprint, draft.order);
  const run: SignRun = {
    id: nextId(draft, 'run'),
    label: `第 ${round} 轮发起`,
    startedAt: draft.clock,
    fingerprint: draft.currentFingerprint,
    order: [...draft.order],
    genesisHash: g,
    headHash: g,
    slots: draft.order.map((roleId, i) => makeSlot(i, roleId)),
    status: 'active',
    endState: null,
    decisions: [],
  };
  appendDecision(draft, {
    run,
    action: 'START',
    actor: 'initiator',
    fingerprint: run.fingerprint,
    accepted: true,
    advanceChain: true,
    reasonCode: 'OK',
    detail: `基于文件指纹 ${run.fingerprint} 发起，顺序：${run.order
      .map((r) => roleName(draft, r))
      .join(' → ')}`,
  });
  // 发起即向第一个角色发送
  const first = run.slots[0];
  first.status = 'sent';
  first.sentAt = draft.clock;
  first.expiresAt = draft.clock + EXPIRE_TICKS * TICK_MINUTES;
  const sent = appendDecision(draft, {
    run,
    action: 'SEND',
    actor: 'initiator',
    fingerprint: run.fingerprint,
    accepted: true,
    advanceChain: false,
    reasonCode: 'OK',
    detail: `签署链接发送给${roleName(draft, first.roleId)}，有效期 ${EXPIRE_TICKS * TICK_MINUTES} 分钟`,
  });
  first.decisionIds.push(sent.id);
  draft.runs.push(run);
  draft.activeRunId = run.id;
}

function sendNextSlot(draft: FlowState, run: SignRun, signedIndex: number): void {
  const next = run.slots[signedIndex + 1];
  if (!next) {
    run.status = 'completed';
    run.endState = 'completed';
    draft.activeRunId = null;
    appendDecision(draft, {
      run,
      action: 'SEND',
      actor: 'system',
      fingerprint: run.fingerprint,
      accepted: true,
      advanceChain: true,
      reasonCode: 'OK',
      detail: '全部角色完成签署，整份文件定稿封存',
    });
    return;
  }
  next.status = 'sent';
  next.sentAt = draft.clock;
  next.expiresAt = draft.clock + EXPIRE_TICKS * TICK_MINUTES;
  const d = appendDecision(draft, {
    run,
    action: 'SEND',
    actor: 'initiator',
    fingerprint: run.fingerprint,
    accepted: true,
    advanceChain: false,
    reasonCode: 'OK',
    detail: `前序签名已入链，签署链接发送给${roleName(draft, next.roleId)}`,
  });
  next.decisionIds.push(d.id);
}

function failRun(run: SignRun, endState: SignRun['endState']): void {
  run.status = 'failed';
  run.endState = endState;
}

/** 回执到达时的统一校验，返回原因码（OK 表示可接受）。顺序即判定优先级。 */
function validateReceipt(
  draft: FlowState,
  run: SignRun,
  slot: Slot,
  msg: PendingMessage,
): ReasonCode {
  // 1. 回执锁定的指纹必须仍是当前文件指纹（补页/换版后旧版本回执即失效）
  if (msg.fingerprint !== draft.currentFingerprint) return 'STALE_FINGERPRINT';
  // 2. 链接已过期（槽位已关闭，或在途链接按到达时刻超时）
  if (slot.status === 'expired') return 'EXPIRED';
  if (
    (slot.status === 'sent' || slot.status === 'viewed') &&
    slot.expiresAt !== null &&
    draft.clock > slot.expiresAt
  ) {
    return 'EXPIRED';
  }
  // 3. 流程已终止（拒绝/撤回/被新版本取代）
  if (run.status !== 'active') return 'RUN_INACTIVE';
  // 4. 该槽位已有有效签名
  if (slot.status === 'signed') return 'ALREADY_SIGNED';
  // 5. 其他终态
  if (['refused', 'recalled', 'invalidated'].includes(slot.status)) {
    return 'SLOT_TERMINAL';
  }
  if (msg.kind === 'SIGN') {
    // 6. 身份确认随回执冻结
    if (!msg.identity) return 'NOT_IDENTIFIED';
    // 7. 前序槽位必须持有效签名（严格顺序）
    const prev = run.slots[slot.index - 1];
    if (prev && prev.status !== 'signed') return 'PREV_NOT_SIGNED';
  }
  // 8. 前序状态哈希必须与回执发出时锁定的一致
  if (msg.expectedPrevHash !== run.headHash) return 'HASH_MISMATCH';
  return 'OK';
}

function kindLabel(kind: PendingMessage['kind']): string {
  return kind === 'VIEW' ? '查看' : kind === 'SIGN' ? '签署' : '拒绝';
}

function rejectReceipt(
  draft: FlowState,
  run: SignRun,
  slot: Slot,
  msg: PendingMessage,
  code: ReasonCode,
): void {
  let extra = '';
  if (code === 'STALE_FINGERPRINT') {
    extra = `；回执锁定 ${msg.fingerprint}，当前轮次 ${run.fingerprint}`;
  } else if (code === 'HASH_MISMATCH') {
    extra = `；回执锁定前序 ${msg.expectedPrevHash.slice(0, 9)}…，实际链头 ${run.headHash.slice(0, 9)}…`;
  }
  const tags = [
    msg.source === 'replay' ? '网络重放' : null,
    msg.duplicate ? '重复回执' : null,
    msg.garbledHead ? '前序哈希被篡改' : null,
  ]
    .filter(Boolean)
    .join('，');
  const d = appendDecision(draft, {
    run,
    action: msg.kind,
    actor: msg.roleId,
    fingerprint: msg.fingerprint,
    accepted: false,
    advanceChain: false,
    reasonCode: code,
    detail: `${roleName(draft, msg.roleId)}的${kindLabel(msg.kind)}回执被拒收：${REASON_LABELS[code]}${extra}${tags ? `（${tags}）` : ''}`,
  });
  slot.decisionIds.push(d.id);
}

function acceptReceipt(draft: FlowState, run: SignRun, slot: Slot, msg: PendingMessage): void {
  if (msg.kind === 'VIEW') {
    const firstView = slot.status !== 'viewed';
    slot.status = 'viewed';
    if (firstView) slot.viewedAt = draft.clock;
    const d = appendDecision(draft, {
      run,
      action: 'VIEW',
      actor: msg.roleId,
      fingerprint: msg.fingerprint,
      accepted: true,
      advanceChain: false, // 查看不推进签名链
      reasonCode: 'OK',
      detail: `${roleName(draft, msg.roleId)}已打开文件完成查看${firstView ? '' : '（重复查看，幂等）'}`,
    });
    slot.decisionIds.push(d.id);
    return;
  }

  if (msg.kind === 'REFUSE') {
    slot.status = 'refused';
    slot.terminalReason = msg.refusalReason ?? '对方未填写理由';
    const d = appendDecision(draft, {
      run,
      action: 'REFUSE',
      actor: msg.roleId,
      fingerprint: msg.fingerprint,
      accepted: true,
      advanceChain: true,
      reasonCode: 'OK',
      detail: `${roleName(draft, msg.roleId)}拒绝签署：${slot.terminalReason}。本轮流程终止`,
    });
    slot.decisionIds.push(d.id);
    failRun(run, 'refused');
    draft.activeRunId = null;
    return;
  }

  // SIGN
  slot.status = 'signed';
  slot.signedAt = draft.clock;
  slot.signedFingerprint = msg.fingerprint;
  slot.signedPrevHash = msg.expectedPrevHash;
  slot.identitySnapshot = msg.identity;
  const d = appendDecision(draft, {
    run,
    action: 'SIGN',
    actor: msg.roleId,
    fingerprint: msg.fingerprint,
    accepted: true,
    advanceChain: true,
    reasonCode: 'OK',
    detail: `${roleName(draft, msg.roleId)}完成签署：签名绑定指纹 ${msg.fingerprint.slice(0, 9)}… 与前序哈希 ${msg.expectedPrevHash.slice(0, 9)}…，身份确认=${msg.identity ? '是' : '否'}${msg.duplicate ? '（重传回执）' : ''}`,
  });
  slot.decisionIds.push(d.id);
  sendNextSlot(draft, run, slot.index);
}

/** 丢失回执在“应到时刻”入账：台账可见，但服务端状态不变 */
function recordLost(draft: FlowState, msg: PendingMessage): void {
  const run = draft.runs.find((r) => r.id === msg.runId);
  const slot = run?.slots.find((s) => s.roleId === msg.roleId);
  if (!run || !slot) return;
  const d = appendDecision(draft, {
    run,
    action: msg.kind,
    actor: msg.roleId,
    fingerprint: msg.fingerprint,
    accepted: false,
    advanceChain: false,
    reasonCode: 'LOST_IN_TRANSIT',
    detail: `${roleName(draft, msg.roleId)}的${kindLabel(msg.kind)}操作已发出，但回执在传输途中丢失，未到达服务端`,
  });
  slot.decisionIds.push(d.id);
}

function deliverQueue(draft: FlowState): void {
  // 先处理到点的丢失回执
  const lost = draft.queue.filter(
    (m) => m.dropped && m.deliverAt <= draft.clock,
  );
  for (const msg of lost) {
    draft.queue = draft.queue.filter((m) => m.id !== msg.id);
    recordLost(draft, msg);
  }

  const due = draft.queue
    .filter((m) => !m.dropped && m.deliverAt <= draft.clock)
    .sort((a, b) => a.enqueuedAt - b.enqueuedAt || a.id.localeCompare(b.id));
  for (const msg of due) {
    draft.queue = draft.queue.filter((m) => m.id !== msg.id);
    const run = draft.runs.find((r) => r.id === msg.runId);
    const slot = run?.slots.find((s) => s.roleId === msg.roleId);
    if (!run || !slot) continue;
    const code = validateReceipt(draft, run, slot, msg);
    if (code === 'OK') acceptReceipt(draft, run, slot, msg);
    else rejectReceipt(draft, run, slot, msg, code);
  }
}

/** 时钟推进后：把在途但超过有效期的槽位关闭为过期 */
function applyExpiry(draft: FlowState): void {
  const run = draft.runs.find((r) => r.id === draft.activeRunId);
  if (!run || run.status !== 'active') return;
  for (const slot of run.slots) {
    if (
      (slot.status === 'sent' || slot.status === 'viewed') &&
      slot.expiresAt !== null &&
      draft.clock > slot.expiresAt
    ) {
      slot.status = 'expired';
      slot.terminalReason = `${EXPIRE_TICKS * TICK_MINUTES} 分钟内未完成签署`;
      appendDecision(draft, {
        run,
        action: 'EXPIRE',
        actor: 'system',
        fingerprint: run.fingerprint,
        accepted: true,
        advanceChain: true,
        reasonCode: 'OK',
        detail: `${roleName(draft, slot.roleId)}的签署链接超时（应于 ${slot.expiresAt} 前完成），本轮流程终止`,
      });
      failRun(run, 'expired');
      draft.activeRunId = null;
      return;
    }
  }
}

interface EnqueueOptions {
  manual?: boolean;
  reason?: string;
  runId?: string;
  delayTicks?: number;
}

function enqueueReceipt(
  draft: FlowState,
  roleId: RoleId,
  kind: PendingMessage['kind'],
  opts: EnqueueOptions = {},
): void {
  let run: SignRun | undefined;
  if (opts.manual) {
    // 手动注入（晚到/重放）：可针对任意一轮，包括已结束的轮次
    run = opts.runId
      ? draft.runs.find((r) => r.id === opts.runId)
      : [...draft.runs].reverse().find((r) => r.slots.some((s) => s.roleId === roleId));
  } else {
    run = draft.runs.find((r) => r.id === draft.activeRunId);
  }
  if (!run) return;
  const slot = run.slots.find((s) => s.roleId === roleId);
  if (!slot) return;
  if (!opts.manual && !(slot.status === 'sent' || slot.status === 'viewed')) return;

  const base: PendingMessage = {
    id: nextId(draft, 'msg'),
    runId: run.id,
    roleId,
    kind,
    fingerprint: run.fingerprint,
    expectedPrevHash: run.headHash,
    identity: draft.identity[roleId],
    refusalReason: kind === 'REFUSE' ? (opts.reason ?? '条款待确认') : null,
    enqueuedAt: draft.clock,
    deliverAt: draft.clock + draft.baseLatency * TICK_MINUTES,
    dropped: false,
    duplicate: false,
    source: opts.manual ? 'replay' : 'normal',
    garbledHead: false,
  };

  const copies: PendingMessage[] = [base];
  if (!opts.manual) {
    if (draft.faults.duplicateNext) {
      copies.push({ ...base, id: nextId(draft, 'msg'), duplicate: true });
    }
    if (draft.faults.delayNext > 0) {
      for (const m of copies) m.deliverAt += draft.faults.delayNext * TICK_MINUTES;
    }
    if (draft.faults.garbleHeadNext) {
      for (const m of copies) {
        // 翻转前序哈希首枚十六进制位，保证与真实链头不同
        const body = m.expectedPrevHash.slice(2);
        const flipped = (parseInt(body[0], 16) ^ 0xf).toString(16) + body.slice(1);
        m.expectedPrevHash = '0x' + flipped;
        m.garbledHead = true;
      }
    }
    if (draft.faults.dropNext) base.dropped = true;
    draft.faults = {
      dropNext: false,
      duplicateNext: false,
      delayNext: 0,
      garbleHeadNext: false,
    };
  } else if (opts.delayTicks) {
    base.deliverAt = draft.clock + Math.max(1, opts.delayTicks) * TICK_MINUTES;
  }

  draft.queue.push(...copies);
}

function recall(draft: FlowState): void {
  const run = draft.runs.find((r) => r.id === draft.activeRunId);
  if (!run || run.status !== 'active') return;
  const pending = run.slots.filter((s) =>
    ['waiting', 'sent', 'viewed'].includes(s.status),
  );
  if (pending.length === 0) return;
  for (const slot of pending) {
    slot.status = 'recalled';
    slot.terminalReason = '发起人撤回本轮签署';
  }
  appendDecision(draft, {
    run,
    action: 'RECALL',
    actor: 'initiator',
    fingerprint: run.fingerprint,
    accepted: true,
    advanceChain: true,
    reasonCode: 'OK',
    detail: `发起人撤回流程，${pending.map((s) => roleName(draft, s.roleId)).join('、')}的在途链接作废；已完成的签名保留留痕，需重新发起`,
  });
  failRun(run, 'recalled');
  draft.activeRunId = null;
}

function amend(draft: FlowState, pageLabel?: string): void {
  const version = draft.versions[draft.versions.length - 1].version + 1;
  const label = pageLabel?.trim() || `补页 ${draft.pages.length + 1} · 附加约定`;
  const pages = [...draft.pages, label];
  const fingerprint = docFingerprint(version, pages);
  const v: DocVersion = {
    version,
    reason: '文件补页/换版',
    pages,
    fingerprint,
    parentFingerprint: draft.currentFingerprint,
    createdAt: draft.clock,
  };
  draft.pages = pages;
  draft.versions.push(v);
  draft.currentFingerprint = fingerprint;

  const run = draft.runs.find((r) => r.id === draft.activeRunId);
  if (run) {
    const signed = run.slots.filter((s) => s.status === 'signed');
    const pending = run.slots.filter((s) =>
      ['waiting', 'sent', 'viewed'].includes(s.status),
    );
    for (const slot of run.slots) {
      if (slot.status === 'signed') {
        slot.status = 'invalidated';
        slot.terminalReason = `文件已补页为 v${version}，旧指纹签名即时失效`;
      } else if (pending.includes(slot)) {
        slot.status = 'recalled';
        slot.terminalReason = '文件补页，未签署的链接作废';
      }
    }
    appendDecision(draft, {
      run,
      action: 'INVALIDATE',
      actor: 'system',
      fingerprint: run.fingerprint,
      accepted: true,
      advanceChain: true,
      reasonCode: 'OK',
      detail: `文件补页：「${label}」。新指纹 ${fingerprint}；${signed.length} 个旧签名即时标失效，${pending.length} 个未签署链接作废，需基于新版本重新发起整轮签署`,
    });
    failRun(run, 'superseded');
    draft.activeRunId = null;
  }
}

export function reducer(prev: FlowState, action: Action): FlowState {
  switch (action.type) {
    case 'LOAD':
      return action.state;
    case 'RESET':
      return createInitialState();
    case 'TICK': {
      const draft = structuredClone(prev);
      draft.clock += TICK_MINUTES;
      deliverQueue(draft);
      applyExpiry(draft);
      return draft;
    }
    case 'TOGGLE_IDENTITY': {
      const draft = structuredClone(prev);
      draft.identity[action.roleId] = !draft.identity[action.roleId];
      return draft;
    }
    case 'REORDER': {
      if (prev.activeRunId) return prev;
      const draft = structuredClone(prev);
      draft.order = [...action.order];
      return draft;
    }
    case 'SET_LATENCY': {
      const draft = structuredClone(prev);
      draft.baseLatency = Math.max(1, Math.min(6, action.ticks));
      return draft;
    }
    case 'SET_FAULT': {
      const draft = structuredClone(prev);
      draft.faults = { ...draft.faults, ...action.patch };
      return draft;
    }
    case 'START_RUN': {
      if (prev.activeRunId) return prev;
      const draft = structuredClone(prev);
      startRun(draft);
      return draft;
    }
    case 'RECALL': {
      if (!prev.activeRunId) return prev;
      const draft = structuredClone(prev);
      recall(draft);
      return draft;
    }
    case 'AMEND': {
      const draft = structuredClone(prev);
      amend(draft, action.pageLabel);
      return draft;
    }
    case 'ENQUEUE_DECISION': {
      if (!prev.activeRunId) return prev;
      const draft = structuredClone(prev);
      enqueueReceipt(draft, action.roleId, action.kind, { reason: action.reason });
      return draft;
    }
    case 'INJECT_RECEIPT': {
      const draft = structuredClone(prev);
      // 手动注入：不消耗故障开关，模拟网络层重放/晚到的回执
      enqueueReceipt(draft, action.roleId, action.kind, {
        manual: true,
        runId: action.runId,
        delayTicks: action.delayTicks,
      });
      return draft;
    }
    default:
      return prev;
  }
}
