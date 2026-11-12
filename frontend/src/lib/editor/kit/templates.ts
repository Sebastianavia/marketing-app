/**
 * Plantillas del kit de gráficos de Lulo (Fase 3). Cada función devuelve el index.html de un
 * proyecto HyperFrames (HTML + GSAP) de UNA pieza animada, con la paleta del video, que se renderiza
 * a .mov con transparencia (ProRes 4444) y se coloca en el plan como elemento «capa».
 * Todo es determinista (sin Math.random ni relojes): mismo pedido → mismo video.
 */

export interface KitPalette {
  primario: string;
  acento: string;
  secundario?: string;
  texto: string;
  fondo: string;
}

export interface KitFrame {
  W: number;
  H: number;
  /** Márgenes de la zona segura de la red (px). */
  safe: { top: number; bottom: number; right: number };
  pal: KitPalette;
  /** Fuente de títulos (incluida en HyperFrames). */
  titulo: string;
  /** Fuente de texto. */
  cuerpo: string;
}

export interface KitBuilt {
  html: string;
  duracion: number;
}

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n2 = (x: number) => Math.round(x * 100) / 100;
const js = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

/** Esqueleto común: raíz transparente, una «clip» con toda la pieza y un timeline en pausa. */
function page(fr: KitFrame, dur: number, css: string, body: string, script: string): string {
  const { W, H, pal } = fr;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=${W}, height=${H}" />
<script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
<style>
:root{--p:${pal.primario};--a:${pal.acento};--s:${pal.secundario ?? pal.acento};--t:${pal.texto};--f:${pal.fondo}}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:transparent}
#root{position:absolute;inset:0;overflow:hidden;font-family:'${fr.cuerpo}',sans-serif;color:var(--t)}
#k{position:absolute;inset:0}
.ti{font-family:'${fr.titulo}',sans-serif;text-transform:uppercase;line-height:1}
.stroke{-webkit-text-stroke:10px #000;paint-order:stroke fill;text-shadow:0 8px 0 rgba(0,0,0,.45)}
${css}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${n2(dur)}" data-width="${W}" data-height="${H}">
<div id="k" class="clip" data-start="0" data-duration="${n2(dur)}" data-layout-allow-overflow data-layout-allow-overlap>
${body}
</div>
</div>
<script>
const tl = gsap.timeline({ paused: true });
${script}
window.__timelines["main"] = tl;
</script>
</body>
</html>
`;
}

/** Filtro SVG de trazo «a mano» (turbulencia fija). */
const ROUGH = `<filter id="rough" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="7"/></filter>`;

const clampY = (fr: KitFrame, y: number) => Math.min(fr.H - fr.safe.bottom - 40, Math.max(fr.safe.top + 40, y));

// ── Sticker / emoji (★21) ────────────────────────────────────────────────────

export function sticker(fr: KitFrame, o: { emoji?: string; texto?: string; x: number; y: number; tamano: number; duracion: number; giro: number }): KitBuilt {
  const d = o.duracion;
  const cx = o.x * fr.W;
  const cy = clampY(fr, o.y * fr.H);
  const size = o.tamano;
  const isText = !!o.texto && !o.emoji;
  const css = `
#st{position:absolute;left:${n2(cx)}px;top:${n2(cy)}px;width:0;height:0}
#sti{position:absolute;left:0;top:0;transform-origin:0 0}
#em{position:absolute;font-size:${size}px;line-height:1;white-space:nowrap;filter:drop-shadow(0 14px 18px rgba(0,0,0,.45))}
#pill{position:absolute;white-space:nowrap;padding:${n2(size * 0.18)}px ${n2(size * 0.32)}px;border-radius:${n2(size * 0.5)}px;background:var(--a);color:var(--f);border:${n2(size * 0.06)}px solid #fff;font-size:${n2(size * 0.42)}px;box-shadow:0 16px 30px rgba(0,0,0,.45)}
#lb{position:absolute;white-space:nowrap;font-size:${n2(size * 0.26)}px}`;
  const inner = isText
    ? `<div id="pill" class="ti">${esc(o.texto!)}</div>`
    : `<div id="em">${esc(o.emoji ?? '🔥')}</div>${o.texto ? `<div id="lb" class="ti stroke">${esc(o.texto)}</div>` : ''}`;
  const body = `<div id="st"><div id="sti">${inner}</div></div>`;
  const script = `
const main = document.getElementById(${js(isText ? 'pill' : 'em')});
const bw = main.offsetWidth, bh = main.offsetHeight;
main.style.left = (-bw / 2) + 'px'; main.style.top = (-bh / 2) + 'px';
const lb = document.getElementById('lb');
if (lb) { lb.style.left = (-lb.offsetWidth / 2) + 'px'; lb.style.top = (bh / 2 + 6) + 'px'; }
tl.fromTo('#sti', { scale: 0, rotation: ${o.giro - 25} }, { scale: 1.18, rotation: ${o.giro + 4}, duration: 0.2, ease: 'power3.out' }, 0);
tl.to('#sti', { scale: 1, rotation: ${o.giro}, duration: 0.16, ease: 'power2.inOut' }, 0.2);
// Vida mientras está: un pequeño balanceo
tl.to('#sti', { rotation: ${o.giro + 5}, scale: 1.04, duration: ${n2(Math.max(0.2, (d - 0.65) / 2))}, ease: 'sine.inOut', yoyo: true, repeat: 1 }, 0.36);
tl.to('#sti', { scale: 0, rotation: ${o.giro + 20}, duration: 0.18, ease: 'back.in(2)' }, ${n2(d - 0.22)});`;
  return { html: page(fr, d, css, body, script), duracion: d };
}

