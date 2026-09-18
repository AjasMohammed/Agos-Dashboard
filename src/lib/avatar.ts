/** Edge of the square the API stores; small enough to ride in every agent list payload. */
const SIZE = 256;
/** Mirrors `AVATAR_MAX_LEN` in agentos-api kernel_impl.rs (length of the whole data URL). */
const MAX_LEN = 64 * 1024;

/**
 * Center-crop and downscale an image file to a 256px data URL the API accepts
 * (`data:image/{webp,jpeg};base64,…`, well under its 64 KB cap).
 */
export async function imageFileToAvatar(file: File): Promise<string> {
  // Full decode happens before the downscale; a huge file can hang the tab.
  if (file.size > 20 * 1024 * 1024) throw new Error("Image too large");
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  // White ground: the JPEG fallback below would turn transparency black.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    SIZE,
    SIZE,
  );
  bitmap.close();
  // Detailed photos (and Safari's JPEG fallback) can overshoot the cap at one
  // quality, so step down until it fits.
  for (const q of [0.85, 0.7, 0.5, 0.35]) {
    let url = canvas.toDataURL("image/webp", q);
    // Browsers without a WebP encoder silently hand back PNG, which can blow the cap.
    if (!url.startsWith("data:image/webp")) url = canvas.toDataURL("image/jpeg", q);
    if (url.length <= MAX_LEN) return url;
  }
  throw new Error("Image too detailed; try a simpler picture");
}
