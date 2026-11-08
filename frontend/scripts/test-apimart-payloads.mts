/**
 * Prueba SIN RED de los cuerpos que se envían a Apimart para los clips del Director y Guion a video,
 * y de los costos estimados. No llama a ninguna API ni gasta nada.
 *
 *   cd frontend
 *   node --import ./scripts/ts-alias-loader.mjs scripts/test-apimart-payloads.mts
 */
import assert from 'node:assert/strict';
import { buildApimartVideoBody, ClipRequestError } from '@/lib/ai/apimart-video';
import {
  BROLL_MODELS,
  DEFAULT_BROLL_MODEL,
  DEFAULT_NATIVE_BROLL_MODEL,
  billedClipSeconds,
  clipChoiceProblem,
  clipCostUSD,
  getBrollModel,
  pickBrollDuration,
} from '@/config/broll-models';
import { sceneClipChoice } from '@/lib/director-mode/durations';
import { estimatePlan } from '@/lib/director/estimate';

const IMG = 'https://res.cloudinary.com/demo/image/upload/frame.jpg';
const REF = (n: number) => `https://res.cloudinary.com/demo/image/upload/ref-${n}.jpg`;
let ok = 0;
const test = (name: string, fn: () => void) => {
  fn();
  ok++;
  console.log(`✓ ${name}`);
};
const throws = (fn: () => unknown, re: RegExp) => assert.throws(fn, (e: unknown) => e instanceof ClipRequestError && re.test(e.message));

// ── Grok Imagine 1.5 ──────────────────────────────────────────────────────────
test('Grok: size, duración entera, resolución e image_urls (fotograma primero, máx. 7)', () => {
  const b = buildApimartVideoBody({
    model: 'grok-imagine-1.5-video-ext',
    prompt: 'A woman opens a box',
    durationSec: 4.3,
    aspectRatio: '9:16',
    firstFrameUrl: IMG,
    referenceImageUrls: [1, 2, 3, 4, 5, 6, 7, 8].map(REF),
  });
  assert.deepEqual(Object.keys(b).sort(), ['duration', 'image_urls', 'model', 'prompt', 'resolution', 'size']);
  assert.equal(b.size, '9:16');
  assert.equal(b.duration, 6, 'Grok mínimo 6 s');
  assert.equal(typeof b.duration, 'number');
  assert.ok(Number.isInteger(b.duration));
  assert.equal(b.resolution, '720p', '720p por defecto');
  const imgs = b.image_urls as string[];
  assert.equal(imgs.length, 7);
  assert.equal(imgs[0], IMG);
  assert.ok(!('aspect_ratio' in b));
});
test('Grok: 480p, 15 s máximo, sin imágenes = texto a video', () => {
  const b = buildApimartVideoBody({ model: 'grok-imagine-1.5-video-ext', prompt: 'x', durationSec: 20, aspectRatio: '16:9', resolution: '480P' });
  assert.equal(b.duration, 15);
  assert.equal(b.resolution, '480p');
  assert.ok(!('image_urls' in b));
});
test('Grok: rechaza base64, 1080p y video de referencia', () => {
  throws(() => buildApimartVideoBody({ model: 'grok-imagine-1.5-video-ext', prompt: 'x', durationSec: 6, aspectRatio: '9:16', firstFrameUrl: 'data:image/png;base64,AAAA' }), /URLs públicas/);
  throws(() => buildApimartVideoBody({ model: 'grok-imagine-1.5-video-ext', prompt: 'x', durationSec: 6, aspectRatio: '9:16', resolution: '1080p' }), /no admite 1080p/);
  throws(() => buildApimartVideoBody({ model: 'grok-imagine-1.5-video-ext', prompt: 'x', durationSec: 6, aspectRatio: '9:16', videoUrl: 'https://x/v.mp4' }), /video de referencia/);
});