// ── Trazos a mano: flecha, círculo, subrayado, tachado (22) ──────────────────

export function trazo(
  fr: KitFrame,
  o: { forma: 'flecha' | 'circulo' | 'subrayado' | 'tachado'; x: number; y: number; x2?: number; y2?: number; ancho?: number; alto?: number; texto?: string; color?: string; duracion: number; grosor: number }
): KitBuilt {
  const { W, H } = fr;
  const d = o.duracion;
  const col = o.color ?? 'var(--a)';
  let path = '';
  let head = '';
  let label = '';
  if (o.forma === 'flecha') {
    // De (x2,y2) [origen] a (x,y) [lo señalado], curvada
    const x1 = (o.x2 ?? Math.min(0.9, o.x + 0.3)) * W;
    const y1 = (o.y2 ?? Math.max(0.1, o.y - 0.15)) * H;
    const x2 = o.x * W;
    const y2 = o.y * H;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const cx = mx - (dy / len) * len * 0.22;
    const cy = my + (dx / len) * len * 0.22;
    // La punta se queda a 20 px del objetivo
    const ex = x2 - ((x2 - cx) / Math.hypot(x2 - cx, y2 - cy)) * 20;
    const ey = y2 - ((y2 - cy) / Math.hypot(x2 - cx, y2 - cy)) * 20;
    path = `M${n2(x1)},${n2(y1)} Q${n2(cx)},${n2(cy)} ${n2(ex)},${n2(ey)}`;
    const ang = Math.atan2(ey - cy, ex - cx);
    const hl = Math.max(40, o.grosor * 4);
    const a1 = ang + Math.PI - 0.5;
    const a2 = ang + Math.PI + 0.5;
    head = `M${n2(ex + Math.cos(a1) * hl)},${n2(ey + Math.sin(a1) * hl)} L${n2(ex)},${n2(ey)} L${n2(ex + Math.cos(a2) * hl)},${n2(ey + Math.sin(a2) * hl)}`;
    if (o.texto) label = `<div id="lab" class="ti stroke" style="position:absolute;left:${n2(Math.min(W - 80, Math.max(80, x1)))}px;top:${n2(y1 - 90)}px;transform:translateX(-50%);font-size:64px;white-space:nowrap;color:#fff">${esc(o.texto)}</div>`;
  } else if (o.forma === 'circulo') {
    const cx = o.x * W;
    const cy = o.y * H;
    const rx = ((o.ancho ?? 0.35) * W) / 2;
    const ry = ((o.alto ?? 0.12) * H) / 2;
    const pts: string[] = [];
    // Un poco más de una vuelta, con el radio que «tiembla» como a mano (determinista)
    for (let i = 0; i <= 60; i++) {
      const a = (-110 + (i / 60) * 395) * (Math.PI / 180);
      const wob = 1 + 0.035 * Math.sin(i * 1.7) + 0.05 * (i / 60);
      pts.push(`${n2(cx + Math.cos(a) * rx * wob)},${n2(cy + Math.sin(a) * ry * wob)}`);
    }
    path = `M${pts[0]} L${pts.slice(1).join(' L')}`;
    if (o.texto) label = `<div id="lab" class="ti stroke" style="position:absolute;left:${n2(cx)}px;top:${n2(cy - ry - 100)}px;transform:translateX(-50%);font-size:64px;white-space:nowrap;color:#fff">${esc(o.texto)}</div>`;
  } else {
    const x1 = o.x * W;
    const x2 = (o.x2 ?? Math.min(0.95, o.x + 0.5)) * W;
    const y = o.y * H;
    const pts: string[] = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const wy = o.forma === 'subrayado' ? Math.sin(t * Math.PI * 3) * 6 : Math.sin(t * Math.PI) * -10;
      pts.push(`${n2(x1 + (x2 - x1) * t)},${n2(y + wy + (o.forma === 'tachado' ? (t - 0.5) * -24 : 0))}`);
    }
    path = `M${pts[0]} L${pts.slice(1).join(' L')}`;
  }
  const css = `svg{position:absolute;left:0;top:0;width:${W}px;height:${H}px;overflow:visible}
.ln{fill:none;stroke:${col};stroke-width:${o.grosor};stroke-linecap:round;stroke-linejoin:round;filter:url(#rough) drop-shadow(0 6px 6px rgba(0,0,0,.45))}`;
  const body = `<svg viewBox="0 0 ${W} ${H}"><defs>${ROUGH}</defs><path id="p1" class="ln" d="${path}"/>${head ? `<path id="p2" class="ln" d="${head}"/>` : ''}</svg>${label}`;
  const draw = o.forma === 'circulo' ? 0.45 : o.forma === 'flecha' ? 0.35 : 0.3;
  const script = `
for (const id of ['p1','p2']) { const el = document.getElementById(id); if (!el) continue; const L = el.getTotalLength(); el.style.strokeDasharray = L + ' ' + L; el.style.strokeDashoffset = L; el.dataset.len = L; }
const p1 = document.getElementById('p1'); const p2 = document.getElementById('p2');
tl.fromTo(p1, { strokeDashoffset: +p1.dataset.len }, { strokeDashoffset: 0, duration: ${draw}, ease: 'power2.inOut' }, 0.02);
if (p2) tl.fromTo(p2, { strokeDashoffset: +p2.dataset.len }, { strokeDashoffset: 0, duration: 0.14, ease: 'power2.out' }, ${draw});
const lab = document.getElementById('lab');
if (lab) tl.fromTo(lab, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.2, ease: 'back.out(2)' }, 0.1);
tl.to('#k', { opacity: 0, duration: 0.18 }, ${n2(d - 0.2)});`;
  return { html: page(fr, d, css, body, script), duracion: d };
}

