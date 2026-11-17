import crypto from 'node:crypto';
import type { NoteService, MediaService } from './notes';
import type { CanvasService } from './canvases';
import { parseScene } from './canvases';

/** Acrescenta uma imagem (captura) ao final de uma anotação, preservando o conteúdo existente. */
export function appendImageToNote(notes: NoteService, media: MediaService, noteId: number, png: Uint8Array, alt = 'Captura de tela'): void {
  const src = media.save(png, 'image/png');
  const n = notes.get(noteId);
  const doc = JSON.parse(n.content_json) as { type: 'doc'; content?: object[] };
  doc.content = [...(doc.content ?? []), { type: 'image', attrs: { src, alt } }, { type: 'paragraph' }];
  notes.update(noteId, { content_json: JSON.stringify(doc) });
}

/**
 * Insere a imagem como elemento editável num desenho/quadro, à direita do conteúdo existente.
 * Campos ausentes são completados pelo editor ao abrir (restore), como em qualquer cena importada.
 */
export function insertImageIntoCanvas(canvases: CanvasService, media: MediaService, canvasId: number, png: Uint8Array, width: number, height: number): void {
  const src = media.save(png, 'image/png');
  const hash = src.slice('ws-media://'.length);
  const c = canvases.get(canvasId);
  parseScene(c.scene_json);
  const scene = JSON.parse(c.scene_json) as { files?: Record<string, { hash: string; mimeType: string }>; elements: { x?: number; width?: number; y?: number; isDeleted?: boolean }[] };
  const live = scene.elements.filter((e) => !e.isDeleted);
  const maxX = live.reduce((m, e) => Math.max(m, (e.x ?? 0) + (e.width ?? 0)), 0);
  const minY = live.reduce((m, e) => Math.min(m, e.y ?? 0), live.length ? Infinity : 0);
  const scale = Math.min(1, 800 / Math.max(width, 1));
  const fileId = hash.slice(0, 40);
  scene.files = { ...(scene.files ?? {}), [fileId]: { hash, mimeType: 'image/png' } };
  scene.elements.push({
    id: crypto.randomUUID(), type: 'image', x: live.length ? maxX + 60 : 0, y: live.length ? minY : 0, width: Math.round(width * scale), height: Math.round(height * scale),
    angle: 0, strokeColor: 'transparent', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', roughness: 0, opacity: 100,
    groupIds: [], frameId: null, roundness: null, seed: Math.floor(Math.random() * 2 ** 31), version: 1, versionNonce: Math.floor(Math.random() * 2 ** 31),
    isDeleted: false, boundElements: null, updated: Date.now(), link: null, locked: false, status: 'saved', fileId, scale: [1, 1], crop: null,
  } as never);
  canvases.update(canvasId, { scene_json: JSON.stringify(scene) });
}

/** Lê largura/altura do cabeçalho IHDR de um PNG. */
export function pngSize(png: Uint8Array): { width: number; height: number } {
  if (png.length < 24 || png[0] !== 0x89 || png[1] !== 0x50) throw new Error('Imagem PNG inválida.');
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}