// ── Gemini Omni 1.1 Flash Ext ─────────────────────────────────────────────────
test('Omni 1.1 Ext: fotograma inicial → generation_type frame con 1 imagen, duración 4/6/8/10', () => {
  const b = buildApimartVideoBody({
    model: 'gemini-omni-1.1-flash-ext',
    prompt: 'She says hello',
    durationSec: 5,
    aspectRatio: '9:16',
    firstFrameUrl: IMG,
    referenceImageUrls: [REF(1), REF(2)],
  });
  assert.equal(b.generation_type, 'frame');
  assert.deepEqual(b.image_urls, [IMG]);
  assert.equal(b.duration, 6);
  assert.equal(b.aspect_ratio, '9:16');
  assert.equal(b.resolution, '720p');
  assert.ok(!('size' in b));
  assert.ok(!('video_urls' in b));
});
test('Omni 1.1 Ext: referencias 1 o 3 (2 → 1), video sin duration', () => {
  const two = buildApimartVideoBody({ model: 'gemini-omni-1.1-flash-ext', prompt: 'x', durationSec: 9, aspectRatio: '16:9', referenceImageUrls: [REF(1), REF(2)] });
  assert.equal(two.generation_type, 'reference');
  assert.deepEqual(two.image_urls, [REF(1)]);
  assert.equal(two.duration, 10);
  const four = buildApimartVideoBody({ model: 'gemini-omni-1.1-flash-ext', prompt: 'x', durationSec: 4, aspectRatio: '16:9', referenceImageUrls: [1, 2, 3, 4].map(REF) });
  assert.equal((four.image_urls as string[]).length, 3);
  const vid = buildApimartVideoBody({ model: 'gemini-omni-1.1-flash-ext', prompt: 'x', durationSec: 4, aspectRatio: '9:16', videoUrl: 'https://x/v.mp4' });
  assert.deepEqual(vid.video_urls, ['https://x/v.mp4']);
  assert.ok(!('duration' in vid), 'duration y video_urls no pueden ir juntos');
});
test('Omni 1.1 Ext: 1:1 no admitido', () => {
  throws(() => buildApimartVideoBody({ model: 'gemini-omni-1.1-flash-ext', prompt: 'x', durationSec: 6, aspectRatio: '1:1' }), /formato 1:1/);
});

// ── Gemini Omni Flash (preview) ───────────────────────────────────────────────
test('Omni preview: aspect_ratio, 720p, hasta 16 imágenes y SIN duration', () => {
  const b = buildApimartVideoBody({
    model: 'gemini-omni-flash-preview',
    prompt: 'x',
    durationSec: 7,
    aspectRatio: '9:16',
    firstFrameUrl: IMG,
    referenceImageUrls: Array.from({ length: 20 }, (_, i) => REF(i)),
  });
  assert.equal(b.aspect_ratio, '9:16');
  assert.equal(b.resolution, '720p');
  assert.equal((b.image_urls as string[]).length, 16);
  assert.ok(!('duration' in b));
});
test('Omni preview: video_urls y extend_from_task_id son excluyentes', () => {
  const ext = buildApimartVideoBody({ model: 'gemini-omni-flash-preview', prompt: 'x', durationSec: 5, aspectRatio: '16:9', extendFromTaskId: 'task_1' });
  assert.equal(ext.extend_from_task_id, 'task_1');
  throws(
    () => buildApimartVideoBody({ model: 'gemini-omni-flash-preview', prompt: 'x', durationSec: 5, aspectRatio: '16:9', extendFromTaskId: 'task_1', videoUrl: 'https://x/v.mp4' }),
    /no pueden ir juntos/
  );
});
test('Modelos que no son de Apimart (Seedance, Veo…) no pasan por este armado', () => {
  throws(() => buildApimartVideoBody({ model: 'seedance-2.0', prompt: 'x', durationSec: 5, aspectRatio: '9:16' }), /no es un modelo/);
  throws(() => buildApimartVideoBody({ model: 'google/veo-3.1-lite', prompt: 'x', durationSec: 5, aspectRatio: '9:16' }), /no es un modelo/);
});

