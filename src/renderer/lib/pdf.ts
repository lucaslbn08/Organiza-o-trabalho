// pdf.js carregado sob demanda; o worker é servido localmente (sem rede).
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export async function loadPdf(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  // o pdf.js apenas desenha o documento: scripts embutidos em PDFs não são executados
  return pdfjs.getDocument({ data: bytes.slice(), enableXfa: false }).promise;
}

/** Renderiza uma página em PNG (usado para referências de PDF no quadro). */
export async function pdfPageToPng(bytes: Uint8Array, pageNo = 1, maxWidth = 900): Promise<{ png: Uint8Array; width: number; height: number; pages: number }> {
  const doc = await loadPdf(bytes);
  const page = await doc.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(2, maxWidth / base.width) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'));
  const out = { png: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height, pages: doc.numPages };
  await doc.loadingTask.destroy();
  return out;
}
