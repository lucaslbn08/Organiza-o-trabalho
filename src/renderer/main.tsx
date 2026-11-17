import { createRoot } from 'react-dom/client';
import { App } from './App';
import { UiProvider } from './lib/ui';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(<UiProvider><App /></UiProvider>);
