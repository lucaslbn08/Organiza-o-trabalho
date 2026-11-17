import { createRoot } from 'react-dom/client';
import { App } from './App';
import { UiProvider } from './lib/ui';
import { StickyWindow } from './components/StickyWindow';
import { CaptureOverlay } from './components/CaptureOverlay';
import './styles/app.css';

// a mesma página atende a janela principal, as notas flutuantes (#sticky/ID) e a seleção de captura (#capture)
const hash = location.hash.slice(1);
const sticky = /^sticky\/(\d+)$/.exec(hash);
const root = createRoot(document.getElementById('root')!);
if (sticky) root.render(<StickyWindow id={Number(sticky[1])} />);
else if (hash === 'capture') root.render(<CaptureOverlay />);
else root.render(<UiProvider><App /></UiProvider>);
