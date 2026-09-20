import { createRoot } from 'react-dom/client';
import App from '../src/App';

export function mount() {
  const el = document.getElementById('root');
  if (!el) throw new Error('#root missing');
  const root = createRoot(el);
  root.render(<App />);
  return () => root.unmount();
}
