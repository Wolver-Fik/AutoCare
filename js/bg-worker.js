/* AutoCare · Web Worker de recorte IA (Transformers.js / WASM) --------------
   Todo el módulo ESM, los pesos ONNX y la inferencia viven aquí. El hilo
   principal envía la imagen y recibe los bytes RGBA crudos del recorte; allí
   se construye el <canvas> y se codifica el PNG. WebKit móvil no codifica de
   forma fiable dentro del Worker, así que nunca se usa toBlob() ni
   convertToBlob(). La interfaz no se bloquea durante la inferencia.
   PC y móvil usan el mismo pipeline: SegFormer-B0 q8 (~4 MB), entrenado con
   ADE20K. Se filtran las etiquetas de vehículo y su máscara combinada se
   aplica sobre la foto original (≤ 1024 px en PC, ≤ 512 px en móvil: app.js
   reescribe la foto antes de enviarla). */
'use strict';

const BG_MODULE_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6';
/* Un único modelo para escritorio y móvil: SegFormer-B0 q8 (~4 MB), entrenado
   con ADE20K, que incluye vehículos. Sus pesos pequeños evitan los abortos de
   Safari/WebKit con ONNX grandes sin caché persistente (HTTP local). */
const BG_MODEL_ID = 'Xenova/segformer-b0-finetuned-ade-512-512';
const BG_TASK = 'image-segmentation';
const BG_OPTIONS = { dtype: 'q8' };
/* Etiquetas ADE20K que corresponden a un vehículo (el resto se descarta). */
const VEHICLE_LABELS = ['car', 'van', 'truck', 'bus', 'minibike', 'bicycle'];
/* maxEdge lo aplica app.js antes de enviar la foto: 1024 en PC, 512 en móvil.
   El Worker no re-codifica la imagen. */

let modulePromise = null;
let BG_MODULE = null;
let pipePromise = null;

const post = (msg, transfer) => self.postMessage(msg, transfer || []);
const progress = (id, pct) => post({ type: 'progress', id, pct: Math.max(0, Math.min(100, pct)) });

/* Sirviendo desde una IP de red local por HTTP (contexto no seguro), WebKit y
   Chrome pueden lanzar SecurityError al abrir CacheStorage. En ese caso se
   desactiva la caché del navegador y los modelos locales dentro del Worker. */
function insecureLocalHTTP() {
  try {
    return location.protocol === 'http:' &&
      (!self.isSecureContext || !/^(?:localhost|127\.0\.0\.1|\[::1\])$/i.test(location.hostname));
  } catch (e) { return false; }
}
function configureRuntime(mod) {
  const env = mod && (mod.env || mod.default && mod.default.env);
  if (!env) return;
  if (insecureLocalHTTP() || typeof caches === 'undefined' || typeof caches.open !== 'function') {
    env.allowLocalModels = false;
    env.useBrowserCache = false;
    console.info('[AutoCare worker] browser/local model cache disabled (insecure HTTP)');
  }
}
function loadModule() {
  if (!modulePromise) {
    modulePromise = import(/* @vite-ignore */ BG_MODULE_URL).then(mod => {
      configureRuntime(mod);
      BG_MODULE = mod.default && !mod.pipeline ? mod.default : mod;
      return BG_MODULE;
    }, err => { modulePromise = null; throw err; });
  }
  return modulePromise;
}

async function getSegmenter(id, onProgress) {
  if (pipePromise) return pipePromise;
  pipePromise = (async () => {
    const mod = await loadModule();
    if (typeof mod.pipeline !== 'function') throw new Error('transformers.pipeline missing');
    onProgress(8);
    /* Mismo task y mismo modelo en PC y móvil; las etiquetas de vehículo se
       filtran después, al combinar las máscaras del resultado. */
    const pipe = await mod.pipeline(BG_TASK, BG_MODEL_ID, Object.assign(
      { device: 'wasm' },
      BG_OPTIONS,
      {
        progress_callback: p => {
          if (!p || typeof p.progress !== 'number') return;
          const raw = p.progress;
          const pct = Math.max(0, Math.min(100, raw > 1 ? raw : raw * 100));
          onProgress(10 + pct * .6); /* descarga: 10 % … 70 % */
        }
      }
    ));
    post({ type: 'model', id, model: BG_MODEL_ID });
    return pipe;
  })().catch(err => { pipePromise = null; throw err; }); /* permite reintentar */
  return pipePromise;
}

