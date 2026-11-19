/**
 * Client-side image compression and base64 DataURL serialization helpers for
 * POD photos, DVIR defect photos, and offline IndexedDB storage queues.
 */

export function blobToDataUrl(blob) {
  if (!blob) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => reject(reader.error || new Error('Failed to encode image blob'));
    reader.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl) return null;
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!match) return null;
  const mime = match[1];
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

export async function compressImageFile(file, { maxDimension = 1600, quality = 0.78 } = {}) {
  if (
    !file ||
    !String(file.type || '').startsWith('image/') ||
    file.type === 'image/svg+xml' ||
    file.type === 'image/gif' ||
    typeof document === 'undefined'
  ) {
    return file;
  }

  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      try {
        const naturalWidth = img.naturalWidth || img.width || 0;
        const naturalHeight = img.naturalHeight || img.height || 0;
        if (!naturalWidth || !naturalHeight) {
          resolve(file);
          return;
        }

        const scale = Math.min(1, maxDimension / Math.max(naturalWidth, naturalHeight));
        const targetWidth = Math.max(1, Math.round(naturalWidth * scale));
        const targetHeight = Math.max(1, Math.round(naturalHeight * scale));

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(file);
          return;
        }

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetWidth, targetHeight);
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        canvas.toBlob(
          (blob) => {
            if (!blob || (blob.size >= file.size && file.size <= 800 * 1024)) {
              resolve(file);
              return;
            }
            const nextName = `${String(file.name || 'photo').replace(/\.[^.]+$/, '')}.jpg`;
            resolve(
              new File([blob], nextName, {
                type: 'image/jpeg',
                lastModified: Date.now(),
              })
            );
          },
          'image/jpeg',
          quality
        );
      } catch {
        resolve(file);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };

    img.src = objectUrl;
  });
}
