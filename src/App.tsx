import { useFlowStore } from './lib/useFlowStore';
import { TopBar } from './components/TopBar';
import { DocumentPanel, FaultPanel, RolesPanel } from './components/LeftPanels';
import { FlowChain, FlowControls, QueuePanel } from './components/FlowChain';
import { LedgerPanel } from './components/LedgerPanel';
import { ScenariosPanel } from './components/ScenariosPanel';

export default function App() {
  const store = useFlowStore();

  return (
    <div className="app">
      <TopBar store={store} />
      <div className="grid">
        {/* 左栏：文件、角色身份、故障注入 */}
        <div className="col">
          <DocumentPanel store={store} />
          <RolesPanel store={store} />
          <FaultPanel store={store} />
        </div>

        {/* 中栏：流程发起与签署哈希链、传输队列 */}
        <div className="col center">
          <FlowControls store={store} />
          <FlowChain store={store} />
          <QueuePanel store={store} />
        </div>

        {/* 右栏：验收场景、审计台账 */}
        <div className="col">
          <ScenariosPanel store={store} />
          <LedgerPanel store={store} />
        </div>
      </div>

      <footer
        className="hint-text"
        style={{ textAlign: 'center', marginTop: 18, paddingBottom: 8 }}
      >
        每个决定都绑定「当时文件指纹 + 前序状态哈希」 · 刷新页面自动恢复现场 ·{' '}
        <span className="kbd">空格</span> 单步 · <span className="kbd">Ctrl/⌘+Z</span> 撤销 ·{' '}
        <span className="kbd">Ctrl/⌘+Shift+Z</span> 重做
      </footer>
    </div>
  );
}