/* data: URL → Blob sin depender de fetch(data:) (Safari móvil). */
function dataURLToBlob(src) {
  const comma = src.indexOf(',');
  if (comma < 0) throw new Error('invalid data URL');
  const head = src.slice(0, comma);
  const meta = /^data:([^;,]*)/i.exec(head);
  const mime = meta && meta[1] ? meta[1] : 'image/jpeg';
  const body = src.slice(comma + 1);
  let raw;
  try { raw = atob(body.replace(/\s/g, '')); }
  catch (e) { throw new Error('invalid data URL payload'); }
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
async function sourceBlob(src) {
  if (typeof src !== 'string' || !src) throw new Error('missing image source');
  if (/^data:/i.test(src)) return dataURLToBlob(src);
  const url = /^(?:https?:|blob:)/i.test(src) ? src : new URL(src, self.location.href).href;
  const res = await fetch(url);
  if (!res || !res.ok) throw new Error('image load failed (' + (res ? res.status : 0) + ')');
  return res.blob();
}

/* La app ya reescribe las fotos a 1024 px en PC (512 en móvil) antes
   de enviarlas. Aquí sólo se resuelve la fuente a Blob: nada de codificar JPEG
   con OffscreenCanvas.convertToBlob(), también frágil en WebKit móvil.
   El preprocesador de Transformers.js ajusta la entrada al tamaño del modelo. */
async function preparedInput(src) {
  return sourceBlob(src);
}

/* Calcula porcentaje visible para detectar máscaras rotas (p. ej. autos
   blancos sobre fondo claro donde el modelo borra casi toda la carrocería). */
function maskStats(pixels) {
  const total = Math.floor(pixels.length / 4);
  if (!(total > 0)) return { total: 0, visible: 0, ratio: 0 };
  let visible = 0;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] > 128) visible++;
  }
  return { total, visible, ratio: visible / total };
}

/* ---------- Segmentación vehicular (PC y móvil) --------------------------- */

function isVehicleLabel(label) {
  const s = String(label == null ? '' : label).toLowerCase().trim();
  return VEHICLE_LABELS.indexOf(s) >= 0;
}

/* Máscara de un segmento como Float32 0..1 en el tamaño de la foto. El pipeline
   ya devuelve las máscaras a target_sizes (el tamaño original), pero se
   remuestrea por si una versión de Transformers.js entregara otra escala. */
async function segmentMask(mask, width, height) {
  let img = mask;
  /* Algunas versiones devuelven la máscara como PNG en data: URL. */
  if (typeof mask === 'string' && /^data:image\//i.test(mask)) {
    if (!BG_MODULE || !BG_MODULE.RawImage) throw new Error('RawImage unavailable');
    img = await BG_MODULE.RawImage.read(dataURLToBlob(mask));
  }
  if (!img || typeof img.width !== 'number' || typeof img.height !== 'number' || !img.data) {
    throw new Error('unexpected segmentation mask: ' + Object.prototype.toString.call(mask));
  }
  const sw = Math.floor(img.width), sh = Math.floor(img.height);
  const ch = Math.floor(img.channels || 1);
  if (!(sw > 0) || !(sh > 0) || !(ch > 0)) throw new Error('invalid segmentation mask size');
  const src = img.data;
  const out = new Float32Array(width * height);
  if (sw === width && sh === height) {
    for (let p = 0; p < out.length; p++) out[p] = src[p * ch] / 255;
    return out;
  }
  const sx = sw / width, sy = sh / height;
  for (let y = 0; y < height; y++) {
    const fy = (y + .5) * sy - .5;
    const y0 = Math.max(0, Math.min(sh - 1, Math.floor(fy)));
    const y1 = Math.min(sh - 1, y0 + 1);
    const wy = Math.max(0, Math.min(1, fy - y0));
    for (let x = 0; x < width; x++) {
      const fx = (x + .5) * sx - .5;
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(fx)));
      const x1 = Math.min(sw - 1, x0 + 1);
      const wx = Math.max(0, Math.min(1, fx - x0));
      const a = src[(y0 * sw + x0) * ch], b = src[(y0 * sw + x1) * ch];
      const c = src[(y1 * sw + x0) * ch], d = src[(y1 * sw + x1) * ch];
      out[y * width + x] = ((a + (b - a) * wx) * (1 - wy) + (c + (d - c) * wx) * wy) / 255;
    }
  }
  return out;
}

