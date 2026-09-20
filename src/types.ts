// SignFlow 领域模型：文件版本、签署角色、顺序、身份确认、哈希链回执

export type RoleId = 'employee' | 'manager' | 'partner';

export interface Role {
  id: RoleId;
  name: string;
  title: string;
  kind: 'internal' | 'external';
  org: string;
}

/** 一次文件版本（初始版或补页/换版后产生），指纹由全部页内容决定 */
export interface DocVersion {
  version: number;
  reason: string;
  pages: string[];
  fingerprint: string;
  parentFingerprint: string | null;
  createdAt: number;
}

export type SlotStatus =
  | 'waiting' // 尚未轮到
  | 'sent' // 已发送，等待查看/签署
  | 'viewed' // 已查看
  | 'signed' // 已签署（签名锁定指纹与前序哈希）
  | 'refused' // 已拒绝
  | 'recalled' // 已被发起人撤回
  | 'expired' // 已过期
  | 'invalidated'; // 文件变更后旧签名即时失效

/** 判定结果原因码 */
export type ReasonCode =
  | 'OK'
  | 'RUN_INACTIVE'
  | 'EXPIRED'
  | 'STALE_FINGERPRINT'
  | 'ALREADY_SIGNED'
  | 'NOT_IDENTIFIED'
  | 'PREV_NOT_SIGNED'
  | 'HASH_MISMATCH'
  | 'SLOT_TERMINAL'
  | 'LOST_IN_TRANSIT'
  | 'NOTHING_TO_RECALL'
  | 'NO_ACTIVE_RUN';

export type DecisionAction =
  | 'SEND'
  | 'VIEW'
  | 'SIGN'
  | 'REFUSE'
  | 'RECALL'
  | 'EXPIRE'
  | 'INVALIDATE'
  | 'START';

/**
 * 每一个决定都绑定：
 * - 当时的文件指纹 docFingerprint
 * - 前序决定的哈希 prevHash（前序状态）
 * - 决定自身哈希 hash（与前序串联成链）
 * 被拒绝的决定同样入账，但不推动 headHash。
 */
export interface Decision {
  id: string;
  action: DecisionAction;
  actor: RoleId | 'system' | 'initiator';
  at: number;
  docFingerprint: string;
  prevHash: string;
  hash: string;
  result: 'ACCEPTED' | 'REJECTED';
  reasonCode: ReasonCode;
  detail: string;
}

export interface Slot {
  index: number;
  roleId: RoleId;
  status: SlotStatus;
  sentAt: number | null;
  viewedAt: number | null;
  signedAt: number | null;
  signedFingerprint: string | null;
  signedPrevHash: string | null;
  identitySnapshot: boolean | null;
  expiresAt: number | null;
  terminalReason: string | null;
  decisionIds: string[];
}

export interface SignRun {
  id: string;
  label: string;
  startedAt: number;
  fingerprint: string;
  order: RoleId[];
  genesisHash: string;
  headHash: string;
  slots: Slot[];
  status: 'active' | 'completed' | 'failed';
  endState: 'completed' | 'refused' | 'recalled' | 'expired' | 'superseded' | null;
  decisions: Decision[];
}

export type ReceiptKind = 'VIEW' | 'SIGN' | 'REFUSE';

/**
 * 传输中的回执。点击"查看/签署/拒绝"时立即锁定
 * 当时的指纹与前序哈希；到达时再与当前状态核对。
 * 晚到、重复、丢失都通过这张表解释。
 */
export interface PendingMessage {
  id: string;
  runId: string;
  roleId: RoleId;
  kind: ReceiptKind;
  fingerprint: string;
  expectedPrevHash: string;
  identity: boolean;
  refusalReason: string | null;
  enqueuedAt: number;
  deliverAt: number;
  dropped: boolean;
  duplicate: boolean;
  source: 'normal' | 'replay';
  garbledHead: boolean;
}

export interface FaultConfig {
  dropNext: boolean;
  duplicateNext: boolean;
  delayNext: number; // 额外延迟的虚拟分钟数，0 表示不注入
  garbleHeadNext: boolean; // 篡改下一回执锁定的前序哈希
}

export interface FlowState {
  clock: number;
  roles: Record<RoleId, Role>;
  order: RoleId[];
  pages: string[];
  versions: DocVersion[];
  currentFingerprint: string;
  runs: SignRun[];
  activeRunId: string | null;
  queue: PendingMessage[];
  identity: Record<RoleId, boolean>;
  faults: FaultConfig;
  baseLatency: number;
  idCounter: number;
}

export type Action =
  | { type: 'TICK' }
  | { type: 'RESET' }
  | { type: 'LOAD'; state: FlowState }
  | { type: 'TOGGLE_IDENTITY'; roleId: RoleId }
  | { type: 'REORDER'; order: RoleId[] }
  | { type: 'SET_LATENCY'; ticks: number }
  | { type: 'SET_FAULT'; patch: Partial<FaultConfig> }
  | { type: 'START_RUN' }
  | { type: 'RECALL' }
  | { type: 'AMEND'; pageLabel?: string }
  | { type: 'ENQUEUE_DECISION'; roleId: RoleId; kind: ReceiptKind; reason?: string }
  | {
      type: 'INJECT_RECEIPT';
      roleId: RoleId;
      kind: ReceiptKind;
      runId?: string;
      delayTicks?: number;
    };
