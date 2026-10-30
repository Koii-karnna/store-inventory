// กติกาของข้อมูล: ค่าที่แสดง, ระดับแจ้งเตือน, ความไม่ตรงกับ Master
export const DEFAULT_SETTINGS = { preferMaster: true, nearPct: 20 };

/** หมวดย่อยของรายการ: CMC = GG-SSS หรือ 3661, NP ไม่มีหมวดย่อย */
export function subFromCode(building, code) {
  if (building !== 'CMC') return null;
  if (/^3661-/.test(code)) return '3661';
  const m = /^(\d{2}-\d{3})-/.exec(code);
  return m ? m[1] : null;
}

export const itemId = (building, code) => `${building}_${code}`;

/**
 * ค่าที่แสดงในเว็บ
 * - ชื่อ/หน่วย: ช่วงเปลี่ยนผ่านแสดงตาม Master (ตั้งค่าได้) ไม่งั้นตาม Genedia
 * - สถานะ: ยกเลิกที่ใดที่หนึ่ง (Genedia หรือ Master) = ยกเลิก ไม่แจ้งเตือนและไม่ให้สั่งซื้อ
 * - คงเหลือ/Min/Max/ราคา: ตาม Genedia เสมอ
 * - Group/หมวดย่อย/ยี่ห้อ: เก็บในเว็บ
 */
export function view(item, settings = DEFAULT_SETTINGS) {
  const g = item.g, m = item.m;
  const useM = settings.preferMaster && m;
  return {
    name: (useM && m.name) || g?.name || m?.name || '',
    active: (g ? g.active : true) && (m ? m.active : true),
    unit: (useM && m.unit) || g?.unit || m?.unit || '',
    stock: g?.stock ?? null,
    min: g?.min ?? null,
    max: g?.max ?? null,
    price: g?.price ?? null,
    // ราคาอ้างอิง (ใบขอซื้อ / มูลค่าคงเหลือ): ต้นทุน/หน่วยของ Genedia ถ้าเป็น 0 ใช้ราคา/หน่วย
    // (ราคา/หน่วยใน Genedia บางรายการถูกบันทึกทับด้วยยอดรวมตอนรับเข้า — ผู้ใช้เลือกใช้ต้นทุน 2026-10-24)
    unitPrice: g?.cost > 0 ? g.cost : g?.price ?? null,
  };
}

export const LEVELS = {
  out: { label: 'หมด', color: 'red' },
  low: { label: 'ถึง Min', color: 'orange' },
  near: { label: 'ใกล้ Min', color: 'yellow' },
  ok: { label: 'ปกติ', color: 'green' },
  nomin: { label: 'ไม่มี Min', color: 'gray' },
  nodata: { label: 'ไม่มีใน Genedia', color: 'gray' },
  pending: { label: 'รอเพิ่มใน Genedia', color: 'blue' },
  inactive: { label: 'ยกเลิกใช้งาน', color: 'gray' },
};

/** ระดับแจ้งเตือน (Min ว่างหรือ 0 ถือว่า "ไม่มี Min") */
export function level(item, settings = DEFAULT_SETTINGS) {
  const v = view(item, settings);
  if (!v.active) return 'inactive';
  if (!item.g || item.inGenedia === false) return item.pending ? 'pending' : 'nodata';
  if (!v.min) return 'nomin';
  if (v.stock <= 0) return 'out';
  if (v.stock <= v.min) return 'low';
  if (v.stock <= v.min * (1 + (settings.nearPct ?? 20) / 100)) return 'near';
  return 'ok';
}

/** รอตรวจ Group: เฉพาะรายการที่ยังใช้งานและยังอยู่ใน Genedia (ยกเลิกแล้ว/หายจาก Genedia ไม่ต้องตรวจ) */
export const needsReview = (r) => !!r.review && r.lv !== 'inactive' && r.inGenedia !== false;

/** ต้องสั่ง = หมด หรือ ถึง Min และยังไม่อยู่ระหว่างสั่ง */
export const needsOrder = (lv, item) => (lv === 'out' || lv === 'low') && !item.ordering;

