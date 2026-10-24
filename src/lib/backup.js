// สำรอง / กู้คืนข้อมูลทั้งหมดใน Firestore เป็นไฟล์ .zip (JSON แยกตาม collection)
import JSZip from 'jszip';
import { collection, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '../firebase.js';

export const BACKUP_COLLECTIONS = ['items', 'images', 'vendors', 'pos', 'imports', 'users', 'config', 'settings', 'logs'];
export const COLLECTION_LABELS = {
  items: 'รายการอะไหล่', images: 'รูป', vendors: 'Vendor', pos: 'ใบขอซื้อ', imports: 'ประวัตินำเข้า',
  users: 'ผู้ใช้', config: 'Group/หมวดย่อย/ยี่ห้อ', settings: 'ตั้งค่า', logs: 'Log',
};
// Log เขียนย้อนหลังไม่ได้ (กติกาความปลอดภัย: Log เป็นของผู้เขียนเท่านั้น) · bootstrap แก้ไม่ได้
const SKIP_RESTORE = { logs: true };
const SKIP_DOC = { config: ['bootstrap'] };

// Timestamp ของ Firestore → {__ts:[วินาที, นาโนวินาที]} และย้อนกลับ
function pack(v) {
  if (v instanceof Timestamp) return { __ts: [v.seconds, v.nanoseconds] };
  if (Array.isArray(v)) return v.map(pack);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, pack(x)]));
  return v;
}
function unpack(v) {
  if (Array.isArray(v)) return v.map(unpack);
  if (v && typeof v === 'object') {
    if (Array.isArray(v.__ts) && Object.keys(v).length === 1) return new Timestamp(v.__ts[0], v.__ts[1]);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unpack(x)]));
  }
  return v;
}

export async function createBackup(onProgress) {
  const zip = new JSZip();
  const counts = {};
  for (const [i, name] of BACKUP_COLLECTIONS.entries()) {
    onProgress?.(`กำลังอ่าน ${COLLECTION_LABELS[name]}`, i, BACKUP_COLLECTIONS.length);
    const snap = await getDocs(collection(db, name));
    const docs = Object.fromEntries(snap.docs.map((d) => [d.id, pack(d.data())]));
    counts[name] = snap.size;
    zip.file(`${name}.json`, JSON.stringify(docs));
  }
  const manifest = { app: 'store-inventory', version: 1, createdAt: new Date().toISOString(), projectId: db.app.options.projectId, counts };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  onProgress?.('กำลังบีบอัดไฟล์', BACKUP_COLLECTIONS.length, BACKUP_COLLECTIONS.length);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { blob, manifest };
}

/** อ่านไฟล์สำรอง → {manifest, collections: {name: {id: data}}} */
export async function readBackup(file) {
  const zip = await JSZip.loadAsync(file);
  const mf = zip.file('manifest.json');
  if (!mf) throw new Error('ไม่ใช่ไฟล์สำรองของระบบนี้ (ไม่พบ manifest.json)');
  const manifest = JSON.parse(await mf.async('string'));
  if (manifest.app !== 'store-inventory') throw new Error('ไม่ใช่ไฟล์สำรองของระบบคลังอะไหล่');
  const collections = {};
  for (const name of BACKUP_COLLECTIONS) {
    const f = zip.file(`${name}.json`);
    if (f) collections[name] = unpack(JSON.parse(await f.async('string')));
  }
  return { manifest, collections };
}

/** คำสั่งเขียนสำหรับกู้คืน (แยกชุดรูปให้เล็ก เพราะ Firestore จำกัดขนาดต่อการบันทึก) */
export function restoreOps(collections) {
  const small = [], images = [];
  for (const [name, docs] of Object.entries(collections)) {
    if (SKIP_RESTORE[name]) continue;
    for (const [id, data] of Object.entries(docs)) {
      if (SKIP_DOC[name]?.includes(id)) continue;
      (name === 'images' ? images : small).push({ type: 'set', path: [name, id], data });
    }
  }
  return { small, images };
}
