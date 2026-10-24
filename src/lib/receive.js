// ข้อมูลการรับเข้าอะไหล่ (Part Receive Report) — กติกาผู้ใช้ยืนยันแล้ว (2026-10-24)
// - Price = ราคาต่อหน่วย (บางบรรทัดกรอกผิดเป็นราคารวม → ติดธง ไม่ใช้เป็นราคาซื้อล่าสุด ไม่แก้ตัวเลข)
// - วันที่/จำนวนรับเข้าล่าสุดของรายการ: ข้อมูลจากไฟล์ทับเฉพาะเมื่อวันที่ใหม่กว่าค่าเดิม
// - รับเข้าตั้งแต่วันที่ทำใบขอซื้อ → ปลดป้าย "กำลังสั่ง"

export const receiveDocId = (building) => `receive_${building}`;
export const RECEIVE_META_ID = 'receive_meta';

/** บรรทัดรับเข้า { c: รหัส, q: จำนวน, d: 'YYYY-MM-DD', p?: ราคา/หน่วย, t?: ยอดรวม, s?: ผู้ขาย } */
const key = (building, l) => [building, l.c, l.d, l.q, l.p ?? ''].join('|');

/** เพิ่มเฉพาะบรรทัดใหม่ (เทียบจำนวนบรรทัดของแต่ละตัวตรวจ เหมือนข้อมูลการเบิก) */
export function planReceive(existingDocs, incoming) {
  const docs = {}, have = {}, summary = {};
  for (const [id, doc] of Object.entries(existingDocs)) {
    docs[id] = [...(doc.lines || [])];
    for (const l of doc.lines || []) { const k = key(doc.building, l); have[k] = (have[k] || 0) + 1; }
  }
  for (const { building, lines } of incoming) {
    const s = (summary[building] ??= { added: 0, duplicate: 0 });
    const id = receiveDocId(building);
    for (const l of lines) {
      const k = key(building, l);
      if (have[k] > 0) { have[k]--; s.duplicate++; continue; }
      (docs[id] ??= []).push(l);
      s.added++;
    }
  }
  const changed = Object.keys(docs).filter((id) => docs[id].length !== (existingDocs[id]?.lines?.length || 0));
  return { docs, changed, summary };
}

/** ราคาอ้างอิงจาก Genedia: ใช้ต้นทุนก่อน (ราคา/หน่วย อาจถูกบันทึกทับด้วยราคาที่กรอกผิด) */
export const referencePrice = (item) => (item?.g?.cost > 0 ? item.g.cost : item?.g?.price || null);

/**
 * ราคาน่าสงสัยว่ากรอกเป็นราคารวม: สูงกว่าราคาอ้างอิงเกิน 2 เท่า และ ราคา ÷ จำนวน ใกล้ราคาอ้างอิงมากกว่า
 * (ตัวอย่าง Power supply รับ 10 ตัว Price 19,500 · ต้นทุนใน Genedia 1,950)
 */
export function suspiciousPrice(l, refPrice) {
  if (!l.p || !refPrice || !(l.q > 1)) return false;
  return l.p > refPrice * 2 && Math.abs(l.p / l.q - refPrice) < Math.abs(l.p - refPrice);
}

/** สรุปการรับเข้ารายรายการ: ล่าสุด (รวมจำนวนถ้าหลายบรรทัดวันเดียวกัน) และราคาซื้อล่าสุดที่ไม่ติดธง */
export function receiveSummary(lines, itemsByCode) {
  const by = {};
  for (const l of lines) (by[l.c] ??= []).push(l);
  const out = {};
  for (const [code, ls] of Object.entries(by)) {
    const sorted = [...ls].sort((a, b) => b.d.localeCompare(a.d));
    const lastDate = sorted[0].d;
    const lastQty = sorted.filter((l) => l.d === lastDate).reduce((s, l) => s + l.q, 0);
    const ref = referencePrice(itemsByCode[code]);
    const priced = sorted.find((l) => l.p && !suspiciousPrice(l, ref));
    out[code] = { lastDate, lastQty, lastPrice: priced?.p ?? null, lastPriceDate: priced?.d ?? null, lines: sorted };
  }
  return out;
}

const dayOf = (ts) => {
  const d = ts?.toDate ? ts.toDate() : ts instanceof Date ? ts : ts ? new Date(ts) : null;
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null;
};

/**
 * การเปลี่ยนแปลงของรายการจากข้อมูลรับเข้าทั้งหมดของอาคาร
 * @returns [{item, patch}] — patch: lastInDate/lastInQty (เมื่อใหม่กว่า), ordering: null (เมื่อรับเข้าหลังวันสั่ง)
 */
export function receiveItemPatches(lines, items) {
  const byCode = Object.fromEntries(items.map((i) => [i.code, i]));
  const sum = receiveSummary(lines, byCode);
  const out = [];
  for (const [code, s] of Object.entries(sum)) {
    const it = byCode[code];
    if (!it) continue;
    const patch = {};
    if (!it.lastInDate || s.lastDate > it.lastInDate) { patch.lastInDate = s.lastDate; patch.lastInQty = s.lastQty; }
    const orderedOn = dayOf(it.ordering?.at);
    if (orderedOn && s.lines.some((l) => l.d >= orderedOn)) patch.ordering = null;
    if (Object.keys(patch).length) out.push({ item: it, patch });
  }
  return out;
}
