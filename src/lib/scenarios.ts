import type { Action, Decision, FlowState, ReasonCode, SignRun } from '../types';
import { createInitialState, reducer, ROLES, TICK_MINUTES } from './engine';

export interface ScenarioStep {
  label: string;
  /** 该步动作（按顺序执行） */
  actions?: Action[];
  /** 动作后推进的虚拟时钟步数（每步 10 分钟） */
  ticks?: number;
}

export interface ScenarioAssertion {
  name: string;
  check: (s: FlowState) => { pass: boolean; expected: string; actual: string };
}

export interface Scenario {
  id: string;
  name: string;
  goal: string;
  expect: string;
  steps: ScenarioStep[];
  assertions: ScenarioAssertion[];
}

export interface StepRecord {
  label: string;
  clock: number;
}

export interface AssertionResult {
  name: string;
  pass: boolean;
  expected: string;
  actual: string;
}

export interface ScenarioResult {
  scenario: Scenario;
  final: FlowState;
  steps: StepRecord[];
  assertions: AssertionResult[];
  pass: boolean;
}

export function runScenario(scenario: Scenario): ScenarioResult {
  let state = createInitialState();
  const records: StepRecord[] = [];
  for (const step of scenario.steps) {
    if (step.actions) {
      for (const a of step.actions) state = reducer(state, a);
    }
    const ticks = step.ticks ?? 0;
    for (let i = 0; i < ticks; i++) state = reducer(state, { type: 'TICK' });
    records.push({ label: step.label, clock: state.clock });
  }
  const assertions = scenario.assertions.map((a) => {
    const r = a.check(state);
    return { name: a.name, ...r };
  });
  return {
    scenario,
    final: state,
    steps: records,
    assertions,
    pass: assertions.every((a) => a.pass),
  };
}

/* ------------------------------- 断言工具 ------------------------------- */

const lastRun = (s: FlowState): SignRun => s.runs[s.runs.length - 1];
const firstRun = (s: FlowState): SignRun => s.runs[0];

const allDecisions = (s: FlowState): Decision[] => s.runs.flatMap((r) => r.decisions);

function findRejection(s: FlowState, code: ReasonCode): Decision | undefined {
  return allDecisions(s).find((d) => d.result === 'REJECTED' && d.reasonCode === code);
}

const isTrue = (
  name: string,
  check: (s: FlowState) => boolean,
  expected = '是',
  actual = '否',
): ScenarioAssertion => ({
  name,
  check: (s) => ({ pass: check(s), expected, actual: check(s) ? expected : actual }),
});

const slot = (r: SignRun, i: number) => r.slots[i];
const title = (id: keyof typeof ROLES) => ROLES[id].title;

/** 已接受的签名决定必须首尾相接：每个 prevHash 都能指回上一枚链上签名或 START */
function chainIntact(r: SignRun): boolean {
  const signed = r.decisions.filter((d) => d.action === 'SIGN' && d.result === 'ACCEPTED');
  return signed.every((d, i) => {
    const prev = r.decisions.find((x) => x.hash === d.prevHash);
    if (!prev) return false;
    if (i === 0) return prev.action === 'START' && prev.result === 'ACCEPTED';
    return prev === signed[i - 1];
  });
}

/* --------------------------------- 场景 --------------------------------- */

