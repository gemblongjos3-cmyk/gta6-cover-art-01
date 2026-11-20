// Shot modes: fixed output sizes and per-layout defaults.
// Used by the screenshot tool through ?shot=...&variant=...

export const SHOT_SIZES = {
  'cover-square': { width: 1024, height: 1024 },
  'cover-tall': { width: 864, height: 1080 },
  'cover-wide': { width: 1280, height: 720 }
};

export const SHOT_IDS = Object.keys(SHOT_SIZES);

export const VARIANTS = {
  A: {
    id: 'A',
    name: 'Triptych + Sunset',
    title: 'VICE COAST',
    subtitle: 'SIX NIGHTS ON THE STRIP',
    photos: 3
  },
  B: {
    id: 'B',
    name: 'Quad Grid + Neon Night',
    title: 'NEON PIER',
    subtitle: 'AFTER MIDNIGHT',
    photos: 4
  },
  C: {
    id: 'C',
    name: 'Hero + Strip + Vice Fade',
    title: 'COAST LINE',
    subtitle: 'THE LONG WAY HOME',
    photos: 3
  }
};

export const VARIANT_IDS = ['A', 'B', 'C'];

export function isVariant(id) {
  return typeof id === 'string' && VARIANT_IDS.includes(id.toUpperCase());
}

export function normaliseVariant(id) {
  return isVariant(id) ? id.toUpperCase() : 'A';
}

// Reads the query string once and returns either null (normal editor page)
// or a fully resolved shot descriptor.
export function readShot(search) {
  const params = new URLSearchParams(search || '');
  const shot = params.get('shot');
  if (!shot || !SHOT_SIZES[shot]) return null;
  const variant = normaliseVariant(params.get('variant'));
  return {
    shot,
    variant,
    width: SHOT_SIZES[shot].width,
    height: SHOT_SIZES[shot].height,
    title: params.get('title') || VARIANTS[variant].title,
    subtitle: params.get('subtitle') || VARIANTS[variant].subtitle
  };
}

// Pixel-accurate geometry for a phone-sized preview strip in the editor.
export function previewAspect(shotId) {
  const s = SHOT_SIZES[shotId] || SHOT_SIZES['cover-square'];
  return s.width / s.height;
}
