import type { FlowStore } from '../lib/useFlowStore';
import { formatClock } from '../lib/engine';

export function TopBar({ store }: { store: FlowStore }) {
  const { state, act, undo, redo, canUndo, canRedo, reset, playing, setPlaying } = store;

  const onReset = () => {
    if (window.confirm('确定清空全部轮次、台账与本地存档，恢复初始文件吗？')) reset();
  };

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">签</div>
        <div>
          <h1>SignFlow 签署流程验收台</h1>
          <p>文件指纹 · 顺序哈希链 · 晚到 / 重复 / 换版回执的可解释判定</p>
        </div>
      </div>
      <div className="top-controls">
        <div className="clock-box">
          <span className="clock-label">虚拟时钟</span>
          <span className="clock-value">{formatClock(state.clock)}</span>
        </div>
        <button onClick={() => act({ type: 'TICK' })} title="推进 10 分钟（空格键）">
          ⏭ 单步 +10分
        </button>
        <button
          className={playing ? 'danger' : 'primary'}
          onClick={() => setPlaying(!playing)}
          disabled={!playing && !state.activeRunId && state.queue.length === 0}
          title="每 1.2 秒自动推进一个虚拟步"
        >
          {playing ? '⏸ 暂停' : '▶ 自动播放'}
        </button>
        <button onClick={undo} disabled={!canUndo} title="撤销（Ctrl/Cmd+Z）">
          ↶ 撤销
        </button>
        <button onClick={redo} disabled={!canRedo} title="重做（Ctrl/Cmd+Shift+Z）">
          ↷ 重做
        </button>
        <button className="danger" onClick={onReset}>
          ⟲ 重置
        </button>
      </div>
    </header>
  );
}