/* Suavizado de 1 px (kernel 1-2-1 / 2-4-2 / 1-2-1): redondea los bordes de la
   silueta sin dejar de ser opaca en el interior del vehículo. */
function smoothMask1px(mask, width, height) {
  const out = new Float32Array(mask.length);
  for (let y = 0; y < height; y++) {
    const up = y > 0, down = y < height - 1;
    for (let x = 0; x < width; x++) {
      const i = y * width + x, c = mask[i];
      const left = x > 0 ? mask[i - 1] : c;
      const right = x < width - 1 ? mask[i + 1] : c;
      const top = up ? mask[i - width] : c;
      const bottom = down ? mask[i + width] : c;
      const tl = up && x > 0 ? mask[i - width - 1] : c;
      const tr = up && x < width - 1 ? mask[i - width + 1] : c;
      const bl = down && x > 0 ? mask[i + width - 1] : c;
      const br = down && x < width - 1 ? mask[i + width + 1] : c;
      out[i] = (4 * c + 2 * (left + right + top + bottom) + (tl + tr + bl + br)) * (1 / 16);
    }
  }
  return out;
}

/* Combina todas las máscaras de vehículo (unión por máximo) y la aplica como
   canal alfa sobre la foto original (1024 px en PC / 512 px en móvil), sin
   codificar nada en el Worker. */
async function vehicleSegmentsToRGBA(segments, source) {
  const width = Math.floor(source.width), height = Math.floor(source.height);
  if (!(width > 0) || !(height > 0)) throw new Error('invalid source image size');
  const combined = new Float32Array(width * height);
  const list = Array.isArray(segments) ? segments : segments ? [segments] : [];
  let hits = 0;
  for (const seg of list) {
    if (!seg || !isVehicleLabel(seg.label)) continue;
    const m = await segmentMask(seg.mask, width, height);
    for (let p = 0; p < combined.length; p++) {
      if (m[p] > combined[p]) combined[p] = m[p];
    }
    hits++;
  }
  if (!hits) console.warn('[AutoCare worker] SegFormer returned no vehicle segment');
  /* Sin vehículo se devuelve una máscara vacía: app.js la detecta como
     "mask too empty" y conserva la foto original sin aplicar recorte. */
  const alpha = smoothMask1px(combined, width, height);
  const src = source.rgba().data; /* RawImage.fromBlob ya entrega 4 canales */
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let p = 0, j = 0; p < combined.length; p++, j += 4) {
    pixels[j] = src[j]; pixels[j + 1] = src[j + 1]; pixels[j + 2] = src[j + 2];
    pixels[j + 3] = Math.round(alpha[p] * 255);
  }
  return { width, height, pixels, mask: maskStats(pixels) };
}

async function runCut(msg) {
  const id = msg.id;
  progress(id, 4);
  const input = await preparedInput(msg.src);
  progress(id, 6);
  const pipe = await getSegmenter(id, pct => progress(id, pct));
  progress(id, 72);
  const mod = await loadModule();
  if (!mod.RawImage || typeof mod.RawImage.read !== 'function') {
    throw new Error('RawImage unavailable');
  }
  /* PC y móvil comparten el mismo pipeline. Una sola decodificación: la misma
     imagen alimenta el modelo y recibe la máscara. Evita
     OffscreenCanvas.convertToBlob(), frágil en WebKit móvil. app.js ya aplicó
     maxEdge (1024 px en PC, 512 px en móvil) antes de enviar la foto. */
  const source = await mod.RawImage.read(input);
  const segments = await pipe(source, { target_sizes: [[source.height, source.width]] });
  const rgba = await vehicleSegmentsToRGBA(segments, source);
  progress(id, 96);
  const buffer = rgba.pixels.buffer;
  const mask = rgba.mask || { total: 0, visible: 0, ratio: 0 };
  post({ type: 'done', id, width: rgba.width, height: rgba.height, rgba: buffer, mask }, [buffer]);
}

self.addEventListener('message', event => {
  const msg = event.data || {};
  if (msg.type !== 'cut') return;
  runCut(msg).catch(err => {
    post({ type: 'error', id: msg.id, message: String(err && err.message ? err.message : err) });
  });
});
