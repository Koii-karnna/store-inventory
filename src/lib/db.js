// การเขียนฐานข้อมูล: ทุกการแก้ไขจะเขียน log ในชุดเดียวกัน (สำเร็จพร้อมกันหรือไม่สำเร็จเลย)
import {
  doc, collection, writeBatch, serverTimestamp, getDoc, getDocs, query, where, orderBy, limit, startAfter,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { FIELD_LABELS } from './importPlan.js';

export const ACTIONS = {
  import: 'นำเข้าไฟล์',
  edit: 'แก้ไขรายการ',
  image: 'รูป',
  po: 'ใบขอซื้อ',
  vendor: 'Vendor',
  user: 'ผู้ใช้',
  settings: 'ตั้งค่า',
  backup: 'สำรอง/กู้คืน',
  newcode: 'ออกรหัสใหม่',
};

const BATCH_MAX = 450; // Firestore จำกัด 500 คำสั่งต่อชุด

/** ops: [{type:'set'|'update'|'delete', path:[coll,id], data}] + logs: [{action, ...}] */
export async function commit(user, ops, logs = [], onProgress) {
  const all = [
    ...ops,
    ...logs.map((l) => ({
      type: 'set',
      path: ['logs', doc(collection(db, 'logs')).id],
      data: { ...l, uid: user.uid, user: user.name, ts: serverTimestamp() },
    })),
  ];
  for (let i = 0; i < all.length; i += BATCH_MAX) {
    const batch = writeBatch(db);
    for (const op of all.slice(i, i + BATCH_MAX)) {
      const ref = doc(db, ...op.path);
      if (op.type === 'set') batch.set(ref, op.data, op.merge ? { merge: true } : undefined);
      else if (op.type === 'update') batch.update(ref, op.data);
      else if (op.type === 'delete') batch.delete(ref);
    }
    await batch.commit();
    onProgress?.(Math.min(i + BATCH_MAX, all.length), all.length);
  }
}

const show = (v) => {
  if (v === null || v === undefined || v === '') return '–';
  if (typeof v === 'boolean') return v ? 'ใช่' : 'ไม่';
  if (typeof v === 'object') return Array.isArray(v) ? `${v.length} รายการ` : '…';
  return String(v);
};

export const describeChange = (c) => `${FIELD_LABELS[c.field] || c.field}: ${show(c.from)} → ${show(c.to)}`;

/** แก้ไขรายการ 1 ตัว พร้อม log ว่าช่องไหนเปลี่ยนจากอะไรเป็นอะไร */
export async function updateItem(user, item, patch, action = 'edit') {
  const changes = Object.entries(patch)
    .filter(([k, v]) => JSON.stringify(item[k] ?? null) !== JSON.stringify(v ?? null))
    .map(([k, v]) => ({ field: k, from: item[k] ?? null, to: v ?? null }));
  if (!changes.length) return false;
  await commit(
    user,
    [{ type: 'update', path: ['items', item.id], data: { ...patch, updatedAt: serverTimestamp() } }],
    [{ action, building: item.building, code: item.code, itemId: item.id, changes: changes.map(slim) }],
  );
  return true;
}

/** log ไม่เก็บค่าที่ใหญ่ (เช่นรูป) */
function slim(c) {
  const small = (v) => (typeof v === 'string' && v.length > 300 ? '[ข้อมูลยาว]' : v);
  return { field: c.field, from: small(c.from), to: small(c.to) };
}
export { slim as slimChange };

export async function getImage(itemId) {
  const s = await getDoc(doc(db, 'images', itemId));
  return s.exists() ? s.data().data : null;
}

/** ประวัติของรายการ (เรียงในเครื่อง จึงไม่ต้องสร้าง index เพิ่ม) */
export async function itemHistory(itemId) {
  const s = await getDocs(query(collection(db, 'logs'), where('itemId', '==', itemId)));
  return s.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.ts?.seconds ?? Infinity) - (a.ts?.seconds ?? Infinity))
    .slice(0, 50);
}

export async function recentLogs(after = null, n = 200) {
  const q = after
    ? query(collection(db, 'logs'), orderBy('ts', 'desc'), startAfter(after), limit(n))
    : query(collection(db, 'logs'), orderBy('ts', 'desc'), limit(n));
  const s = await getDocs(q);
  return { rows: s.docs.map((d) => ({ id: d.id, ...d.data() })), last: s.docs[s.docs.length - 1] || null };
}
