import type { DecisionAction, SlotStatus } from '../types';

interface Meta {
  label: string;
  tone: 'gray' | 'blue' | 'cyan' | 'green' | 'red' | 'orange' | 'purple';
  icon?: string;
}

export const SLOT_META: Record<SlotStatus, Meta> = {
  waiting: { label: '待发送', tone: 'gray', icon: '○' },
  sent: { label: '已发送', tone: 'blue', icon: '✉' },
  viewed: { label: '已查看', tone: 'cyan', icon: '👁' },
  signed: { label: '已签署', tone: 'green', icon: '✓' },
  refused: { label: '已拒绝', tone: 'red', icon: '✕' },
  recalled: { label: '已撤回', tone: 'orange', icon: '↩' },
  expired: { label: '已过期', tone: 'red', icon: '⏱' },
  invalidated: { label: '已失效', tone: 'red', icon: '⚠' },
};

export const ACTION_META: Record<DecisionAction, Meta> = {
  START: { label: '发起', tone: 'purple', icon: '▶' },
  SEND: { label: '发送', tone: 'blue', icon: '✉' },
  VIEW: { label: '查看', tone: 'cyan', icon: '👁' },
  SIGN: { label: '签署', tone: 'green', icon: '✎' },
  REFUSE: { label: '拒绝', tone: 'red', icon: '✕' },
  RECALL: { label: '撤回', tone: 'orange', icon: '↩' },
  EXPIRE: { label: '过期', tone: 'gray', icon: '⏱' },
  INVALIDATE: { label: '版本失效', tone: 'red', icon: '⚠' },
};

export const END_STATE_LABELS: Record<string, { label: string; tone: Meta['tone'] }> = {
  completed: { label: '已完成封存', tone: 'green' },
  refused: { label: '被拒绝终止', tone: 'red' },
  recalled: { label: '已撤回终止', tone: 'orange' },
  expired: { label: '过期终止', tone: 'red' },
  superseded: { label: '被新版本取代', tone: 'red' },
};

export const RECEIPT_KIND_LABEL: Record<string, string> = {
  VIEW: '查看回执',
  SIGN: '签署回执',
  REFUSE: '拒绝回执',
};
