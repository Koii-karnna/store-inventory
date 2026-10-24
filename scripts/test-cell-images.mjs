// ทดสอบอ่านรูปแบบวางในเซลล์: node scripts/test-cell-images.mjs <ไฟล์.xlsx>
import { readFileSync } from 'node:fs';
import { extractCellImages } from '../src/lib/cellImages.js';

const buf = readFileSync(process.argv[2]);
const t = Date.now();
const { images, noCode } = await extractCellImages(buf);
console.log(`พบรูป ${images.length} รูป (ไม่มีรหัส ${noCode}) ใน ${((Date.now() - t) / 1000).toFixed(1)}s`);
console.log(images.slice(0, 5).map((i) => `${i.sheet}!R${i.row} ${i.code} → ${i.media} ${Math.round((i.size || 0) / 1024)}KB`).join('\n'));
const b = await images[0].blob();
console.log('blob ตัวแรก', b.type, Math.round(b.size / 1024), 'KB');
