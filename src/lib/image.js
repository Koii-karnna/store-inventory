// ย่อรูปก่อนเก็บ: รูปหลักด้านยาวไม่เกิน 400px (~30–80 KB) และรูปเล็กสำหรับตาราง 72px
export const FULL_PX = 400;
export const THUMB_PX = 72;
export const MAX_BYTES = 80 * 1024;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('เปิดไฟล์รูปไม่ได้')); };
    img.src = url;
  });
}

function draw(img, maxPx, quality) {
  const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // PNG โปร่งใส → พื้นขาว
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

const bytesOf = (dataUrl) => Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75);

export async function processImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('ไฟล์นี้ไม่ใช่รูปภาพ');
  const img = await loadImage(file);
  let quality = 0.8, full = draw(img, FULL_PX, quality);
  while (bytesOf(full) > MAX_BYTES && quality > 0.4) { quality -= 0.1; full = draw(img, FULL_PX, quality); }
  return { full, thumb: draw(img, THUMB_PX, 0.7), bytes: bytesOf(full) };
}