// ── Catálogo, costos y validaciones ───────────────────────────────────────────
test('Predeterminados: Grok 720p (sin voz) y Omni 1.1 Ext (los personajes hablan)', () => {
  assert.equal(DEFAULT_BROLL_MODEL, 'grok-imagine-1.5-video-ext');
  assert.equal(getBrollModel(DEFAULT_BROLL_MODEL).resolution, '720p');
  assert.equal(DEFAULT_NATIVE_BROLL_MODEL, 'gemini-omni-1.1-flash-ext');
  assert.ok(getBrollModel(DEFAULT_NATIVE_BROLL_MODEL).audio);
  assert.equal(new Set(BROLL_MODELS.map((m) => m.id)).size, BROLL_MODELS.length);
});
test('Costos: Grok 6 s 480p = $0.0765 · 720p = $0.1434 · Omni Ext 720p 6 s = $0.375 · preview peor caso 10 s = $1.10', () => {
  const grok = getBrollModel('grok-imagine-1.5-video-ext');
  assert.equal(clipCostUSD(grok, 6, { resolution: '480p' }).toFixed(4), '0.0765');
  assert.equal(clipCostUSD(grok, 4, { resolution: '720p' }).toFixed(4), '0.1434', '4 s se cobra como 6');
  const omni = getBrollModel('gemini-omni-1.1-flash-ext');
  assert.equal(clipCostUSD(omni, 5), 0.375);
  assert.equal(clipCostUSD(omni, 10, { resolution: '4k' }), 1.125);
  const prev = getBrollModel('gemini-omni-flash-preview');
  assert.equal(clipCostUSD(prev, 3, { withAudio: true }).toFixed(2), '1.10');
  assert.equal(billedClipSeconds(prev, 3), 10);
  assert.equal(pickBrollDuration(omni, 7), 8);
});
test('Validaciones: formato, resolución, audio y duración máxima', () => {
  assert.match(clipChoiceProblem(getBrollModel('gemini-omni-1.1-flash-ext'), { formato: '1:1' })!, /no admite el formato 1:1/);
  assert.match(clipChoiceProblem(getBrollModel('grok-imagine-1.5-video-ext'), { formato: '9:16', resolucion: '1080p' })!, /no admite 1080p/);
  assert.match(clipChoiceProblem(getBrollModel('grok-imagine-1.5-video-ext'), { formato: '9:16', conAudio: true })!, /no genera voz/);
  assert.match(clipChoiceProblem(getBrollModel('gemini-omni-1.1-flash-ext'), { formato: '9:16', duracionSeg: 12 })!, /hasta 10 s/);
  assert.equal(clipChoiceProblem(getBrollModel('grok-imagine-1.5-video-ext'), { formato: '1:1', resolucion: '480p' }), null);
});
test('Elección por escena: el modelo y la calidad de la escena mandan sobre los ajustes', () => {
  const ajustes = { modeloBroll: 'grok-imagine-1.5-video-ext', resolucionBroll: '480p', imagenInicial: true };
  const general = sceneClipChoice({}, ajustes);
  assert.equal(general.model.id, 'grok-imagine-1.5-video-ext');
  assert.equal(general.resolucion, '480p');
  const propia = sceneClipChoice({ clipOpciones: { modelo: 'gemini-omni-1.1-flash-ext', imagenInicial: false } }, ajustes);
  assert.equal(propia.model.id, 'gemini-omni-1.1-flash-ext');
  assert.equal(propia.resolucion, '720p', 'la resolución de los ajustes es de otro modelo');
  assert.equal(propia.imagenInicial, false);
});
test('Presupuesto del Director: imagen GPT Image 2 1K + clip Grok 6 s 480p ≈ $0.087', () => {
  const e = estimatePlan([
    { tipo: 'imagen', modelo: 'gpt-image-2', resolucion: '1K', cantidad: 1 },
    { tipo: 'toma_de_apoyo', modelo: 'grok-imagine-1.5-video-ext', duracionSeg: 6, resolucion: '480p' },
  ]);
  assert.equal(e.escenas[0].costoUSD, 0.0106);
  assert.equal(e.escenas[1].costoUSD, 0.0765);
  assert.equal(e.totalUSD.toFixed(4), '0.0871');
  const prev = estimatePlan([{ tipo: 'toma_de_apoyo', modelo: 'gemini-omni-flash-preview', duracionSeg: 4, conAudio: true }]);
  assert.ok(prev.suposiciones.some((s) => /peor caso/.test(s)));
});

console.log(`\n${ok} pruebas correctas. No se llamó a ninguna API.`);