// ── Gráficas que crecen (23) ─────────────────────────────────────────────────

function panelTop(fr: KitFrame, posicion: 'arriba' | 'centro' | 'abajo', h: number) {
  if (posicion === 'arriba') return fr.safe.top + 40;
  if (posicion === 'abajo') return fr.H - fr.safe.bottom - h - 40;
  return (fr.H - h) / 2;
}

export function grafica(
  fr: KitFrame,
  o: { forma: 'barras' | 'circulo' | 'linea'; datos: Array<{ etiqueta: string; valor: number }>; titulo?: string; unidad?: string; posicion: 'arriba' | 'centro' | 'abajo'; duracion: number }
): KitBuilt {
  const { W } = fr;
  const d = o.duracion;
  const pw = W - 120;
  const max = Math.max(...o.datos.map((x) => x.valor), 1);
  const dec = o.datos.some((x) => !Number.isInteger(x.valor)) ? 1 : 0;
  const unit = esc(o.unidad ?? '');
  let inner = '';
  let script = '';
  let ph = 0;
  if (o.forma === 'barras') {
    const rowH = 104;
    ph = (o.titulo ? 120 : 40) + o.datos.length * rowH + 30;
    inner = o.datos
      .map((x, i) => {
        const w = Math.max(0.04, x.valor / max);
        return `<div class="row" style="top:${(o.titulo ? 120 : 40) + i * rowH}px">
<div class="lb">${esc(x.etiqueta)}</div>
<div class="track"><div class="bar" id="b${i}" style="width:${n2(w * 100)}%;background:${i === o.datos.length - 1 || x.valor === max ? 'var(--a)' : 'var(--s)'}"></div></div>
<div class="val ti"><span id="v${i}">0</span>${unit}</div></div>`;
      })
      .join('');
    script = o.datos
      .map((x, i) => `tl.fromTo('#b${i}', { scaleX: 0 }, { scaleX: 1, duration: 0.55, ease: 'power3.out' }, ${n2(0.25 + i * 0.12)});
tl.fromTo('#v${i}', { innerText: 0 }, { innerText: ${x.valor}, snap: { innerText: ${dec ? 0.1 : 1} }, duration: 0.55, ease: 'power3.out' }, ${n2(0.25 + i * 0.12)});`)
      .join('\n');
  } else if (o.forma === 'circulo') {
    const v = o.datos[0]?.valor ?? 0;
    const pct = Math.max(0, Math.min(100, (o.unidad ?? '%') === '%' ? v : (v / max) * 100));
    ph = (o.titulo ? 120 : 60) + 540 + (o.datos[0]?.etiqueta ? 110 : 30);
    const r = 220;
    const C = 2 * Math.PI * r;
    inner = `<svg style="position:absolute;left:${(pw - 520) / 2}px;top:${o.titulo ? 120 : 60}px" width="520" height="520" viewBox="0 0 520 520">
<circle cx="260" cy="260" r="${r}" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="44"/>
<circle id="ring" cx="260" cy="260" r="${r}" fill="none" stroke="var(--a)" stroke-width="44" stroke-linecap="round" transform="rotate(-90 260 260)" stroke-dasharray="${n2(C)}" stroke-dashoffset="${n2(C)}"/></svg>
<div class="big ti" style="top:${(o.titulo ? 120 : 60) + 190}px"><span id="v0">0</span>${esc(o.unidad ?? '%')}</div>
${o.datos[0]?.etiqueta ? `<div class="sub" style="top:${(o.titulo ? 120 : 60) + 540}px">${esc(o.datos[0].etiqueta)}</div>` : ''}`;
    script = `tl.fromTo('#ring', { strokeDashoffset: ${n2(C)} }, { strokeDashoffset: ${n2(C * (1 - pct / 100))}, duration: 0.9, ease: 'power3.out' }, 0.25);
tl.fromTo('#v0', { innerText: 0 }, { innerText: ${v}, snap: { innerText: ${dec ? 0.1 : 1} }, duration: 0.9, ease: 'power3.out' }, 0.25);`;
  } else {
    ph = 720;
    const cw = pw - 100;
    const ch = 400;
    const top = o.titulo ? 130 : 60;
    const pts = o.datos.map((x, i) => [50 + (o.datos.length === 1 ? cw / 2 : (i / (o.datos.length - 1)) * cw), top + ch - (x.valor / max) * ch] as const);
    inner = `<svg style="position:absolute;left:0;top:0" width="${pw}" height="${ph}"><path id="ln" d="M${pts.map((p) => `${n2(p[0])},${n2(p[1])}`).join(' L')}" fill="none" stroke="var(--a)" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>
${pts.map((p, i) => `<circle id="d${i}" cx="${n2(p[0])}" cy="${n2(p[1])}" r="18" fill="var(--a)" stroke="#fff" stroke-width="6"/>`).join('')}</svg>
${o.datos.map((x, i) => `<div class="pl" id="l${i}" style="left:${n2(pts[i][0])}px;top:${top + ch + 30}px">${esc(x.etiqueta)}</div><div class="pv ti" id="w${i}" style="left:${n2(pts[i][0])}px;top:${n2(pts[i][1] - 80)}px">${esc(String(x.valor))}${unit}</div>`).join('')}`;
    script = `const ln = document.getElementById('ln'); const L = ln.getTotalLength(); ln.style.strokeDasharray = L + ' ' + L;
tl.fromTo(ln, { strokeDashoffset: L }, { strokeDashoffset: 0, duration: 0.9, ease: 'power2.inOut' }, 0.25);
${o.datos.map((_, i) => `tl.fromTo('#d${i}', { scale: 0, transformOrigin: '50% 50%' }, { scale: 1, duration: 0.2, ease: 'back.out(3)' }, ${n2(0.25 + (i / Math.max(1, o.datos.length - 1)) * 0.85)});
tl.fromTo('#w${i}', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.2 }, ${n2(0.3 + (i / Math.max(1, o.datos.length - 1)) * 0.85)});`).join('\n')}`;
  }
  const top = panelTop(fr, o.posicion, ph);
  const css = `#pn{position:absolute;left:60px;top:${n2(top)}px;width:${pw}px;height:${ph}px;border-radius:44px;background:color-mix(in srgb, var(--f) 88%, transparent);border:3px solid color-mix(in srgb, var(--a) 60%, transparent);box-shadow:0 30px 80px rgba(0,0,0,.55);overflow:hidden}
#ttl{position:absolute;left:0;top:34px;width:100%;text-align:center;font-size:58px;color:var(--t)}
.row{position:absolute;left:40px;width:${pw - 80}px;height:84px}
.lb{position:absolute;left:0;top:0;width:250px;height:84px;display:flex;align-items:center;font-size:38px;font-weight:700;white-space:nowrap;overflow:hidden}
.track{position:absolute;left:265px;top:14px;width:${pw - 80 - 265 - 190}px;height:56px;border-radius:28px;background:rgba(255,255,255,.08)}
.bar{position:absolute;left:0;top:0;height:100%;border-radius:28px;transform-origin:0 50%}
.val{position:absolute;right:0;top:0;width:180px;height:84px;display:flex;align-items:center;justify-content:flex-end;font-size:54px}
.big{position:absolute;left:0;width:100%;text-align:center;font-size:150px;color:var(--t)}
.sub{position:absolute;left:0;width:100%;text-align:center;font-size:44px;font-weight:700;color:var(--a)}
.pl{position:absolute;transform:translateX(-50%);font-size:34px;font-weight:700;white-space:nowrap}
.pv{position:absolute;transform:translateX(-50%);font-size:46px;white-space:nowrap}`;
  const body = `<div id="pn">${o.titulo ? `<div id="ttl" class="ti">${esc(o.titulo)}</div>` : ''}${inner}</div>`;
  const full = `tl.fromTo('#pn', { y: 80, opacity: 0, scale: 0.94 }, { y: 0, opacity: 1, scale: 1, duration: 0.3, ease: 'back.out(1.6)' }, 0);
${o.titulo ? `tl.fromTo('#ttl', { opacity: 0, y: -16 }, { opacity: 1, y: 0, duration: 0.25 }, 0.12);` : ''}
${script}
tl.to('#pn', { y: 60, opacity: 0, duration: 0.22, ease: 'power2.in' }, ${n2(d - 0.24)});`;
  return { html: page(fr, d, css, body, full), duracion: d };
}

