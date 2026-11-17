// Precisa ser definido ANTES de o editor de desenho ser carregado: as URLs das fontes são calculadas na importação.
// Fontes locais (copiadas por scripts/copy-assets.mjs) → funciona offline; o CSP bloqueia qualquer CDN.
(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = new URL('./', window.location.href).href;
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { UiProvider } from './lib/ui';
import { StickyWindow } from './components/StickyWindow';
import { CaptureOverlay } from './components/CaptureOverlay';
import { ErrorBoundary, installGlobalErrorLogging } from './components/ErrorBoundary';
import './styles/app.css';

installGlobalErrorLogging();

// a mesma página atende a janela principal, as notas flutuantes (#sticky/ID) e a seleção de captura (#capture)
const hash = location.hash.slice(1);
const sticky = /^sticky\/(\d+)$/.exec(hash);
const root = createRoot(document.getElementById('root')!);
if (sticky) root.render(<ErrorBoundary label="nota flutuante"><StickyWindow id={Number(sticky[1])} /></ErrorBoundary>);
else if (hash === 'capture') root.render(<CaptureOverlay />);
else root.render(<ErrorBoundary label="aplicativo"><UiProvider><App /></UiProvider></ErrorBoundary>);
