/**
 * Turns picked image files into data URLs the screenshot reader can accept.
 *
 * Phone screenshots are huge (and on iPhone often HEIC), which made the upload
 * fail before it ever reached the reader. Each image is drawn onto a canvas,
 * shrunk to a sane size and re-encoded as JPEG, which both compresses it and
 * normalises the format.
 */

const MAX_EDGE = 1600;
const QUALITY = 0.82;

function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not open that image."));
    img.src = src;
  });
}

/** Shrinks one image; returns the original data URL if the browser can't. */
export async function compressImage(file: File): Promise<string> {
  const raw = await toDataUrl(file);
  try {
    const img = await loadImage(raw);
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return raw;
    ctx.drawImage(img, 0, 0, width, height);
    const out = canvas.toDataURL("image/jpeg", QUALITY);
    return out.length > 40 && out.length < raw.length ? out : raw;
  } catch {
    return raw;
  }
}

/** Reads up to four picked files, compressed and ready to send. */
export async function readFiles(files: FileList): Promise<string[]> {
  const picked = Array.from(files).slice(0, 4);
  const images = await Promise.all(picked.map((file) => compressImage(file)));
  return images.filter((img) => img.startsWith("data:image"));
}