// ── Antes / después con cortinilla (24) ──────────────────────────────────────

export function antesDespues(
  fr: KitFrame,
  o: { a: { src: string; video: boolean }; b: { src: string; video: boolean }; etiquetaA: string; etiquetaB: string; posicion: 'arriba' | 'centro' | 'abajo'; duracion: number }
): KitBuilt {
  const { W } = fr;
  const d = o.duracion;
  const cw = W - 120;
  const ch = Math.round(cw * 1.1);
  const top = panelTop(fr, o.posicion, ch);
  const media = (m: { src: string; video: boolean }, id: string) =>
    m.video ? `<video id="${id}" class="clip med" src="${esc(m.src)}" data-start="0" data-duration="${n2(d)}" muted playsinline></video>` : `<img id="${id}" class="med" src="${esc(m.src)}" />`;
  const css = `#cd{position:absolute;left:60px;top:${n2(top)}px;width:${cw}px;height:${ch}px;border-radius:40px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.6);border:6px solid #fff}
.med{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover}
#lyB{position:absolute;inset:0}
#hd{position:absolute;top:0;width:8px;height:100%;background:#fff;box-shadow:0 0 24px rgba(0,0,0,.5)}
#kn{position:absolute;top:50%;left:-36px;width:80px;height:80px;margin-top:-40px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font-size:40px;color:#111;font-weight:900}
.tag{position:absolute;top:28px;padding:10px 26px;border-radius:30px;font-size:40px}
#ta{left:28px;background:rgba(0,0,0,.65);color:#fff}
#tb{right:28px;background:var(--a);color:var(--f)}`;
  const body = `<div id="cd"><div id="lyA">${media(o.a, 'ma')}</div><div id="lyB">${media(o.b, 'mb')}</div><div id="hd"><div id="kn">⇆</div></div>
<div id="ta" class="tag ti">${esc(o.etiquetaA)}</div><div id="tb" class="tag ti">${esc(o.etiquetaB)}</div></div>`;
  const w0 = 0.35;
  const wipe = Math.min(1.2, Math.max(0.6, d * 0.35));
  const script = `
tl.fromTo('#cd', { scale: 0.9, opacity: 0, y: 60 }, { scale: 1, opacity: 1, y: 0, duration: 0.3, ease: 'back.out(1.5)' }, 0);
tl.fromTo('#lyB', { clipPath: 'inset(0% 0% 0% 100%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: ${n2(wipe)}, ease: 'power2.inOut' }, ${w0});
tl.fromTo('#hd', { left: '${cw}px' }, { left: '0px', duration: ${n2(wipe)}, ease: 'power2.inOut' }, ${w0});
tl.fromTo('#tb', { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.2, ease: 'back.out(2)' }, ${n2(w0 + wipe * 0.6)});
tl.to('#hd', { opacity: 0, duration: 0.2 }, ${n2(w0 + wipe + 0.1)});
tl.to('#ta', { opacity: 0, duration: 0.2 }, ${n2(w0 + wipe * 0.8)});
tl.to('#cd', { scale: 0.92, opacity: 0, y: 40, duration: 0.22, ease: 'power2.in' }, ${n2(d - 0.24)});`;
  return { html: page(fr, d, css, body, script), duracion: d };
}