const scenarioOrder: Scenario = {
  id: 'order',
  name: '场景 1 · 顺序签署',
  goal: '员工 → 主管 → 外部合作方严格按序完成，签名依次绑定文件指纹与前序哈希；流程结束后的重放回执被拒绝。',
  expect: '三轮签名全部有效并入链，整份文件完成；结束后重放的签署回执判定“流程已终止”。',
  steps: [
    { label: '外部合作方完成身份确认', actions: [{ type: 'TOGGLE_IDENTITY', roleId: 'partner' }] },
    { label: '发起第 1 轮签署', actions: [{ type: 'START_RUN' }] },
    { label: `${title('employee')}打开文件查看`, actions: [{ type: 'ENQUEUE_DECISION', roleId: 'employee', kind: 'VIEW' }], ticks: 1 },
    { label: `${title('employee')}签署`, actions: [{ type: 'ENQUEUE_DECISION', roleId: 'employee', kind: 'SIGN' }], ticks: 1 },
    { label: `${title('manager')}查看`, actions: [{ type: 'ENQUEUE_DECISION', roleId: 'manager', kind: 'VIEW' }], ticks: 1 },
    { label: `${title('manager')}签署，链接发给外部合作方`, actions: [{ type: 'ENQUEUE_DECISION', roleId: 'manager', kind: 'SIGN' }], ticks: 1 },
    { label: `${title('partner')}查看`, actions: [{ type: 'ENQUEUE_DECISION', roleId: 'partner', kind: 'VIEW' }], ticks: 1 },
    { label: `${title('partner')}签署，文件封存`, actions: [{ type: 'ENQUEUE_DECISION', roleId: 'partner', kind: 'SIGN' }], ticks: 1 },
    { label: '网络层重放员工的旧签署回执（晚到）', actions: [{ type: 'INJECT_RECEIPT', roleId: 'employee', kind: 'SIGN', delayTicks: 1 }], ticks: 1 },
  ],
  assertions: [
    isTrue('流程状态为 completed', (s) => lastRun(s).status === 'completed', 'completed', '非 completed'),
    isTrue('三个槽位均为 signed', (s) => lastRun(s).slots.every((x) => x.status === 'signed')),
    isTrue('三枚签名绑定同一文件指纹', (s) => {
      const r = lastRun(s);
      return r.slots.every((x) => x.signedFingerprint === r.fingerprint);
    }),
    isTrue('签名哈希链首尾相接（START→员工→主管→合作方）', (s) => chainIntact(lastRun(s)), '链完整', '断链'),
    isTrue('结束后的重放回执被拒收（RUN_INACTIVE）', (s) => !!findRejection(s, 'RUN_INACTIVE')),
  ],
};

const scenarioAmend: Scenario = {
  id: 'amend',
  name: '场景 2 · 补页换版',
  goal: '员工、主管签完后文件补页：旧签名即时失效、在途链接作废、迟到回执按指纹拒收；基于新版本重新发起并完成整轮重签。',
  expect: 'v1 签名全部 invalidated；合作方迟到回执判定指纹不匹配；v2 重签完成且全部绑定新指纹。',
  steps: [
    { label: '外部合作方完成身份确认', actions: [{ type: 'TOGGLE_IDENTITY', roleId: 'partner' }] },
    { label: '发起第 1 轮（v1）', actions: [{ type: 'START_RUN' }] },
    { label: '员工查看', actions: [{ type: 'ENQUEUE_DECISION', roleId: 'employee', kind: 'VIEW' }], ticks: 1 },
    { label: '员工签署完成', actions: [{ type: 'ENQUEUE_DECISION', roleId: 'employee', kind: 'SIGN' }], ticks: 1 },
    { label: '主管查看', actions: [{ type: 'ENQUEUE_DECISION', roleId: 'manager', kind: 'VIEW' }], ticks: 1 },
    { label: '主管签署完成，链接发给合作方', actions: [{ type: 'ENQUEUE_DECISION', roleId: 'manager', kind: 'SIGN' }], ticks: 1 },
    {
      label: '合作方网络较慢，签署回执延迟 40 分钟',
      actions: [
        { type: 'SET_FAULT', patch: { delayNext: 3 } },
        { type: 'ENQUEUE_DECISION', roleId: 'partner', kind: 'SIGN' },
      ],
    },
    { label: '等待回执期间文件补页：新增「数据处理附录」', actions: [{ type: 'AMEND', pageLabel: '第5页 · 数据处理附录' }] },
    { label: '时钟推进，合作方迟到回执到达', ticks: 4 },
    { label: '基于 v2 重新发起整轮签署', actions: [{ type: 'START_RUN' }] },
    { label: '员工重签', actions: [{ type: 'ENQUEUE_DECISION', roleId: 'employee', kind: 'SIGN' }], ticks: 1 },
    { label: '主管重签', actions: [{ type: 'ENQUEUE_DECISION', roleId: 'manager', kind: 'SIGN' }], ticks: 1 },
    { label: '合作方重签，v2 封存', actions: [{ type: 'ENQUEUE_DECISION', roleId: 'partner', kind: 'SIGN' }], ticks: 1 },
  ],
  assertions: [
    isTrue('文件存在 2 个版本', (s) => s.versions.length === 2, '2', String(createInitialState().versions.length)),
    isTrue('旧轮次状态 superseded', (s) => firstRun(s).endState === 'superseded', 'superseded', '非 superseded'),
    isTrue(
      '员工、主管的 v1 签名即时失效（invalidated）',
      (s) => [slot(firstRun(s), 0).status, slot(firstRun(s), 1).status].every((x) => x === 'invalidated'),
    ),
    isTrue('合作方未签署的 v1 链接作废（recalled）', (s) => slot(firstRun(s), 2).status === 'recalled'),
    isTrue('迟到回执按文件指纹拒收（STALE_FINGERPRINT）', (s) => !!findRejection(s, 'STALE_FINGERPRINT')),
    isTrue(
      '旧指纹 ≠ 当前指纹',
      (s) => firstRun(s).fingerprint !== s.currentFingerprint,
      '不同',
      '相同',
    ),
    isTrue('新轮次 completed 且全部绑定 v2 指纹', (s) => {
      const r = lastRun(s);
      return r.status === 'completed' && r.slots.every((x) => x.signedFingerprint === s.currentFingerprint);
    }),
    isTrue('两轮签名哈希链各自完整', (s) => s.runs.every(chainIntact), '链完整', '断链'),
  ],
};

