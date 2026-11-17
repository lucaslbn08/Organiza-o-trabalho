// Copia as fontes do Excalidraw para a pasta pública: o app funciona 100% offline (sem CDN).
import fs from 'node:fs';
const src = 'node_modules/@excalidraw/excalidraw/dist/prod/fonts';
const dst = 'src/renderer/public/fonts';
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
console.log('Fontes do editor copiadas para', dst);