// ── Tarjeta de capítulo (25) ─────────────────────────────────────────────────

export function capitulo(fr: KitFrame, o: { numero?: string; titulo: string; fondo: 'solido' | 'banda'; duracion: number }): KitBuilt {
  const { W, H } = fr;
  const d = o.duracion;
  const solid = o.fondo === 'solido';
  const css = `#bg{position:absolute;left:0;top:${solid ? 0 : n2(H * 0.36)}px;width:${W}px;height:${solid ? H : n2(H * 0.28)}px;background:var(--p);overflow:hidden}
#bg2{position:absolute;inset:0;background:var(--a);opacity:.9}
#dg{position:absolute;left:-10%;top:0;width:38%;height:100%;background:linear-gradient(90deg,transparent,color-mix(in srgb, var(--a) 18%, transparent))}
#cw{position:absolute;left:60px;width:${W - 120}px;top:${solid ? n2(H * 0.5) : n2(H * 0.5)}px;height:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
#num{font-size:${solid ? 70 : 52}px;color:var(--a);letter-spacing:6px;margin-bottom:18px}
#tt{text-align:center;font-size:${solid ? 130 : 96}px;color:var(--t)}
#ul{flex-shrink:0;margin-top:26px;width:${solid ? 320 : 240}px;height:14px;border-radius:7px;background:var(--a);transform-origin:50% 50%}`;
  const body = `<div id="bg"><div id="dg"></div><div id="bg2"></div></div><div id="cw">${o.numero ? `<div id="num" class="ti">${esc(o.numero)}</div>` : ''}<div id="tt" class="ti">${esc(o.titulo)}</div><div id="ul"></div></div>`;
  const out = n2(d - 0.22);
  const script = `
tl.fromTo('#bg2', { xPercent: -100 }, { xPercent: 100, duration: 0.32, ease: 'power3.inOut' }, 0);
tl.fromTo('#bg', { xPercent: -100 }, { xPercent: 0, duration: 0.24, ease: 'power3.out' }, 0.06);
tl.fromTo('#dg', { xPercent: 0, skewX: -14 }, { xPercent: 260, skewX: -14, duration: ${n2(d)}, ease: 'none' }, 0);
tl.fromTo('#tt', { y: 60, opacity: 0, skewX: -8 }, { y: 0, opacity: 1, skewX: 0, duration: 0.24, ease: 'back.out(1.8)' }, 0.18);
tl.fromTo('#ul', { scaleX: 0 }, { scaleX: 1, duration: 0.3, ease: 'power3.out' }, 0.3);
if (document.getElementById('num')) tl.fromTo('#num', { opacity: 0, letterSpacing: '30px' }, { opacity: 1, letterSpacing: '6px', duration: 0.3, ease: 'power2.out' }, 0.14);
tl.to('#cw', { y: -50, opacity: 0, duration: 0.16, ease: 'power2.in' }, ${out});
tl.to('#bg', { xPercent: 100, duration: 0.22, ease: 'power3.in' }, ${out});`;
  return { html: page(fr, d, css, body, script), duracion: d };
}

// ── Texto kinético (26) ──────────────────────────────────────────────────────

