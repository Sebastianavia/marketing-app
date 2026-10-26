/**
 * Biblioteca de prompts de Lulo Studio.
 *
 * Prompts propios (redactados para esta app) para crear imágenes y videos UGC con avatares.
 * Los prompts van en inglés porque los modelos de imagen/video responden mejor así;
 * los títulos, notas y explicaciones van en español.
 *
 * Imágenes de ejemplo: coloca tu imagen en `frontend/public/prompt-library/<id>.webp`
 * (o .jpg / .png) con el mismo `id` de la tarjeta y aparecerá sola en el recuadro.
 */

export type PromptKind = 'foto' | 'video' | 'texto';

export interface PromptCard {
  /** Identificador único; también es el nombre del archivo de imagen de ejemplo. */
  id: string;
  title: string;
  kind: PromptKind;
  /** Etiquetas de las imágenes de referencia que pide (vacío = no pide referencia). */
  refs?: string[];
  prompt: string;
  /** Marca la tarjeta como recomendada para empezar. */
  featured?: boolean;
  /** Sin recuadro de imagen (prompts de texto puro: voces, acentos, cámara…). */
  noImage?: boolean;
}

/** Lista de equivalencias español → texto para pegar en el prompt. */
export interface PhraseList {
  title: string;
  items: { es: string; en: string }[];
}

export interface PromptGroup {
  id: string;
  title: string;
  intro?: string;
  /** Subtítulo opcional dentro del grupo (p. ej. "Móvil", "Portátil"). */
  blocks: {
    subtitle?: string;
    intro?: string;
    cards?: PromptCard[];
    lists?: PhraseList[];
    table?: { head: string[]; rows: string[][] };
    note?: string;
  }[];
}

export interface PromptSection {
  letter: 'A' | 'B' | 'C';
  id: string;
  title: string;
  intro: string;
  groups: PromptGroup[];
}

const KEEP_ID = 'Keep the exact same person from the reference — identical face, features and identity.';
const REALISM = 'Photorealistic, true-to-life skin texture, natural light.';

/* -------------------------------------------------------------------------- */
/* A · La imagen                                                              */
/* -------------------------------------------------------------------------- */

const angle = (id: string, title: string, view: string): PromptCard => ({
  id,
  title,
  kind: 'foto',
  refs: ['Referencia'],
  prompt: `${KEEP_ID} Same clothes, same location. ${view} ${REALISM}`,
});

