import zlib from 'zlib';

/**
 * Extrae las fotos incrustadas en un PDF sin librerías externas.
 * Soporta lo más común:
 *   - JPEG (/DCTDecode): se copian tal cual.
 *   - Imágenes comprimidas (/FlateDecode) de 8 bits en RGB o gris: se convierten a PNG.
 * Se ignoran iconos pequeños, máscaras de transparencia y formatos raros (JPEG2000, CMYK sin JPEG, PDFs cifrados).
 */

export interface PdfImage {
  name: string;
  mime: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  data: Buffer;
}

interface PdfObj {
  num: number;
  dict: string;
  streamStart: number;
  streamEnd: number;
}

const MIN_SIDE = 200;

function findDictEnd(s: string, start: number): number {
  // start apunta a '<<'
  let depth = 0;
  for (let i = start; i < s.length - 1; i++) {
    if (s[i] === '<' && s[i + 1] === '<') {
      depth++;
      i++;
    } else if (s[i] === '>' && s[i + 1] === '>') {
      depth--;
      i++;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function parseObjects(s: string): Map<number, PdfObj> {
  const objs = new Map<number, PdfObj>();
  const re = /(\d+)\s+\d+\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const num = Number(m[1]);
    let i = re.lastIndex;
    while (i < s.length && /\s/.test(s[i])) i++;
    if (s.slice(i, i + 2) !== '<<') {
      objs.set(num, { num, dict: s.slice(i, Math.min(s.length, i + 300)).split('endobj')[0], streamStart: -1, streamEnd: -1 });
      continue;
    }
    const end = findDictEnd(s, i);
    if (end < 0) continue;
    const dict = s.slice(i, end);
    let j = end;
    while (j < s.length && /[\s]/.test(s[j])) j++;
    let streamStart = -1;
    let streamEnd = -1;
    if (s.startsWith('stream', j)) {
      streamStart = j + 6;
      if (s[streamStart] === '\r') streamStart++;
      if (s[streamStart] === '\n') streamStart++;
      const len = /\/Length\s+(\d+)\b(?!\s+\d+\s+R)/.exec(dict);
      if (len && s.startsWith('endstream', skipWs(s, streamStart + Number(len[1])))) {
        streamEnd = streamStart + Number(len[1]);
      } else {
        const e = s.indexOf('endstream', streamStart);
        if (e < 0) continue;
        streamEnd = e;
        if (s[streamEnd - 1] === '\n') streamEnd--;
        if (s[streamEnd - 1] === '\r') streamEnd--;
      }
      re.lastIndex = streamEnd;
    }
    objs.set(num, { num, dict, streamStart, streamEnd });
  }
  return objs;
}

function skipWs(s: string, i: number) {
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
}

const num = (dict: string, key: string): number | null => {
  const m = new RegExp(`/${key}\\s+(\\d+)`).exec(dict);
  return m ? Number(m[1]) : null;
};

function resolveRef(objs: Map<number, PdfObj>, value: string): string {
  const r = /^\s*(\d+)\s+\d+\s+R/.exec(value);
  if (!r) return value;
  return objs.get(Number(r[1]))?.dict ?? value;
}

/** Componentes de color (1 = gris, 3 = RGB, 4 = CMYK) o null si no se reconoce. */
function colorComponents(objs: Map<number, PdfObj>, dict: string): number | null {
  const m = /\/ColorSpace\s*(\/\w+|\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(dict);
  if (!m) return null;
  let cs = resolveRef(objs, m[1]);
  if (/DeviceRGB|CalRGB/.test(cs)) return 3;
  if (/DeviceGray|CalGray/.test(cs)) return 1;
  if (/DeviceCMYK/.test(cs)) return 4;
  const icc = /ICCBased\s+(\d+)\s+\d+\s+R/.exec(cs);
  if (icc) {
    cs = objs.get(Number(icc[1]))?.dict ?? '';
    const n = num(cs, 'N');
    return n === 1 || n === 3 || n === 4 ? n : null;
  }
  return null;
}

let crcTable: number[] | null = null;
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable.push(c >>> 0);
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function toPng(width: number, height: number, comps: 1 | 3, rowsWithFilterBytes: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = comps === 3 ? 2 : 0;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(rowsWithFilterBytes)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Decodificador ASCII85 (filtro /ASCII85Decode). */
function ascii85(input: Buffer): Buffer {
  const str = input.toString('latin1').replace(/\s+/g, '');
  const end = str.indexOf('~>');
  const body = (end >= 0 ? str.slice(0, end) : str).replace(/^<~/, '');
  const out: number[] = [];
  let group: number[] = [];
  const flush = (n: number) => {
    while (group.length < 5) group.push(84);
    let v = 0;
    for (const c of group) v = v * 85 + c;
    const bytes = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    out.push(...bytes.slice(0, n));
    group = [];
  };
  for (const ch of body) {
    if (ch === 'z' && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    const c = ch.charCodeAt(0) - 33;
    if (c < 0 || c > 84) continue;
    group.push(c);
    if (group.length === 5) flush(4);
  }
  if (group.length) flush(group.length - 1);
  return Buffer.from(out);
}

/** Decodificador ASCIIHex (filtro /ASCIIHexDecode). */
function asciiHex(input: Buffer): Buffer {
  const hex = input.toString('latin1').replace(/[^0-9a-fA-F]/g, '');
  return Buffer.from(hex.length % 2 ? hex + '0' : hex, 'hex');
}

export function extractPdfImages(pdf: Buffer, max = 12): PdfImage[] {
  const s = pdf.toString('latin1');
  if (!s.startsWith('%PDF')) throw new Error('El archivo no es un PDF.');
  if (/\/Encrypt\s/.test(s)) throw new Error('El PDF está protegido: no se pueden sacar sus imágenes.');

  const objs = parseObjects(s);
  // Las máscaras de transparencia no son fotos
  const masks = new Set<number>();
  for (const o of objs.values()) {
    for (const mm of o.dict.matchAll(/\/(?:SMask|Mask)\s+(\d+)\s+\d+\s+R/g)) masks.add(Number(mm[1]));
  }

  const out: PdfImage[] = [];
  const seen = new Set<string>();
  for (const o of objs.values()) {
    if (o.streamStart < 0 || masks.has(o.num)) continue;
    if (!/\/Subtype\s*\/Image/.test(o.dict)) continue;
    const width = num(o.dict, 'Width') ?? 0;
    const height = num(o.dict, 'Height') ?? 0;
    if (width < MIN_SIDE || height < MIN_SIDE) continue;
    let raw: Buffer = Buffer.from(pdf.subarray(o.streamStart, o.streamEnd));
    let filters: string[] = [...((/\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(o.dict)?.[1] ?? '').match(/\/\w+/g) ?? [])];
    // Filtros de texto delante (ASCII85 / ASCIIHex): se quitan primero
    while (filters[0] === '/ASCII85Decode' || filters[0] === '/A85' || filters[0] === '/ASCIIHexDecode' || filters[0] === '/AHx') {
      raw = filters[0] === '/ASCIIHexDecode' || filters[0] === '/AHx' ? asciiHex(raw) : ascii85(raw);
      filters = filters.slice(1);
    }
    if (filters[0] === '/DCT') filters = ['/DCTDecode'];
    if (filters[0] === '/Fl') filters = ['/FlateDecode'];

    try {
      let img: PdfImage | null = null;
      if (filters.length === 1 && filters[0] === '/DCTDecode') {
        if (raw[0] === 0xff && raw[1] === 0xd8) {
          img = { name: '', mime: 'image/jpeg', width, height, data: Buffer.from(raw) };
        }
      } else if (filters.length === 1 && filters[0] === '/FlateDecode') {
        const bpc = num(o.dict, 'BitsPerComponent') ?? 8;
        const comps = colorComponents(objs, o.dict);
        if (bpc === 8 && (comps === 1 || comps === 3)) {
          const data = zlib.inflateSync(raw);
          const predictor = num(o.dict, 'Predictor') ?? 1;
          const rowLen = width * comps;
          let rows: Buffer | null = null;
          if (predictor >= 10 && data.length === (rowLen + 1) * height) {
            rows = data; // ya trae el byte de filtro PNG por fila
          } else if (predictor === 1 && data.length >= rowLen * height) {
            rows = Buffer.alloc((rowLen + 1) * height);
            for (let y = 0; y < height; y++) data.copy(rows, y * (rowLen + 1) + 1, y * rowLen, (y + 1) * rowLen);
          }
          if (rows) img = { name: '', mime: 'image/png', width, height, data: toPng(width, height, comps, rows) };
        }
      }
      if (!img) continue;
      const key = `${width}x${height}:${img.data.subarray(0, 64).toString('hex')}:${img.data.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(img);
    } catch {
      // imagen dañada o formato no soportado: se omite
    }
  }

  return out
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .slice(0, max)
    .map((img, i) => ({ ...img, name: `pdf_imagen_${i + 1}.${img.mime === 'image/jpeg' ? 'jpg' : 'png'}` }));
}