export function textoKinetico(fr: KitFrame, o: { palabras: Array<{ texto: string; t: number }>; destacar: string[]; oscurecer: number; duracion: number; posicion: 'arriba' | 'centro' | 'abajo' }): KitBuilt {
  const { W, H } = fr;
  const d = o.duracion;
  const chars = o.palabras.reduce((s, w) => s + w.texto.length + 1, 0);
  const fs = chars <= 18 ? 170 : chars <= 32 ? 136 : chars <= 50 ? 112 : 92;
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const hi = new Set(o.destacar.map(norm));
  const top = o.posicion === 'arriba' ? fr.safe.top + 60 : o.posicion === 'abajo' ? H * 0.55 : H * 0.3;
  const css = `#dim{position:absolute;inset:0;background:#000;opacity:0}
#wr{position:absolute;left:60px;top:${n2(top)}px;width:${W - 120}px;display:flex;flex-wrap:wrap;justify-content:center;align-content:flex-start;gap:${n2(fs * 0.12)}px ${n2(fs * 0.24)}px}
.w{display:inline-block;font-size:${fs}px;color:#fff;opacity:0}
.w.h{color:var(--a)}`;
  const body = `<div id="dim"></div><div id="wr">${o.palabras.map((w, i) => `<span id="w${i}" class="w ti stroke${hi.has(norm(w.texto)) ? ' h' : ''}">${esc(w.texto)}</span>`).join('')}</div>`;
  const script = `
${o.oscurecer > 0 ? `tl.fromTo('#dim', { opacity: 0 }, { opacity: ${n2(o.oscurecer)}, duration: 0.2 }, 0); tl.to('#dim', { opacity: 0, duration: 0.2 }, ${n2(d - 0.2)});` : ''}
${o.palabras
  .map((w, i) => {
    const big = hi.has(norm(w.texto));
    return `tl.fromTo('#w${i}', { opacity: 0, scale: ${big ? 1.8 : 0.4}, y: ${big ? 0 : 40} }, { opacity: 1, scale: 1, y: 0, duration: ${big ? 0.16 : 0.12}, ease: '${big ? 'power4.out' : 'back.out(2.5)'}' }, ${n2(Math.max(0, w.t))});`;
  })
  .join('\n')}
tl.to('#wr', { opacity: 0, scale: 1.06, duration: 0.18, ease: 'power2.in' }, ${n2(d - 0.2)});`;
  return { html: page(fr, d, css, body, script), duracion: d };
}

// ── Marca: intro y cierre (28) ───────────────────────────────────────────────

export function marca(
  fr: KitFrame,
  o: { modo: 'intro' | 'cierre'; nombre: string; logo?: string; lema?: string; cta?: string; fondo: 'solido' | 'tarjeta'; duracion: number }
): KitBuilt {
  const { W, H } = fr;
  const d = o.duracion;
  const solid = o.fondo === 'solido';
  const cardH = 420;
  const cardTop = H - fr.safe.bottom - cardH - 60;
  const css = `#bg{position:absolute;inset:0;background:var(--p)}
#cardw{position:absolute;left:60px;top:${cardTop}px;width:${W - 120}px;height:${cardH}px;border-radius:48px;background:var(--p);box-shadow:0 30px 80px rgba(0,0,0,.6);border:4px solid var(--a)}
#lg{position:absolute;left:50%;object-fit:contain}
#nm{position:absolute;left:0;width:100%;text-align:center;color:var(--t)}
#lm{position:absolute;left:0;width:100%;text-align:center;font-weight:700;color:var(--t);opacity:.85}
#ct{position:absolute;left:50%;padding:18px 40px;border-radius:40px;background:var(--a);color:var(--f);white-space:nowrap}`;
  let body: string;
  if (solid) {
    const ly = H * 0.32;
    body = `<div id="bg"></div>${o.logo ? `<img id="lg" src="${esc(o.logo)}" style="top:${n2(ly)}px;width:420px;height:420px;margin-left:-210px" />` : ''}
<div id="nm" class="ti" style="top:${n2(o.logo ? ly + 460 : H * 0.42)}px;font-size:110px">${esc(o.nombre)}</div>
${o.lema ? `<div id="lm" style="top:${n2(o.logo ? ly + 600 : H * 0.42 + 140)}px;font-size:46px">${esc(o.lema)}</div>` : ''}
${o.cta ? `<div id="ct" class="ti" style="top:${n2(H * 0.72)}px;font-size:56px;transform:translateX(-50%)">${esc(o.cta)}</div>` : ''}`;
  } else {
    body = `<div id="cardw">${o.logo ? `<img id="lg" src="${esc(o.logo)}" style="top:40px;width:180px;height:180px;margin-left:-90px" />` : ''}
<div id="nm" class="ti" style="top:${o.logo ? 236 : 90}px;font-size:72px">${esc(o.nombre)}</div>
${o.lema ? `<div id="lm" style="top:${o.logo ? 322 : 190}px;font-size:36px">${esc(o.lema)}</div>` : ''}</div>
${o.cta ? `<div id="ct" class="ti" style="top:${cardTop - 120}px;font-size:54px;transform:translateX(-50%)">${esc(o.cta)}</div>` : ''}`;
  }
  const out = n2(d - 0.24);
  const script = solid
    ? `tl.fromTo('#bg', { clipPath: 'circle(0% at 50% 45%)' }, { clipPath: 'circle(75% at 50% 45%)', duration: 0.35, ease: 'power3.out' }, 0);
if (document.getElementById('lg')) tl.fromTo('#lg', { scale: 0, rotation: -20 }, { scale: 1, rotation: 0, duration: 0.3, ease: 'back.out(2)' }, 0.15);
tl.fromTo('#nm', { y: 50, opacity: 0 }, { y: 0, opacity: 1, duration: 0.25, ease: 'back.out(1.6)' }, 0.25);
if (document.getElementById('lm')) tl.fromTo('#lm', { opacity: 0 }, { opacity: 0.85, duration: 0.25 }, 0.4);
if (document.getElementById('ct')) tl.fromTo('#ct', { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.22, ease: 'back.out(2.5)' }, 0.5);
tl.to('#k', { ${o.modo === 'intro' ? "clipPath: 'circle(0% at 50% 45%)', duration: 0.24, ease: 'power3.in'" : 'opacity: 0, duration: 0.2'} }, ${out});`
    : `tl.fromTo('#cardw', { y: 120, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: 'back.out(1.5)' }, 0);
if (document.getElementById('lg')) tl.fromTo('#lg', { scale: 0 }, { scale: 1, duration: 0.25, ease: 'back.out(2.5)' }, 0.18);
tl.fromTo('#nm', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.2 }, 0.25);
if (document.getElementById('lm')) tl.fromTo('#lm', { opacity: 0 }, { opacity: 0.85, duration: 0.2 }, 0.35);
if (document.getElementById('ct')) tl.fromTo('#ct', { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.22, ease: 'back.out(2.5)' }, 0.45);
tl.to('#k', { y: 80, opacity: 0, duration: 0.22, ease: 'power2.in' }, ${out});`;
  return { html: page(fr, d, css, body, script), duracion: d };
}

