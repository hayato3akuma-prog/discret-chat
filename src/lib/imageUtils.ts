import type { ChatAttachment } from '../types';

export const MAX_AVATAR_DATA_URL_LENGTH = 300_000;
export const MAX_BANNER_DATA_URL_LENGTH = 380_000;
export const MAX_CHAT_MEDIA_DATA_URL_LENGTH = 215_000;

function isGifFile(file: File): boolean {
  return (
    file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif')
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Lecture du fichier impossible.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('Format image invalide.'));
    img.onload = () => resolve(img);
    img.src = src;
  });
}

export async function compressSquareAvatar(file: File): Promise<string> {
  const raw = await readFileAsDataUrl(file);
  const img = await loadImageElement(raw);
  const size = 192;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponible.');

  const minSide = Math.min(img.width, img.height);
  const sx = (img.width - minSide) / 2;
  const sy = (img.height - minSide) / 2;
  ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', 0.84);
}

export async function compressBannerImage(file: File): Promise<string> {
  const raw = await readFileAsDataUrl(file);
  const img = await loadImageElement(raw);
  const targetW = 720;
  const targetH = 240;
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponible.');

  const targetRatio = targetW / targetH;
  const imgRatio = img.width / img.height;
  let sx = 0;
  let sy = 0;
  let sw = img.width;
  let sh = img.height;
  if (imgRatio > targetRatio) {
    sw = img.height * targetRatio;
    sx = (img.width - sw) / 2;
  } else {
    sh = img.width / targetRatio;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
  return canvas.toDataURL('image/jpeg', 0.84);
}

/**
 * Preserves animated GIF frames untouched when under Firestore limits;
 * compresses static photos cleanly to JPEG.
 */
export async function prepareAvatarImageOrGif(file: File): Promise<string> {
  if (isGifFile(file)) {
    const dataUrl = await readFileAsDataUrl(file);
    if (!dataUrl.startsWith('data:image/gif')) {
      throw new Error('Fichier GIF invalide.');
    }
    if (dataUrl.length > MAX_AVATAR_DATA_URL_LENGTH) {
      throw new Error(
        'Ce GIF est trop volumineux pour un avatar (max ~220 Ko). Choisissez un GIF plus léger.'
      );
    }
    return dataUrl;
  }
  const compressed = await compressSquareAvatar(file);
  if (compressed.length > MAX_AVATAR_DATA_URL_LENGTH) {
    throw new Error('Image trop volumineuse après compression.');
  }
  return compressed;
}

/**
 * Preserves animated GIF banners untouched when under Firestore limits;
 * crops and compresses static banners cleanly to JPEG.
 */
export async function prepareBannerImageOrGif(file: File): Promise<string> {
  if (isGifFile(file)) {
    const dataUrl = await readFileAsDataUrl(file);
    if (!dataUrl.startsWith('data:image/gif')) {
      throw new Error('Fichier GIF invalide.');
    }
    if (dataUrl.length > MAX_BANNER_DATA_URL_LENGTH) {
      throw new Error(
        'Ce GIF est trop volumineux pour une bannière (max ~280 Ko). Choisissez un GIF plus léger.'
      );
    }
    return dataUrl;
  }
  const compressed = await compressBannerImage(file);
  if (compressed.length > MAX_BANNER_DATA_URL_LENGTH) {
    throw new Error('Bannière trop volumineuse après compression.');
  }
  return compressed;
}

/**
 * Prepares an image or animated GIF for end-to-end encrypted chat transmission.
 * Preserves animated GIFs natively and downscales/compresses static images cleanly.
 */
export async function prepareChatMediaDataUrl(
  file: File
): Promise<ChatAttachment> {
  const safeName = file.name ? file.name.slice(0, 64) : undefined;

  if (isGifFile(file)) {
    const dataUrl = await readFileAsDataUrl(file);
    if (!dataUrl.startsWith('data:image/gif')) {
      throw new Error('Fichier GIF invalide.');
    }
    if (dataUrl.length > MAX_CHAT_MEDIA_DATA_URL_LENGTH) {
      throw new Error(
        'Ce GIF dépasse la taille maximale chiffrée (~155 Ko). Essayez un GIF plus court.'
      );
    }
    return {
      kind: 'image',
      dataUrl,
      mimeType: 'image/gif',
      name: safeName,
    };
  }

  const raw = await readFileAsDataUrl(file);
  const img = await loadImageElement(raw);

  const steps: Array<{ maxSide: number; quality: number }> = [
    { maxSide: 840, quality: 0.82 },
    { maxSide: 680, quality: 0.76 },
    { maxSide: 520, quality: 0.7 },
  ];

  for (const step of steps) {
    const scale = Math.min(1, step.maxSide / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas indisponible.');
    ctx.drawImage(img, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', step.quality);
    if (dataUrl.length <= MAX_CHAT_MEDIA_DATA_URL_LENGTH) {
      return {
        kind: 'image',
        dataUrl,
        mimeType: 'image/jpeg',
        name: safeName,
      };
    }
  }

  throw new Error('Cette image reste trop lourde même après compression.');
}