const scenarioRecall: Scenario = {
  id: 'recall',
  name: '场景 3 · 发起方撤回',
  goal: '员工签完、主管待签时发起人撤回：在途链接作废、已完成签名留痕；主管晚到的回执不入链；之后可重新发起。',
  expect: '轮次 failed/recalled；员工签名保留 signed；主管槽位 recalled；重放回执 RUN_INACTIVE；可发起新一轮。',
  steps: [
    { label: '发起第 1 轮', actions: [{ type: 'START_RUN' }] },
    { label: '员工查看', actions: [{ type: 'ENQUEUE_DECISION', roleId: 'employee', kind: 'VIEW' }], ticks: 1 },
    { label: '员工签署完成，主管收到链接', actions: [{ type: 'ENQUEUE_DECISION', roleId: 'employee', kind: 'SIGN' }], ticks: 1 },
    { label: '发起人撤回本轮签署', actions: [{ type: 'RECALL' }] },
    { label: '主管客户端延迟提交的签署回执到达', actions: [{ type: 'INJECT_RECEIPT', roleId: 'manager', kind: 'SIGN', delayTicks: 1 }], ticks: 1 },
    { label: '发起人重新发起', actions: [{ type: 'START_RUN' }] },
  ],
  assertions: [
    isTrue('旧轮次 failed / recalled', (s) => firstRun(s).status === 'failed' && firstRun(s).endState === 'recalled'),
    isTrue('员工已完成签名保留留痕（signed）', (s) => slot(firstRun(s), 0).status === 'signed'),
    isTrue('主管在途链接作废（recalled）', (s) => slot(firstRun(s), 1).status === 'recalled'),
    isTrue('晚到回执被拒收（RUN_INACTIVE）', (s) => !!findRejection(s, 'RUN_INACTIVE')),
    isTrue('重新发起后存在第 2 轮且进行中', (s) => s.runs.length === 2 && !!s.activeRunId),
  ],
};

const scenarioExpiry: Scenario = {
  id: 'expiry',
  name: '场景 4 · 链接过期',
  goal: '主管收到链接后 90 分钟内未操作：链接自动过期、轮次终止；过期后到达的签署回执不能“复活”流程。',
  expect: '主管槽位 expired，轮次 failed/expired；台账有系统 EXPIRE 记录；过期回执被拒收（EXPIRED）。',
  steps: [
    { label: '发起第 1 轮', actions: [{ type: 'START_RUN' }] },
    { label: '员工查看', actions: [{ type: 'ENQUEUE_DECISION', roleId: 'employee', kind: 'VIEW' }], ticks: 1 },
    { label: '员工签署完成，主管收到链接（90 分钟有效期）', actions: [{ type: 'ENQUEUE_DECISION', roleId: 'employee', kind: 'SIGN' }], ticks: 1 },
    { label: '主管连续 100 分钟未处理，链接过期', ticks: 10 },
    { label: '主管终于提交签署回执（晚到）', actions: [{ type: 'INJECT_RECEIPT', roleId: 'manager', kind: 'SIGN', delayTicks: 1 }], ticks: 1 },
  ],
  assertions: [
    isTrue('轮次 failed / expired', (s) => lastRun(s).status === 'failed' && lastRun(s).endState === 'expired'),
    isTrue('主管槽位 expired', (s) => slot(lastRun(s), 1).status === 'expired'),
    isTrue('台账存在系统 EXPIRE 决定', (s) => allDecisions(s).some((d) => d.action === 'EXPIRE')),
    isTrue('过期后的签署回执被拒收（EXPIRED）', (s) => !!findRejection(s, 'EXPIRED')),
    isTrue('员工签名仍然有效绑定原指纹', (s) => slot(lastRun(s), 0).status === 'signed'),
  ],
};