// ── Pantalla en un teléfono o portátil, con zoom y cursor (17, 18) ──────────

export function pantalla(
  fr: KitFrame,
  o: {
    src: string;
    video: boolean;
    dispositivo: 'telefono' | 'portatil' | 'ninguno';
    /** Puntos de interés dentro de la pantalla (0–1) con su zoom; el cursor va a cada uno y hace clic. */
    enfoques: Array<{ t: number; x: number; y: number; zoom: number; clic: boolean }>;
    inclinacion: number;
    posicion: 'arriba' | 'centro' | 'abajo';
    duracion: number;
    inicioVideo: number;
  }
): KitBuilt {
  const { W } = fr;
  const d = o.duracion;
  const phone = o.dispositivo === 'telefono';
  const laptop = o.dispositivo === 'portatil';
  const sw = phone ? 560 : laptop ? W - 140 : W - 120;
  const sh = phone ? 1150 : laptop ? Math.round((W - 140) * 0.625) : Math.round((W - 120) * 0.75);
  const bez = phone ? 20 : laptop ? 22 : 0;
  const top = panelTop(fr, o.posicion, sh + bez * 2 + (laptop ? 40 : 0));
  const left = (W - sw - bez * 2) / 2;
  const css = `#dev{position:absolute;left:${n2(left)}px;top:${n2(top)}px;width:${sw + bez * 2}px;height:${sh + bez * 2}px;border-radius:${phone ? 80 : laptop ? 26 : 30}px;background:#0c0c0e;box-shadow:0 40px 90px rgba(0,0,0,.6),inset 0 0 0 3px #2a2a30;transform-origin:50% 50%}
#scr{position:absolute;left:${bez}px;top:${bez}px;width:${sw}px;height:${sh}px;border-radius:${phone ? 62 : laptop ? 8 : 26}px;overflow:hidden;background:#000}
#cnt{position:absolute;left:0;top:0;width:${sw}px;height:${sh}px;transform-origin:0 0}
.med{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover}
${phone ? `#notch{position:absolute;left:50%;top:${bez + 18}px;width:150px;height:40px;margin-left:-75px;border-radius:20px;background:#0c0c0e;z-index:3}` : ''}
${laptop ? `#base{position:absolute;left:-60px;top:${sh + bez * 2}px;width:${sw + bez * 2 + 120}px;height:34px;border-radius:0 0 30px 30px;background:linear-gradient(#cfcfd6,#8d8d96)}` : ''}
#cur{position:absolute;left:0;top:0;width:54px;height:54px;z-index:4;opacity:0;filter:drop-shadow(0 4px 6px rgba(0,0,0,.5))}
#rip{position:absolute;left:0;top:0;width:90px;height:90px;margin:-45px 0 0 -45px;border-radius:50%;border:6px solid var(--a);opacity:0;z-index:3}`;
  const media = o.video
    ? `<video id="mv" class="clip med" src="${esc(o.src)}" data-start="0" data-duration="${n2(d)}" data-media-start="${n2(o.inicioVideo)}" muted playsinline></video>`
    : `<img class="med" src="${esc(o.src)}" />`;
  const body = `<div id="dev">${phone ? '<div id="notch"></div>' : ''}<div id="scr"><div id="cnt">${media}</div><div id="rip"></div>
<svg id="cur" viewBox="0 0 24 24"><path d="M3 2l7 19 2.6-7.6L20 11z" fill="#fff" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/></svg></div>${laptop ? '<div id="base"></div>' : ''}</div>`;
  const fx = (x: number, z: number) => n2(Math.min(0, Math.max(sw - sw * z, sw / 2 - x * sw * z)));
  const fy = (y: number, z: number) => n2(Math.min(0, Math.max(sh - sh * z, sh / 2 - y * sh * z)));
  const steps = o.enfoques
    .sort((a, b) => a.t - b.t)
    .map((e) => {
      const z = Math.max(1, e.zoom);
      const tx = fx(e.x, z);
      const ty = fy(e.y, z);
      // Posición del punto en pantalla tras el zoom
      const px = n2(e.x * sw * z + tx);
      const py = n2(e.y * sh * z + ty);
      return `tl.to('#cnt', { x: ${tx}, y: ${ty}, scale: ${n2(z)}, duration: 0.55, ease: 'power3.inOut' }, ${n2(e.t)});
tl.to('#cur', { opacity: 1, x: ${px}, y: ${py}, duration: 0.5, ease: 'power2.inOut' }, ${n2(e.t + 0.05)});
${e.clic ? `tl.to('#cur', { scale: 0.8, duration: 0.07, yoyo: true, repeat: 1 }, ${n2(e.t + 0.58)});
tl.fromTo('#rip', { x: ${px}, y: ${py}, scale: 0.2, opacity: 1 }, { scale: 1.4, opacity: 0, duration: 0.4, ease: 'power2.out' }, ${n2(e.t + 0.6)});` : ''}`;
    })
    .join('\n');
  const script = `
tl.set('#cur', { x: ${n2(sw * 0.7)}, y: ${n2(sh * 0.8)} }, 0);
tl.fromTo('#dev', { y: 140, opacity: 0, rotationY: ${o.inclinacion}, rotationX: 8, transformPerspective: 1600 }, { y: 0, opacity: 1, rotationY: ${n2(o.inclinacion * 0.4)}, rotationX: 2, transformPerspective: 1600, duration: 0.45, ease: 'power3.out' }, 0);
tl.to('#dev', { rotationY: 0, rotationX: 0, duration: ${n2(Math.max(0.3, d - 0.9))}, ease: 'sine.inOut' }, 0.45);
${steps}
tl.to('#dev', { y: 120, opacity: 0, duration: 0.24, ease: 'power2.in' }, ${n2(d - 0.26)});`;
  return { html: page(fr, d, css, body, script), duracion: d };
}

