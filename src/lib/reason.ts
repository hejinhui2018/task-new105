import type { ReasonCode } from '../types';

/** 原因码 → 法务可读的中文解释。台账与拒绝徽章共用同一份文案。 */
export const REASON_LABELS: Record<ReasonCode, string> = {
  OK: '校验通过',
  RUN_INACTIVE: '流程已终止，回执晚到',
  EXPIRED: '签署链接已过期',
  STALE_FINGERPRINT: '文件指纹不匹配：回执锁定的版本已被替换',
  ALREADY_SIGNED: '重复签署：该槽位已有有效签名',
  NOT_IDENTIFIED: '身份未确认：回执记录的身份确认状态为否',
  PREV_NOT_SIGNED: '越序签署：前序角色尚未完成有效签名',
  HASH_MISMATCH: '前序状态哈希不匹配：回执发出后链上又发生了决定',
  SLOT_TERMINAL: '槽位已处于终态，无法接受该决定',
  LOST_IN_TRANSIT: '回执在传输途中丢失，未到达服务端',
  NOTHING_TO_RECALL: '当前没有可撤回的在途签署',
  NO_ACTIVE_RUN: '没有进行中的签署流程',
};

export const REASON_ADVICE: Partial<Record<ReasonCode, string>> = {
  STALE_FINGERPRINT: '文件补页/换版后旧签名即时标失效，需要基于新版本重新发起整轮签署。',
  ALREADY_SIGNED: '重复回执不产生第二份签名；若对方确实未看到结果，请核对传输记录后重发。',
  EXPIRED: '过期回执不会“复活”旧链接，只能重新发起并重新计算有效期。',
  PREV_NOT_SIGNED: '必须严格按员工 → 主管 → 外部合作方的顺序，前序完成后后序才能生效。',
  HASH_MISMATCH: '该回执发出后流程状态已变化（例如链路推进或被撤回），内容不能再套用。',
  RUN_INACTIVE: '流程已拒绝/撤回/过期/被新版本取代，晚到回执一律不入链。',
  LOST_IN_TRANSIT: '对方端操作成功的回执没有送达；链接仍在有效期内，可重新提交或等待超时。',
  NOT_IDENTIFIED: '请先完成该角色的身份确认（人脸/口令/二次验证）再签署。',
};