const scenarioDuplicate: Scenario = {
  id: 'duplicate',
  name: '场景 5 · 重复 / 晚到 / 越序 / 篡改',
  goal: '一次性覆盖四类异常回执：越序签署、重复重传、前序哈希被篡改、回执晚到但仍在有效期内。',
  expect: '越序→PREV_NOT_SIGNED；重复→ALREADY_SIGNED；篡改→HASH_MISMATCH；晚到 30 分钟但链未变→正常入链，流程完成。',
  steps: [
    { label: '外部合作方完成身份确认', actions: [{ type: 'TOGGLE_IDENTITY', roleId: 'partner' }] },
    { label: '发起第 1 轮', actions: [{ type: 'START_RUN' }] },
    { label: '主管的客户端越序直接提交签署', actions: [{ type: 'INJECT_RECEIPT', roleId: 'manager', kind: 'SIGN', delayTicks: 1 }] },
    { label: '注入故障：员工下一回执重复重传', actions: [{ type: 'SET_FAULT', patch: { duplicateNext: true } }] },
    { label: '员工签署（含一份重复回执）', actions: [{ type: 'ENQUEUE_DECISION', roleId: 'employee', kind: 'SIGN' }], ticks: 1 },
    { label: '注入故障：主管回执的前序哈希被中间人篡改', actions: [{ type: 'SET_FAULT', patch: { garbleHeadNext: true } }] },
    { label: '主管签署（被篡改）', actions: [{ type: 'ENQUEUE_DECISION', roleId: 'manager', kind: 'SIGN' }], ticks: 1 },
    { label: '主管重新正常签署', actions: [{ type: 'ENQUEUE_DECISION', roleId: 'manager', kind: 'SIGN' }], ticks: 1 },
    { label: '注入故障：合作方回执网络延迟 30 分钟', actions: [{ type: 'SET_FAULT', patch: { delayNext: 2 } }] },
    { label: '合作方签署（回执晚到，链上无新决定）', actions: [{ type: 'ENQUEUE_DECISION', roleId: 'partner', kind: 'SIGN' }], ticks: 3 },
  ],
  assertions: [
    isTrue('越序签署被拒收（PREV_NOT_SIGNED）', (s) => !!findRejection(s, 'PREV_NOT_SIGNED')),
    isTrue('重复回执被拒收（ALREADY_SIGNED）', (s) => !!findRejection(s, 'ALREADY_SIGNED')),
    isTrue('篡改回执被拒收（HASH_MISMATCH）', (s) => !!findRejection(s, 'HASH_MISMATCH')),
    isTrue('晚到但链未变的回执正常生效，流程 completed', (s) => lastRun(s).status === 'completed'),
    isTrue(
      '恰好 3 枚有效签名，无重复入账',
      (s) => allDecisions(s).filter((d) => d.action === 'SIGN' && d.result === 'ACCEPTED').length === 3,
      '3',
      '≠3',
    ),
    isTrue('签名哈希链完整', (s) => chainIntact(lastRun(s)), '链完整', '断链'),
    isTrue(
      '合作方签署比主管晚 30 分钟（仍在 90 分钟有效期内）',
      (s) => {
        const r = lastRun(s);
        const m = r.slots[1].signedAt ?? 0;
        const p = r.slots[2].signedAt ?? 0;
        return p - m === 3 * TICK_MINUTES;
      },
      '相差 30 分钟',
      '时间差不符',
    ),
  ],
};

export const SCENARIOS: Scenario[] = [
  scenarioOrder,
  scenarioAmend,
  scenarioRecall,
  scenarioExpiry,
  scenarioDuplicate,
];