const SECTION_IMAGE: PromptSection = {
  letter: 'A',
  id: 'imagen',
  title: 'La imagen',
  intro:
    'Ediciones sobre una foto de tu avatar. La imagen que sale de aquí es la que luego animas en la parte B.',
  groups: [
    {
      id: 'vestuario-fondo',
      title: 'Ropa y escenario',
      blocks: [
        {
          cards: [
            {
              id: 'ropa-nueva',
              title: 'Ropa nueva',
              kind: 'foto',
              refs: ['Referencia'],
              prompt:
                'Edit only the clothing in this photo. Dress the person in [describe la ropa]. Do not touch the face, hair, body shape, pose, framing, background or lighting. The new garments should drape and wrinkle naturally and match the existing light. ' +
                REALISM,
            },
            {
              id: 'escenario-nuevo',
              title: 'Escenario nuevo',
              kind: 'foto',
              refs: ['Referencia'],
              prompt:
                'Edit only the background of this photo. Put the person in [describe el lugar: una cocina luminosa / una oficina moderna / un estudio gris]. The person, pose, crop and lighting on the person stay untouched. Match perspective, light direction and color temperature so it looks shot on location, with no cut-out edges. ' +
                REALISM,
            },
            {
              id: 'ropa-de-referencia',
              title: 'Ropa copiada de otra foto',
              kind: 'foto',
              refs: ['1 · Persona', '2 · Prenda'],
              prompt:
                'Two inputs: photo 1 shows the person, photo 2 shows an outfit. Output the person from photo 1 wearing the outfit from photo 2 — reproduce its cut, colors, prints, fabric and small details faithfully. Keep the face, hair, body, pose, background and lighting of photo 1. Never borrow the face or body of anyone in photo 2. Natural fit and folds. ' +
                REALISM +
                ' One single image.',
            },
            {
              id: 'escenario-de-referencia',
              title: 'Escenario copiado de otra foto',
              kind: 'foto',
              refs: ['1 · Persona', '2 · Lugar'],
              prompt:
                'Two inputs: photo 1 shows the person, photo 2 shows a location. Output the person from photo 1 — same face, outfit, pose, size and framing — standing in the location from photo 2. Re-light the person to match the light, shadows and color of photo 2 and keep perspective consistent. Do not bring any people or objects over from photo 2 onto the person. ' +
                REALISM +
                ' One single image.',
            },
          ],
        },
      ],
    },
    {
      id: 'aspecto',
      title: 'Cambiar el aspecto (misma persona)',
      blocks: [
        {
          cards: [
            {
              id: 'aspecto-base',
              title: 'Plantilla libre',
              kind: 'foto',
              refs: ['Referencia'],
              featured: true,
              prompt: `${KEEP_ID} Now show them [lo que quieres: un primer plano de la cara / con granos / con otra ropa / en un baño…]. ${REALISM}`,
            },
            {
              id: 'piel-antes',
              title: 'Antes · piel con imperfecciones',
              kind: 'foto',
              refs: ['Referencia'],
              prompt: `${KEEP_ID} Tight close-up of the face showing visible breakouts, redness and uneven texture, wearing a casual sweatshirt, in a home bathroom. No makeup, no beauty filter. ${REALISM}`,
            },
            {
              id: 'piel-despues',
              title: 'Después · piel limpia',
              kind: 'foto',
              refs: ['Referencia'],
              prompt: `${KEEP_ID} Same tight close-up, same sweatshirt, same bathroom, but the skin now looks clear, even and healthy with a soft natural glow. Real pores still visible, no plastic smoothing. ${REALISM}`,
            },
          ],
          note: 'Antes/después: genera las dos versiones desde la MISMA foto de referencia para que la cara coincida.',
        },
      ],
    },
    {
      id: 'avatar',
      title: 'Otra persona',
      blocks: [
        {
          cards: [
            {
              id: 'persona-nueva',
              title: 'Inventar otra persona',
              kind: 'foto',
              refs: ['Referencia'],
              prompt:
                'Keep this exact scene, pose, framing and lighting, but replace the person with a completely new one: [descripción: edad, rasgos, pelo, ropa]. The new person must share no facial features with the original. ' +
                REALISM,
            },
            {
              id: 'persona-intercambio',
              title: 'Poner a la persona de otra foto',
              kind: 'foto',
              refs: ['1 · Escena', '2 · Persona'],
              prompt:
                'Replace the person in photo 1 with the person from photo 2. Use the face, hair and outfit from photo 2; keep the pose, scene, camera angle and lighting from photo 1. ' +
                REALISM,
            },
          ],
        },
      ],
    },
    {
      id: 'angulos',
      title: 'Ángulos del avatar',
      intro:
        'Más ángulos de la misma persona = un anuncio que parece rodado de verdad. Todos conservan la identidad; solo cambia la cámara.',
      blocks: [
        {
          cards: [
            angle('angulo-frente', 'De frente', 'Straight-on front view at eye level, looking right into the lens.'),
            angle('angulo-tres-cuartos', 'Tres cuartos', 'Three-quarter view: head and shoulders rotated about 45° from the camera.'),
            angle('angulo-perfil', 'Perfil', 'Clean side profile, camera at 90° to the face.'),
            angle('angulo-picado', 'Picado', 'Camera slightly above eye level, angled down toward the person.'),
            angle('angulo-contrapicado', 'Contrapicado', 'Camera slightly below eye level, angled up — confident, empowering feel.'),
            angle('angulo-cuerpo-entero', 'Cuerpo entero', 'Full-length shot from head to feet, relaxed natural stance.'),
            angle('angulo-cenital', 'Cenital (dron)', 'Directly overhead bird’s-eye view, the person tilting their face up to the lens. Bold graphic composition.'),
            angle('angulo-suelo', 'Desde el suelo', 'Camera on the floor pointing straight up at the person, towering and dramatic.'),
            angle('angulo-contraluz', 'Contraluz', 'Strong light source behind the person: soft silhouette with a thin bright rim around hair and shoulders, moody and cinematic.'),
            angle('angulo-holandes', 'Plano inclinado', 'Camera rolled a few degrees off level (dutch tilt) for an editorial, energetic look.'),
            angle('angulo-tumbado', 'Tumbado/a', 'The person lying down and relaxed, seen from the side or at three-quarter.'),
            angle('angulo-gran-angular', 'Gran angular', 'Wide establishing shot: the person small in frame, surrounded by the space, strong sense of place.'),
            {
              id: 'angulo-mas-cerca',
              title: 'Acercar el plano',
              kind: 'foto',
              refs: ['Referencia'],
              prompt: 'Same photo, but punch in closer: crop to chest-up, the person mid-sentence talking to camera, teeth slightly visible. Nothing else changes.',
            },
            {
              id: 'angulo-espejo',
              title: 'Voltear en espejo',
              kind: 'foto',
              refs: ['Referencia'],
              prompt: 'Mirror this image left-to-right. Change nothing else.',
            },
          ],
        },
        {
          subtitle: 'Hoja de identidad',
          intro:
            'Una sola imagen con 9 vistas de la cara. Úsala como referencia maestra en el resto de generaciones para que la persona salga siempre igual.',
          cards: [
            {
              id: 'hoja-identidad',
              title: 'Hoja de identidad · 3×3',
              kind: 'foto',
              refs: ['Referencia'],
              featured: true,
              prompt: `Build a 3×3 identity reference sheet of the person in the reference photo. The reference is the only source for who they are.

Every tile must show the identical person: same skull and face shape, eyes, brows, nose, mouth, jaw, ears, hairline and hairstyle, skin tone and marks, age and proportions. Keep any asymmetry or distinctive detail. Do not idealize, retouch or stylize.

Tiles (left to right, top to bottom):
1. front, neutral  2. left profile  3. right profile
4. left three-quarter  5. right three-quarter  6. looking slightly down
7. looking slightly up  8. serious  9. relaxed neutral

Plain light-grey seamless backdrop, identical soft studio light, same lens and distance in every tile. Same hair, clothing and makeup throughout. No added accessories, no filters, no skin smoothing.
It should read like a casting / 3D-scan reference board. Ultra realistic.`,
            },
          ],
        },
      ],
    },
    {
      id: 'producto',
      title: 'Producto',
      intro: 'El avatar con tu producto en la foto. Pide dos imágenes: la persona y el producto.',
      blocks: [
        {
          cards: [
            {
              id: 'producto-en-mano',
              title: 'Con el producto en la mano',
              kind: 'foto',
              refs: ['1 · Persona', '2 · Producto'],
              prompt:
                'Photo 1 is the person, photo 2 is the product. Show the person holding the product up near their face, label turned to the camera, as if recommending it. Copy the product exactly — shape, colors, label text, logo. Keep the person’s face and look unchanged. Natural grip, correct fingers. ' +
                REALISM,
            },
            {
              id: 'producto-senalado',
              title: 'Señalando el producto',
              kind: 'foto',
              refs: ['1 · Persona', '2 · Producto'],
              prompt:
                'Photo 1 is the person, photo 2 is the product. The product sits on a surface next to the person (or in one hand) and the person points at it with the other hand while looking at the camera. Product packaging identical to photo 2. Face unchanged, realistic hands. ' +
                REALISM,
            },
            {
              id: 'producto-usandolo',
              title: 'Usando el producto',
              kind: 'foto',
              refs: ['1 · Persona', '2 · Producto'],
              prompt:
                'Photo 1 is the person, photo 2 is the product. Show the person in the middle of using the product naturally ([cómo se usa: aplicándolo en la cara / bebiéndolo / probándolo]), a candid everyday moment. Product identical to photo 2, face unchanged. ' +
                REALISM,
            },
          ],
        },
      ],
    },
    {
      id: 'pantallas',
      title: 'App, web o software en pantalla',
      intro:
        'Dos pasos: primero la persona con el dispositivo y la pantalla apagada (negra); después metes tu captura dentro. Así la captura respeta la perspectiva.',
      blocks: [
        {
          subtitle: 'Móvil',
          cards: [
            {
              id: 'movil-negro',
              title: 'Paso 1 · móvil con pantalla negra',
              kind: 'foto',
              refs: ['Referencia'],
              prompt: `${KEEP_ID} Same outfit, background and light.

Only change: the person now holds a modern smartphone at chest height with the screen facing the camera. The screen is switched off — a flat, pure black rectangle with no reflections, no interface, no logos and no text.

One hand, relaxed natural grip, correct number of fingers. ${REALISM} One single image.`,
            },
            {
              id: 'movil-captura',
              title: 'Paso 2 · meter la captura',
              kind: 'foto',
              refs: ['1 · Persona + móvil', '2 · Captura'],
              prompt: `Photo 1: a person holding a phone with a black screen. Photo 2: a screenshot.

Leave photo 1 completely unchanged — person, hands, phone, pose, background, light.
Only place the screenshot from photo 2 onto the phone’s black screen. Fit it to the screen’s exact outline, following its tilt and perspective, with rounded corners, believable brightness and a faint glare. Keep the screenshot’s proportions — no stretching, no cropping. It must look genuinely displayed on the phone.

${REALISM} One single image.`,
            },
          ],
        },
        {
          subtitle: 'Portátil',
          cards: [
            {
              id: 'portatil-negro',
              title: 'Paso 1 · portátil con pantalla negra',
              kind: 'foto',
              refs: ['Referencia'],
              prompt: `${KEEP_ID} Same outfit, background and light.

Only change: the person has an open laptop and angles it so the screen faces the camera. The screen is off — a flat, pure black rectangle with no reflections, interface, logos or text.

Realistic hands, correct number of fingers. ${REALISM} One single image.`,
            },
            {
              id: 'portatil-captura',
              title: 'Paso 2 · meter la captura',
              kind: 'foto',
              refs: ['1 · Persona + portátil', '2 · Captura'],
              prompt: `Photo 1: a person with a laptop whose screen is black. Photo 2: a screenshot of an app or website.

Leave photo 1 completely unchanged.
Only place the screenshot from photo 2 onto the laptop’s black screen, matched to its outline, angle and perspective, with believable brightness and a light glare. Keep the screenshot’s proportions — no stretching, no cropping.

${REALISM} One single image.`,
            },
          ],
        },
      ],
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* B · El video                                                               */
/* -------------------------------------------------------------------------- */

const ONE_TAKE = 'One continuous shot, no cuts, no scene change.';

const cam = (id: string, title: string, text: string, featured = false): PromptCard => ({
  id,
  title,
  kind: 'texto',
  noImage: true,
  featured,
  prompt: `${text} ${ONE_TAKE}`,
});

const voice = (id: string, title: string, text: string): PromptCard => ({
  id,
  title,
  kind: 'texto',
  noImage: true,
  prompt: `Voice: ${text}`,
});

const SECTION_VIDEO: PromptSection = {
  letter: 'B',
  id: 'video',
  title: 'El video',
  intro: 'Las piezas para animar la imagen que ya creaste y ponerle voz.',
  groups: [
    {
      id: 'estructura',
      title: 'Cómo se arma el prompt',
      intro: 'Une estas piezas en este orden. La acción es opcional.',
      blocks: [
        {
          table: {
            head: ['#', 'Pieza', 'Ejemplo'],
            rows: [
              ['1', 'Cámara', 'Camera locked in place, natural hand gestures and small body movements.'],
              ['2', 'Acción (opcional)', 'She lifts the bottle into frame,'],
              ['3', 'Guion', 'and says: "Te juro que esto me cambió la rutina."'],
              ['4', 'Voz', 'Voice: a warm, clear female voice in her late 20s…'],
              ['5', 'Acento', 'Spoken in Spanish with a Bogotá (Colombia) accent…'],
            ],
          },
        },
      ],
    },
    {
      id: 'camara',
      title: 'Movimientos de cámara',
      intro:
        'Todos terminan con la orden de toma única para que el modelo no meta cortes. Zoom in = acercar · pull-back = alejar · orbit = girar alrededor · tracking = acompañar · handheld = cámara en mano.',
      blocks: [
        {
          subtitle: 'Básicos',
          cards: [
            cam('cam-quieta-gestos', 'Cámara quieta + gestos', 'Camera locked in place, natural hand gestures and small body movements.', true),
            cam('cam-tripode', 'Trípode total', 'Camera fixed on a tripod, absolutely no camera motion.'),
            cam('cam-zoom-lento', 'Acercamiento lento a la cara', 'From the first frame the camera slowly pushes in toward the face, then stays on the close-up until the end.'),
            cam('cam-zoom-rapido', 'Zoom rápido al empezar a hablar', 'Quick punch-in to a close-up of the face right as the person starts talking, then the frame holds still.'),
            cam('cam-mano', 'Cámara en mano sutil', 'Light handheld feel, tiny natural sway, never distracting.'),
          ],
        },
        {
          subtitle: 'Para variar',
          cards: [
            cam('cam-podcast', 'Acercamiento casi invisible', 'Very slow, barely noticeable push from medium shot to medium close-up across the whole clip.'),
            cam('cam-revelar', 'Alejarse para revelar', 'Starts on a close-up and slowly pulls back to reveal the room as the person begins speaking, then holds wide.'),
            cam('cam-orbita', 'Órbita lenta', 'Camera glides in a slow half-circle around the person, keeping them centered.'),
            cam('cam-caminar', 'Acompañar al caminar', 'Camera travels beside the person as they walk and talk, smooth and stable.'),
          ],
        },
        {
          subtitle: 'Avanzados',
          cards: [
            cam('cam-ojos', 'Hasta los ojos', 'Slow creeping push-in that ends on an extreme close-up of the eyes exactly on the key line, then holds.'),
            cam('cam-heroe', 'Contrapicado heroico', 'Low camera looking up at the person with a slow push-in, powerful and confident, then holds.'),
            cam('cam-bokeh', 'Fondo desenfocado', 'Shallow depth of field, soft creamy background blur, gentle push-in on the sharp subject, then holds.'),
            cam('cam-lenta', 'Cámara lenta', 'Slow-motion, smooth and cinematic, with a slight camera drift.'),
          ],
          note: '¿Escribes tu propio movimiento? Termínalo con: "One continuous shot, no cuts, no scene change — after the move the frame holds steady."',
        },
      ],
    },
    {
      id: 'gestos',
      title: 'Gestos (micro-acciones)',
      intro:
        'Un gesto natural le da realismo. No es lo que dice (eso es el guion). Regla: el gesto de ANTES de hablar va antes de "says:"; el de mientras o después, va detrás del guion.',
      blocks: [
        {
          cards: [
            {
              id: 'gesto-antes',
              title: 'Gesto antes de hablar',
              kind: 'video',
              refs: ['Referencia'],
              prompt: 'The person [gesto], then turns to the camera and says: "[guion]"',
            },
            {
              id: 'gesto-despues',
              title: 'Gesto mientras o después',
              kind: 'video',
              refs: ['Referencia'],
              prompt: 'The person says: "[guion]" [gesto]',
            },
          ],
          lists: [
            {
              title: 'Gestos para pegar en [gesto]',
              items: [
                { es: 'se acomoda la gorra', en: 'adjusts their cap' },
                { es: 'toma un sorbo de café y deja la taza', en: 'sips their coffee and puts the cup down' },
                { es: 'se acomoda el pelo', en: 'smooths their hair' },
                { es: 'saluda con la mano', en: 'gives a little wave' },
                { es: 'se ríe', en: 'laughs' },
                { es: 'pone cara de sorpresa', en: 'with a surprised expression' },
                { es: 'asiente despacio sonriendo', en: 'nods slowly with a smile' },
                { es: 'señala hacia arriba', en: 'points upward' },
                { es: 'señala a su izquierda', en: 'points to their left' },
                { es: 'señala a su derecha', en: 'points to their right' },
                { es: 'cruza los brazos', en: 'folds their arms' },
                { es: 'se encoge de hombros', en: 'shrugs' },
                { es: 'pulgar arriba', en: 'gives a thumbs-up' },
                { es: 'da una palmada', en: 'claps once' },
                { es: 'ladea la cabeza con curiosidad', en: 'tilts their head, curious' },
                { es: 'se acomoda las gafas', en: 'pushes up their glasses' },
                { es: 'se pone el pelo detrás de la oreja', en: 'tucks their hair behind one ear' },
                { es: 'se toca la barbilla pensando', en: 'rubs their chin, thinking' },
                { es: 'chasquea los dedos', en: 'snaps their fingers' },
                { es: 'levanta una ceja', en: 'raises one eyebrow' },
                { es: 'se tapa la boca riéndose', en: 'covers their mouth while laughing' },
                { es: 'cuenta con los dedos', en: 'counts on their fingers' },
              ],
            },
          ],
          note: 'Combina las dos: The person adjusts their cap, then says: "[guion]" and smiles.',
        },
      ],
    },
    {
      id: 'voz',
      title: 'La voz',
      intro: 'Usa exactamente la misma línea "Voice:" en todos los clips del mismo personaje.',
      blocks: [
        {
          cards: [
            voice('voz-hombre-50', 'Hombre · ~50 años', 'a deep, warm man in his early 50s, low and slightly husky, unhurried, steady and trustworthy.'),
            voice('voz-hombre-35', 'Hombre · ~35 años', 'a man in his mid-30s, mid-range and full, calm and sure of himself, friendly but grounded.'),
            voice('voz-hombre-28', 'Hombre · 25-30 años', 'an upbeat man in his late 20s, mid-high pitch, clear and easygoing, relaxed conversational pace.'),
            voice('voz-hombre-22', 'Hombre · ~22 años', 'a young man in his early 20s, bright and light, quick and energetic, very casual.'),
            voice('voz-mujer-50', 'Mujer · ~50 años', 'a warm woman in her early 50s, rich lower-mid tone with a hint of smokiness, measured and reassuring.'),
            voice('voz-mujer-35', 'Mujer · ~35 años', 'a woman in her mid-30s, mid-range and settled, calm and confident, warm.'),
            voice('voz-mujer-28', 'Mujer · 25-30 años', 'a lively woman in her late 20s, bright and clear, higher pitch, friendly, natural pace.'),
            voice('voz-mujer-22', 'Mujer · ~22 años', 'a young woman in her early 20s, light and airy, fairly high pitch, playful and relaxed.'),
          ],
          note: 'Inventa cualquier voz combinando: género + edad (in her 20s / his 40s…) + tono (deep, low / bright, high) + textura (husky, raspy / smooth / breathy) + forma de hablar (slow and calm / fast and excited / warm / authoritative).',
        },
      ],
    },
    {
      id: 'acentos',
      title: 'Idioma y acento',
      intro: 'Añade una de estas líneas al final de cualquier prompt con voz.',
      blocks: [
        {
          cards: [
            { id: 'acento-bogota', title: 'Colombia · Bogotá', kind: 'texto', noImage: true, featured: true, prompt: 'Spoken in Spanish with a clear, neutral Bogotá (Colombia) accent, natural and conversational.' },
            { id: 'acento-paisa', title: 'Colombia · paisa (Medellín)', kind: 'texto', noImage: true, prompt: 'Spoken in Spanish with a warm paisa accent from Medellín, Colombia, friendly and sing-song.' },
            { id: 'acento-mexico', title: 'México · CDMX', kind: 'texto', noImage: true, prompt: 'Spoken in Spanish with a Mexico City accent, casual and natural.' },
            { id: 'acento-argentina', title: 'Argentina · Buenos Aires', kind: 'texto', noImage: true, prompt: 'Spoken in Rioplatense Spanish from Buenos Aires, with the typical "sh" sound for "ll" and "y" and voseo.' },
            { id: 'acento-espana', title: 'España · Madrid', kind: 'texto', noImage: true, prompt: 'Spoken in Spanish with a neutral Madrid (Spain) accent, informal, like chatting with a friend.' },
            { id: 'acento-latam', title: 'Latino neutro', kind: 'texto', noImage: true, prompt: 'Spoken in neutral Latin American Spanish, clear and easy to understand.' },
          ],
        },
      ],
    },
    {
      id: 'acciones',
      title: 'Acciones especiales · moda y skincare',
      intro: 'Clips de acción a partir de una imagen ya creada. "no talking" = sin hablar; déjalo en inglés.',
      blocks: [
        {
          subtitle: 'Moda',
          cards: [
            {
              id: 'moda-look-completo',
              title: 'Look completo',
              kind: 'video',
              refs: ['Referencia'],
              prompt: `${KEEP_ID} Same location and light — do not change the setting. Head-to-toe shot showing the whole outfit, the person turning a little to each side. No talking, mouth closed. Cinematic light. ${ONE_TAKE}`,
            },
            {
              id: 'moda-tela',
              title: 'Detalle de tela',
              kind: 'video',
              refs: ['Referencia'],
              prompt: `${KEEP_ID} Same location and light. Macro close-up gliding over the fabric — weave, stitching and print in crisp focus. No talking, mouth closed. ${ONE_TAKE}`,
            },
            {
              id: 'moda-giro',
              title: 'Vuelta completa',
              kind: 'video',
              refs: ['Referencia'],
              prompt: `${KEEP_ID} Same location and light. The person slowly turns a full 360° on the spot so the outfit is seen from every side, smooth and steady. No talking, mouth closed. ${ONE_TAKE}`,
            },
            {
              id: 'moda-pasarela',
              title: 'Caminando tipo pasarela',
              kind: 'video',
              refs: ['Referencia'],
              prompt: `${KEEP_ID} Same location and light. The person walks toward the camera with confident runway energy, the clothes moving naturally. No talking, mouth closed. ${ONE_TAKE}`,
            },
            {
              id: 'moda-editorial',
              title: 'Pose editorial',
              kind: 'video',
              refs: ['Referencia'],
              prompt: `${KEEP_ID} Same location and light. The person shifts slowly between two or three relaxed lookbook poses. No talking, mouth closed. Cinematic light. ${ONE_TAKE}`,
            },
            {
              id: 'moda-accesorio',
              title: 'Detalle de accesorio',
              kind: 'video',
              refs: ['Referencia'],
              prompt: `${KEEP_ID} Same location and light. Close-up on [zapatos / bolso / joyas], sharp detail, slight movement. No talking, mouth closed. ${ONE_TAKE}`,
            },
          ],
        },
        {
          subtitle: 'Skincare',
          intro:
            'Ojo: a la IA le cuestan más estas acciones. Para abrir una tapa abatible, pásale una foto de referencia de la tapa abierta: sin ella suele arrancar la tapa entera.',
          cards: [
            {
              id: 'skincare-tapa',
              title: 'Tapa abierta, lista para aplicar',
              kind: 'foto',
              refs: ['1 · Persona + producto', '2 · Tapa abierta'],
              prompt: `Photo 1: the person holding the product bottle. Photo 2: an open flip-top cap — use it ONLY to understand how the cap opens.

Keep the person, the bottle (label, colors and text untouched), the room and the light from photo 1.
Only change: the flip-top lid is now open on its hinge, tilted back and still attached, the nozzle visible — like photo 2. Do NOT remove the cap. The other hand is raised next to the bottle, palm up and slightly cupped, ready to receive a drop of product.

Realistic hands, correct number of fingers. ${REALISM} One single image.`,
            },
            {
              id: 'skincare-extender',
              title: 'Extender la crema',
              kind: 'video',
              refs: ['Referencia'],
              prompt:
                'While talking, she spreads the visible cream over her [zona] until it fully sinks into the skin. The amount of visible cream keeps shrinking through the clip and ends with no white residue, streaks or clumps.',
            },
            {
              id: 'skincare-masaje',
              title: 'Masaje en la cara',
              kind: 'video',
              refs: ['Referencia'],
              prompt: `${KEEP_ID} Same location and light. She massages the product into her face with soft upward circles; the visible product steadily disappears until fully absorbed, leaving no residue. No talking, mouth closed. ${ONE_TAKE}`,
            },
          ],
          lists: [
            {
              title: 'Zonas para pegar en [zona]',
              items: [
                { es: 'contorno de ojos', en: 'under-eye area' },
                { es: 'mejillas', en: 'cheeks' },
                { es: 'frente', en: 'forehead' },
                { es: 'cuello', en: 'neck' },
                { es: 'manos', en: 'the back of her hands' },
                { es: 'labios', en: 'lips' },
              ],
            },
          ],
        },
      ],
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* C · Los formatos                                                           */
/* -------------------------------------------------------------------------- */

const SECTION_FORMATS: PromptSection = {
  letter: 'C',
  id: 'formatos',
  title: 'Los formatos',
  intro: 'El anuncio armado: combina piezas de A (imagen) y B (video) y añade voz y acento.',
  groups: [
    {
      id: 'ugc',
      title: 'UGC · una persona a cámara',
      blocks: [
        {
          subtitle: 'Hablando a cámara',
          cards: [
            {
              id: 'ugc-quieta',
              title: 'Cámara quieta',
              kind: 'video',
              refs: ['Referencia'],
              prompt: 'Camera locked in place. The person looks straight into the lens, natural arm movements, relaxed creator energy, and says: "[guion]"',
            },
            {
              id: 'ugc-gestos',
              title: 'Con gestos naturales',
              kind: 'video',
              refs: ['Referencia'],
              prompt: 'Natural hand gestures and small head movements, the person talks directly to the viewer with honest, upbeat energy and says exactly: "[guion]"',
            },
          ],
          note: 'Después añade la voz y el acento de la parte B y, si quieres, un gesto. Para tener el producto en la mano en la foto, ve a A · Producto.',
        },
        {
          subtitle: 'Mostrar el producto en el video',
          cards: [
            {
              id: 'ugc-producto-mano',
              title: 'Lo sostiene y lo muestra',
              kind: 'video',
              refs: ['Referencia'],
              prompt: `Using the product from the reference, the person holds it in one hand and presents it to the camera while talking, natural gestures, eye contact with the lens. The label stays readable and unchanged. ${ONE_TAKE}`,
            },
            {
              id: 'ugc-producto-senala',
              title: 'Lo señala y lo mira',
              kind: 'video',
              refs: ['Referencia'],
              prompt: `Using the product from the reference, the person talks to camera, points at the product and glances down at it once or twice before looking back at the lens. Label readable and unchanged. ${ONE_TAKE}`,
            },
            {
              id: 'ugc-producto-solo',
              title: 'Producto solo (toma de apoyo)',
              kind: 'video',
              refs: ['Producto'],
              prompt: `Using the product from the reference, a clean hero shot of the product on [superficie: mármol / madera / fondo neutro], slow gentle camera glide, soft natural light, product sharp with the label readable and unchanged. No people. ${ONE_TAKE}`,
            },
          ],
        },
        {
          subtitle: 'Ejemplo completo',
          cards: [
            {
              id: 'ugc-completo',
              title: 'UGC listo para copiar',
              kind: 'video',
              refs: ['Referencia'],
              featured: true,
              prompt: `The person looks into the lens with natural gestures and a friendly, honest creator tone. From the first frame the camera slowly pushes in toward the face and then holds the close-up. ${ONE_TAKE} They say: "[tu guion]"
Voice: a lively woman in her late 20s, bright and clear, friendly, natural pace.
Spoken in Spanish with a clear, neutral Bogotá (Colombia) accent, natural and conversational.`,
            },
          ],
        },
      ],
    },
    {
      id: 'podcast',
      title: 'Podcast · dos personas',
      intro:
        'Genera cada persona por separado (cámara quieta, solo habla ella, su voz) y únelas en el editor cortando de una a otra como un podcast real.',
      blocks: [
        {
          cards: [
            { id: 'podcast-mirada', title: 'Mira a la otra persona', kind: 'texto', noImage: true, prompt: 'The person is looking toward the [right / left] edge of the frame, as if talking to a guest seated beside them.' },
            {
              id: 'podcast-hablando',
              title: 'Hablando, cámara quieta',
              kind: 'video',
              refs: ['Referencia'],
              prompt: 'Camera locked in place. The person speaks naturally with small body movements and relaxed hand gestures, real conversation energy. They say: "[guion]"',
            },
            { id: 'podcast-un-hablante', title: 'Que hable solo una persona', kind: 'texto', noImage: true, prompt: 'Only one speaker: the person from the reference image is the only one talking.' },
            {
              id: 'podcast-invitado',
              title: 'Segundo invitado (lado opuesto)',
              kind: 'foto',
              refs: ['Referencia'],
              prompt: `Use this image only as a guide for the room and style. Recreate the same podcast set — same kind of sofa, the same boom microphone on its arm, the same warm living-room mood and similar backdrop — but filmed from the opposite seat, facing the second guest.

It doesn’t need to be an identical copy: plants, cushions and small props can vary, as long as it clearly feels like the same room. Do NOT mirror the reference.

From this side the microphone enters from the LEFT of the frame and the person faces left/center toward the host.
Place a completely different person here — new face, hair, body and outfit, nothing shared with the original: [descripción, p. ej. a man in his 30s, everyday look].

${REALISM} One single image.`,
            },
          ],
          note: 'Truco: para el segundo invitado puedes voltear la imagen en espejo (A · Ángulos), pero el fondo saldrá calcado. El prompt de "segundo invitado" lo evita.',
        },
      ],
    },
    {
      id: 'dualcast',
      title: 'Dualcast · dos personas en el mismo plano',
      intro: 'Parte de una imagen con las dos personas. Una habla y la otra escucha y reacciona. Pega tu guion en [guion].',
      blocks: [
        {
          cards: [
            {
              id: 'dualcast-izquierda',
              title: 'Habla la de la izquierda',
              kind: 'video',
              refs: ['Imagen con las dos'],
              prompt: `The person on the LEFT is talking in a relaxed, natural conversation and says: "[guion]"
[gesto] (opcional)
The person on the RIGHT only listens — looks at them, nods now and then, small genuine reactions, never interrupts. Casual and believable.`,
            },
            {
              id: 'dualcast-derecha',
              title: 'Habla la de la derecha',
              kind: 'video',
              refs: ['Imagen con las dos'],
              prompt: `The person on the RIGHT is talking in a relaxed, natural conversation and says: "[guion]"
[gesto] (opcional)
The person on the LEFT only listens — looks at them, nods now and then, small genuine reactions, never interrupts. Casual and believable.`,
            },
          ],
        },
      ],
    },
    {
      id: 'trends',
      title: 'Trends virales',
      intro: 'Clips cortos sin hablar a cámara para meter tu marca de forma nativa.',
      blocks: [
        {
          cards: [
            {
              id: 'trend-pov',
              title: 'POV',
              kind: 'video',
              refs: ['Referencia'],
              prompt: `${KEEP_ID} Vertical 9:16. The person looks into the lens with a knowing, slightly amused expression, then gives a small shrug and smile — a classic "POV" reaction clip, leaving empty space at the top for on-screen text. No talking, mouth closed. ${ONE_TAKE}`,
            },
            {
              id: 'trend-transicion',
              title: 'Transición antes / después',
              kind: 'video',
              refs: ['Referencia'],
              prompt: `${KEEP_ID} Vertical 9:16. The person covers the lens with their palm, and when the hand moves away they appear in [el "después": otro look / piel limpia / pelo arreglado], same spot. Snappy, satisfying. No talking. ${ONE_TAKE}`,
            },
            {
              id: 'trend-reaccion',
              title: 'Reacción al probarlo',
              kind: 'video',
              refs: ['1 · Persona', '2 · Producto'],
              prompt: `Using the person and the product from the references, the person tries the product for the first time and reacts with genuine, slightly exaggerated surprise, then looks at the camera and nods. No talking. ${ONE_TAKE}`,
            },
          ],
        },
      ],
    },
    {
      id: 'voz-en-off',
      title: 'Voz en off (sin hablar a cámara)',
      intro:
        'Imágenes o clips donde nadie habla (b-roll). Luego pones tu narración encima en el editor. La clave en video: "no talking".',
      blocks: [
        {
          subtitle: 'Imagen · plantilla',
          cards: [
            {
              id: 'off-plantilla-foto',
              title: 'Plantilla imagen sin hablar',
              kind: 'foto',
              refs: ['Referencia'],
              featured: true,
              prompt: `${KEEP_ID} She [acción]. [lugar + luz]. [plano]. Photorealistic, natural skin texture with visible pores. No text, no watermark, no distortion.`,
            },
          ],
          note: 'Rellena los tres huecos con las piezas de abajo: una acción + un lugar con luz + un plano.',
          lists: [
            {
              title: 'Acciones · casa y rutina',
              items: [
                { es: 'recién despertada frente al espejo', en: 'checks herself in the bathroom mirror right after waking up, messy hair, sleepy face' },
                { es: 'estirándose en la cama', en: 'stretches in bed after waking, soft morning light' },
                { es: 'con un café en las manos', en: 'holds a warm mug with both hands, gazing out the window' },
                { es: 'desayunando', en: 'eats breakfast at the kitchen table, candid moment' },
                { es: 'arreglándose', en: 'gets ready in front of the mirror' },
                { es: 'lavándose la cara', en: 'splashes water on her face at the sink' },
                { es: 'en el sofá con manta', en: 'curled up on the sofa under a blanket' },
                { es: 'cocinando', en: 'chops vegetables at the kitchen counter' },
                { es: 'leyendo', en: 'reads a book on the couch' },
                { es: 'trabajando en el portátil', en: 'works on a laptop at a desk, focused' },
              ],
            },
            {
              title: 'Acciones · belleza',
              items: [
                { es: 'frustrada con el pelo', en: 'runs her fingers through frizzy hair, frustrated' },
                { es: 'definiendo rizos', en: 'scrunches her curls with both hands' },
                { es: 'aplicando crema', en: 'applies face cream in small circles' },
                { es: 'mirándose la piel de cerca', en: 'leans into the mirror, inspecting her skin' },
                { es: 'maquillándose', en: 'applies makeup with a brush' },
                { es: 'secándose el pelo', en: 'blow-dries her hair, hair in motion' },
                { es: 'echándose perfume', en: 'sprays perfume on her neck' },
              ],
            },
            {
              title: 'Acciones · calle y estilo de vida',
              items: [
                { es: 'caminando por la ciudad', en: 'walks down a city street, natural stride' },
                { es: 'mirando el celular al caminar', en: 'walks while looking at her phone' },
                { es: 'en una terraza', en: 'sits at a café terrace with a drink' },
                { es: 'de compras', en: 'browses clothes on a store rack' },
                { es: 'en el parque', en: 'sits on the grass in a park' },
                { es: 'con bolsas de compras', en: 'walks carrying shopping bags, smiling' },
                { es: 'tomando una foto', en: 'takes a photo with her phone' },
                { es: 'riéndose de algo fuera de cámara', en: 'laughs at something off-camera' },
              ],
            },
            {
              title: 'Acciones · producto',
              items: [
                { es: 'sosteniendo el producto', en: 'holds the product up toward the camera' },
                { es: 'abriendo un paquete', en: 'unboxes a package, excited' },
                { es: 'leyendo la etiqueta', en: 'reads the product label closely' },
                { es: 'comparando dos productos', en: 'holds one product in each hand, comparing' },
                { es: 'mostrando el resultado', en: 'shows off the result, happy and confident' },
              ],
            },
            {
              title: 'Acciones · fitness y emociones',
              items: [
                { es: 'estirando antes de entrenar', en: 'stretches before a workout in sportswear' },
                { es: 'tomando agua después de entrenar', en: 'drinks from a water bottle after exercising' },
                { es: 'haciendo yoga', en: 'holds a yoga pose on a mat' },
                { es: 'sorprendida', en: 'with wide-eyed surprise' },
                { es: 'pensativa', en: 'thoughtful, hand on her chin' },
                { es: 'sonrisa natural', en: 'with a genuine relaxed smile' },
                { es: 'seria y decidida', en: 'serious and determined, looking at the camera' },
                { es: 'cansada', en: 'looking tired, heavy eyelids' },
              ],
            },
            {
              title: 'Lugar + luz',
              items: [
                { es: 'baño por la mañana', en: 'in a bright bathroom, soft morning window light' },
                { es: 'habitación acogedora', en: 'in a cozy bedroom, warm lamp light' },
                { es: 'junto a la ventana', en: 'by a window, soft overcast daylight' },
                { es: 'cocina luminosa', en: 'in a bright modern kitchen, daylight' },
                { es: 'calle de ciudad', en: 'on a city street, daylight, urban background' },
                { es: 'terraza al atardecer', en: 'on an outdoor terrace, golden afternoon sun' },
                { es: 'sala por la tarde', en: 'in a living room, warm afternoon light' },
                { es: 'tienda o probador', en: 'in a clothing store, bright indoor light' },
                { es: 'parque', en: 'in a park, greenery, soft natural light' },
                { es: 'de noche con flash', en: 'at night, harsh direct phone flash, high contrast' },
              ],
            },
            {
              title: 'Plano',
              items: [
                { es: 'de frente', en: 'front-facing shot' },
                { es: 'tres cuartos', en: 'three-quarter view' },
                { es: 'perfil', en: 'side profile' },
                { es: 'primer plano', en: 'close-up on the face' },
                { es: 'plano medio', en: 'medium shot, waist up' },
                { es: 'cuerpo entero', en: 'full-body shot' },
                { es: 'desde arriba', en: 'slightly high angle, looking down' },
                { es: 'desde abajo', en: 'slightly low angle, looking up' },
                { es: 'de espaldas', en: 'seen from behind' },
                { es: 'reflejo en el espejo', en: 'her reflection in a mirror' },
              ],
            },
          ],
        },
        {
          subtitle: 'Video · plantilla',
          cards: [
            {
              id: 'off-plantilla-video',
              title: 'Plantilla video sin diálogo',
              kind: 'video',
              refs: ['Referencia'],
              featured: true,
              prompt: '[movimiento de cámara], cinematic, no talking. Same person as the reference. She [acción]. [lugar + luz]. No text, no watermark.',
            },
          ],
          lists: [
            {
              title: 'Movimiento de cámara',
              items: [
                { es: 'quieta', en: 'Camera fixed, no movement' },
                { es: 'acercamiento lento', en: 'Slow subtle push-in' },
                { es: 'zoom a la cara', en: 'Slow continuous zoom toward her face' },
                { es: 'en mano', en: 'Subtle handheld movement' },
                { es: 'alejarse', en: 'Slow pull-back revealing the space' },
                { es: 'órbita', en: 'Slow orbit around her' },
                { es: 'acompañando al caminar', en: 'Camera tracks beside her as she walks' },
                { es: 'cámara lenta', en: 'Slow-motion, cinematic' },
                { es: 'a los ojos', en: 'Slow push-in to an extreme close-up of the eyes' },
                { es: 'contrapicado', en: 'Low-angle hero shot looking up' },
              ],
            },
          ],
        },
        {
          subtitle: 'Ejemplos listos',
          cards: [
            {
              id: 'off-despertar',
              title: 'Recién despertada · frizz',
              kind: 'video',
              refs: ['Referencia'],
              prompt: 'Slow subtle push-in, cinematic, no talking. Same person as the reference. She checks herself in the bathroom mirror right after waking up, frizzy messy curls, one hand on her cheek, sleepy look. Soft morning window light, shallow depth of field. No text, no watermark.',
            },
            {
              id: 'off-calle',
              title: 'Caminando por la calle',
              kind: 'video',
              refs: ['Referencia'],
              prompt: 'Camera tracks beside her as she walks, cinematic, no talking. Same person. She walks down a city street with an easy stride, hair moving in the breeze. Daylight, urban background. No text, no watermark.',
            },
            {
              id: 'off-crema',
              title: 'Aplicando crema',
              kind: 'video',
              refs: ['Referencia'],
              prompt: 'Camera fixed, close-up, cinematic, no talking. Same person. She blends cream into her cheeks in small circles until it disappears into the skin. Bright bathroom, soft light. No text, no watermark.',
            },
            {
              id: 'off-cafe',
              title: 'Café junto a la ventana',
              kind: 'video',
              refs: ['Referencia'],
              prompt: 'Slow orbit around her, cinematic, no talking. Same person. She holds a warm mug with both hands, gazing out the window, calm. Warm morning light. No text, no watermark.',
            },
            {
              id: 'off-pelo',
              title: 'Resultado en el pelo',
              kind: 'video',
              refs: ['Referencia'],
              prompt: 'Slow-motion, cinematic, no talking. Same person. She tosses her healthy, defined curls, turning from profile to back view as the hair catches the light. Soft natural light. No text, no watermark.',
            },
            {
              id: 'off-producto',
              title: 'Producto solo',
              kind: 'video',
              refs: ['Producto'],
              prompt: 'Slow gentle glide, cinematic, no talking. Clean hero shot of the product on a surface, soft natural light, product sharp, label readable and unchanged. No people. No text, no watermark.',
            },
          ],
        },
      ],
    },
    {
      id: 'animados',
      title: 'Animados',
      intro: 'Tu avatar convertido en personaje animado para variar el formato.',
      blocks: [
        {
          cards: [
            {
              id: 'animado-3d',
              title: 'Personaje 3D',
              kind: 'foto',
              refs: ['Referencia'],
              prompt: 'Turn the person in the reference into a stylized 3D animated character — soft rounded shapes, big expressive eyes, polished studio-animation rendering — while keeping their recognizable hairstyle, skin tone, outfit and overall vibe. Same pose and setting, rendered in the same 3D style. One single image.',
            },
            {
              id: 'animado-2d',
              title: 'Ilustración 2D',
              kind: 'foto',
              refs: ['Referencia'],
              prompt: 'Redraw the reference as a clean flat 2D illustration: bold simple shapes, limited warm palette, subtle grain texture. Keep the person recognizable (hair, outfit, colors) and the same composition. No text. One single image.',
            },
            {
              id: 'animado-video',
              title: 'Animar el personaje',
              kind: 'video',
              refs: ['Personaje animado'],
              prompt: `Keep the animation style of the reference exactly. The character talks to the camera with lively, bouncy cartoon expressions and hand gestures and says: "[guion]" ${ONE_TAKE}`,
            },
          ],
        },
      ],
    },
  ],
};

export const PROMPT_LIBRARY: PromptSection[] = [SECTION_IMAGE, SECTION_VIDEO, SECTION_FORMATS];

/** Extensiones que se prueban, en orden, para la imagen de ejemplo de cada tarjeta. */
export const PROMPT_IMAGE_EXTENSIONS = ['webp', 'jpg', 'png'] as const;
export const PROMPT_IMAGE_DIR = '/prompt-library';
