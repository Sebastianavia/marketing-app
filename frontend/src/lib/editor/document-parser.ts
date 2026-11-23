import path from 'path';
import { extractText } from 'unpdf';

export interface ParsedDocument {
  filename: string;
  extension: string;
  text: string;
  pageCount?: number;
  rawBytes: Buffer;
  mimeType: string;
}

const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024; // 20 MB

/**
 * Extrae texto y metadatos de un archivo subido (PDF, TXT, MD, JSON).
 */
export async function parseDocument(file: { name: string; bytes: Buffer }): Promise<ParsedDocument> {
  if (!file.bytes || file.bytes.length === 0) {
    throw new Error('El documento está vacío.');
  }
  if (file.bytes.length > MAX_DOCUMENT_BYTES) {
    throw new Error('El documento supera el límite de 20 MB.');
  }

  const ext = (path.extname(file.name).toLowerCase() || '.txt').replace(/[^.a-z0-9]/g, '');
  const mimeType = ext === '.pdf' ? 'application/pdf' : ext === '.json' ? 'application/json' : ext === '.md' ? 'text/markdown' : 'text/plain';

  if (ext === '.pdf') {
    try {
      const uint8 = new Uint8Array(file.bytes);
      const result = await extractText(uint8);
      const pages = Array.isArray(result.text) ? result.text : [result.text];
      const combined = pages
        .map((p, idx) => (pages.length > 1 ? `--- Página ${idx + 1} ---\n${p}` : p))
        .join('\n\n')
        .trim();

      if (!combined && pages.length === 0) {
        throw new Error('No se pudo extraer texto legible del PDF. Asegúrate de que no sea solo un escaneo sin texto.');
      }

      return {
        filename: file.name,
        extension: ext,
        text: combined,
        pageCount: result.totalPages ?? pages.length,
        rawBytes: file.bytes,
        mimeType,
      };
    } catch (err) {
      if (err instanceof Error && err.message.includes('legible')) throw err;
      throw new Error(`Error al leer el archivo PDF: ${err instanceof Error ? err.message : 'formato incompatible'}`);
    }
  }

  // Archivos de texto plano / markdown / json
  const text = file.bytes.toString('utf-8').trim();
  if (!text) {
    throw new Error('El archivo de texto está vacío.');
  }

  return {
    filename: file.name,
    extension: ext,
    text,
    pageCount: 1,
    rawBytes: file.bytes,
    mimeType,
  };
}

