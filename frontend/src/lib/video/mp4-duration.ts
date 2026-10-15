/**
 * Lee la duración de un MP4 desde la caja `mvhd` (servidor, sin ffmpeg ni navegador).
 * Devuelve segundos con un decimal, o 0 si no se puede leer.
 */
export function mp4DurationSeconds(buf: Buffer): number {
  try {
    const idx = buf.indexOf('mvhd', 0, 'latin1');
    if (idx < 4) return 0;
    const version = buf.readUInt8(idx + 4);
    let timescale: number;
    let duration: number;
    if (version === 1) {
      timescale = buf.readUInt32BE(idx + 4 + 4 + 8 + 8);
      duration = Number(buf.readBigUInt64BE(idx + 4 + 4 + 8 + 8 + 4));
    } else {
      timescale = buf.readUInt32BE(idx + 4 + 4 + 4 + 4);
      duration = buf.readUInt32BE(idx + 4 + 4 + 4 + 4 + 4);
    }
    if (!timescale || !duration) return 0;
    return Math.round((duration / timescale) * 10) / 10;
  } catch {
    return 0;
  }
}