/** จำนวนสั่งตั้งต้น = Max − คงเหลือ (ถ้าไม่มี Max ใช้ Min × 2 − คงเหลือ) */
export function suggestQty(item) {
  const g = item.g || {};
  const stock = g.stock ?? 0;
  const target = g.max || (g.min ? g.min * 2 : 0);
  return Math.max(target - stock, 1);
}

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export const MISMATCH_TYPES = {
  onlyGenedia: 'มีใน Genedia แต่ไม่มีใน Master',
  onlyMaster: 'มีใน Master แต่ไม่มีใน Genedia',
  name: 'ชื่อไม่ตรง',
  status: 'สถานะไม่ตรง',
  unit: 'หน่วยนับไม่ตรง',
  group: 'Group ไม่ตรง',
};

/** สิ่งที่ต้องไปแก้ใน Genedia ให้ตรงกับ Master */
export function mismatches(item) {
  const g = item.inGenedia === false ? null : item.g, m = item.m;
  if (g && !m) return [{ type: 'onlyGenedia', genedia: g.name, master: '' }];
  if (m && !g) return [{ type: 'onlyMaster', genedia: '', master: m.name }];
  if (!g || !m) return [];
  const out = [];
  if (clean(g.name) !== clean(m.name)) out.push({ type: 'name', genedia: g.name, master: m.name });
  if (g.active !== m.active) out.push({ type: 'status', genedia: g.active ? 'ใช้งาน' : 'ยกเลิกใช้งาน', master: m.active ? 'ใช้งาน' : 'ยกเลิกใช้งาน' });
  if (g.unit && m.unit && clean(g.unit) !== clean(m.unit)) out.push({ type: 'unit', genedia: g.unit, master: m.unit });
  if (g.group && m.group && clean(g.group) !== clean(m.group)) out.push({ type: 'group', genedia: g.group, master: m.group });
  return out;
}

/** จับคู่ชื่อ Group เก่าใน Part List Report → Group ใหม่ใน Master (ใช้เสียงข้างมากจากรายการที่มีทั้งสองที่) */
export function buildReportGroupMap(items) {
  const count = {};
  for (const it of items) {
    if (!it.g?.group || !it.m?.group) continue;
    const k = `${it.building}|${it.g.group}`;
    count[k] ??= {};
    count[k][it.m.group] = (count[k][it.m.group] || 0) + 1;
  }
  const map = {};
  for (const [k, c] of Object.entries(count)) map[k] = Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
  return map;
}

/** เดา Group/หมวดย่อยของรายการใหม่ที่ไม่มีใน Master */
export function guessGroup(building, code, reportGroup, taxonomy, reportMap) {
  const sub = subFromCode(building, code);
  let group = reportGroup ? reportMap[`${building}|${reportGroup}`] : null;
  if (!group && building === 'CMC' && sub) group = taxonomy?.subs?.find((s) => s.code === sub)?.group || null;
  if (!group && building === 'NP') {
    const gg = code.slice(0, 2);
    group = taxonomy?.npCodes?.find((n) => n.gg === gg)?.group || null;
  }
  if (!group && reportGroup && taxonomy?.groups?.[building]?.includes(reportGroup)) group = reportGroup;
  return { group, sub };
}

export const fmtNum = (n) => (n === null || n === undefined ? '–' : Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 }));

export const fmtDateTime = (ts) => {
  const d = ts?.toDate ? ts.toDate() : ts instanceof Date ? ts : ts ? new Date(ts) : null;
  return d ? d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '–';
};

/** '2026-10' → 'ต.ค. 2569' */
export const fmtMonthThai = (ym) => (ym ? new Date(`${ym}-01T00:00:00`).toLocaleDateString('th-TH', { month: 'short', year: 'numeric' }) : '');

/** '2026-10-12' → '12 ต.ค. 2569' */
export const fmtIsoDateThai = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/** รับเข้าล่าสุด (กรอกเองในเว็บ) เช่น '12 ต.ค. 2569 / 10 ตัว' */
export function fmtLastIn(item, unit = '') {
  const d = fmtIsoDateThai(item.lastInDate);
  const q = item.lastInQty ? `${fmtNum(item.lastInQty)}${unit ? ` ${unit}` : ''}` : '';
  return [d, q].filter(Boolean).join(' / ');
}

export const fmtDateThai =(d = new Date()) => d.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