// ── Portada (43): fotograma + texto grande (detrás de la persona si hay recorte) ──

export function portada(
  fr: KitFrame,
  o: { fondo: string; recorte?: string; texto: string; destacar: string[]; posicion: 'arriba' | 'abajo'; /** Parte de arriba de la persona (0–1), si hay recorte. */ cabeza?: number }
): KitBuilt {
  const { W, H } = fr;
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const hi = new Set(o.destacar.map(norm));
  const words = o.texto.trim().split(/\s+/);
  const chars = o.texto.length;
  const fs = chars <= 14 ? 220 : chars <= 26 ? 170 : chars <= 40 ? 130 : 104;
  const top = o.posicion === 'arriba' ? fr.safe.top + 30 : H * 0.6;
  // Con recorte y texto arriba: el texto termina un poco por debajo de la coronilla (la cabeza lo pisa
  // solo en el borde inferior, el efecto «detrás de la persona» sin tapar las palabras)
  const limit = o.posicion === 'arriba' && o.recorte && o.cabeza ? Math.max(top + 260, o.cabeza * H + 0.045 * H) : o.posicion === 'arriba' ? H * 0.5 : H - fr.safe.bottom - 20;
  const css = `#bgi,#cut{position:absolute;left:0;top:0;width:${W}px;height:${H}px;object-fit:cover}
#vg{position:absolute;inset:0;background:radial-gradient(120% 70% at 50% 40%,transparent 40%,rgba(0,0,0,.55)),linear-gradient(${o.posicion === 'arriba' ? '180deg' : '0deg'},rgba(0,0,0,.6),transparent 45%)}
#tx{position:absolute;left:40px;top:${n2(top)}px;width:${W - 80}px;text-align:center;font-size:${fs}px;line-height:.98;color:#fff}
#tx .h{color:var(--a)}
#cut{filter:drop-shadow(0 0 30px rgba(0,0,0,.45))}`;
  const body = `<img id="bgi" src="${esc(o.fondo)}" /><div id="vg"></div><div id="tx" class="ti stroke">${words.map((w) => `<span${hi.has(norm(w)) ? ' class="h"' : ''}>${esc(w)}</span>`).join(' ')}</div>${o.recorte ? `<img id="cut" src="${esc(o.recorte)}" />` : ''}`;
  // Ajusta el tamaño hasta que el texto quepa entre «top» y «limit» (determinista, antes del timeline)
  const fit = `const tx = document.getElementById('tx'); let f = ${fs}; while (f > 60 && tx.offsetHeight > ${n2(limit - top)}) { f -= 6; tx.style.fontSize = f + 'px'; }`;
  return { html: page({ ...fr }, 0.5, css, body, fit), duracion: 0.5 };
}
