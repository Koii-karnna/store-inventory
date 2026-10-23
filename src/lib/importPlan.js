// คำนวณว่าการนำเข้าไฟล์จะเปลี่ยนอะไรบ้าง (ยังไม่เขียนลงฐานข้อมูล)
import { itemId, buildReportGroupMap, guessGroup } from './model.js';

export const FIELD_LABELS = {
  'g.name': 'ชื่อ (Genedia)', 'g.active': 'สถานะ (Genedia)', 'g.unit': 'หน่วย (Genedia)', 'g.group': 'Group (Genedia)',
  'g.stock': 'คงเหลือ', 'g.min': 'Min', 'g.max': 'Max', 'g.cost': 'ต้นทุน', 'g.price': 'ราคา',
  'm.name': 'ชื่อ (Master)', 'm.active': 'สถานะ (Master)', 'm.unit': 'หน่วย (Master)', 'm.group': 'Group (Master)', 'm.brand': 'ยี่ห้อ (Master)',
  g: 'ข้อมูล Genedia', m: 'ข้อมูล Master',
  group: 'Group', sub: 'หมวดย่อย', brand: 'ยี่ห้อ', note: 'หมายเหตุ', review: 'รอตรวจ Group',
  inGenedia: 'อยู่ใน Genedia', ordering: 'กำลังสั่ง', vendors: 'Vendor', image: 'รูป',
};

const G_FIELDS = ['name', 'active', 'unit', 'group', 'stock', 'min', 'max', 'cost', 'price'];
const M_FIELDS = ['name', 'active', 'unit', 'group', 'brand'];
const TOP_FIELDS = ['group', 'sub', 'brand', 'review', 'inGenedia', 'ordering'];

const same = (a, b) => (a ?? null) === (b ?? null) || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * @param existing  รายการปัจจุบันในฐานข้อมูล [{id, ...item}]
 * @param files     ผลจาก parseFile (store / report / master)
 * @param taxonomy  config/taxonomy ปัจจุบัน
 * @param opts.overwriteWeb  ให้ Master ทับ Group/หมวดย่อย/ยี่ห้อ ที่แก้ในเว็บแล้วด้วย
 */
export function planImport(existing, files, taxonomy, opts = {}) {
  const before = new Map(existing.map((it) => [it.id, it]));
  const next = new Map(existing.map((it) => [it.id, structuredClone({ ...it })]));
  const master = files.find((f) => f.kind === 'master');
  const report = files.find((f) => f.kind === 'report');
  const stores = files.filter((f) => f.kind === 'store' && f.building);
  const tax = master ? master.taxonomy : taxonomy;

  const blank = (building, code) => ({
    id: itemId(building, code), building, code, g: null, m: null,
    group: null, sub: null, brand: null, vendors: [], note: '', thumb: null,
    review: false, inGenedia: false, ordering: null,
  });

  // 1) Master: ค่าเป้าหมาย + ค่าตั้งต้นของ Group/หมวดย่อย/ยี่ห้อ
  if (master) {
    const seen = new Set();
    for (const r of master.items) {
      const id = itemId(r.building, r.code);
      seen.add(id);
      const it = next.get(id) || blank(r.building, r.code);
      it.m = { name: r.name, active: r.active, unit: r.unit, group: r.group, brand: r.brand };
      if (!it.group || opts.overwriteWeb || it.review) { it.group = r.group; it.sub = r.sub; it.review = false; }
      if (!it.brand || opts.overwriteWeb) it.brand = r.brand || it.brand;
      next.set(id, it);
    }
    for (const it of next.values()) if (it.m && !seen.has(it.id)) it.m = null;
  }

  // 2) Part List Report: หน่วยนับ + Group ใน Genedia
  const rep = new Map((report?.items || []).map((r) => [itemId(r.building, r.code), r]));

  // 3) Store Part List: คงเหลือ/Min/Max/ราคา/ชื่อ/สถานะ
  const reportMap = buildReportGroupMap([...next.values()].map((it) => {
    const r = rep.get(it.id);
    return r ? { ...it, g: { ...(it.g || {}), group: r.group } } : it;
  }));
  const storeBuildings = new Set();
  for (const f of stores) {
    storeBuildings.add(f.building);
    const seen = new Set();
    for (const r of f.items) {
      const id = itemId(f.building, r.code);
      seen.add(id);
      const rp = rep.get(id);
      let it = next.get(id);
      if (!it) {
        it = blank(f.building, r.code);
        const guess = guessGroup(f.building, r.code, rp?.group, tax, reportMap);
        it.group = guess.group; it.sub = guess.sub; it.review = true;
      }
      const old = it.g || {};
      it.g = {
        name: r.name, active: r.active, stock: r.stock, min: r.min, max: r.max, cost: r.cost, price: r.price,
        unit: rp ? rp.unit : old.unit ?? null,
        group: rp ? rp.group : old.group ?? null,
      };
      it.inGenedia = true;
      // ของเข้าแล้ว (คงเหลือเพิ่มขึ้นจากตอนสั่ง) → ปลดป้าย "กำลังสั่ง"
      if (it.ordering && r.stock > (it.ordering.stockAtOrder ?? Infinity)) it.ordering = null;
      next.set(id, it);
    }
    for (const it of next.values()) if (it.building === f.building && it.inGenedia && !seen.has(it.id)) it.inGenedia = false;
  }

  // Report อย่างเดียว (ไม่มี Store Part List ของอาคารนั้น): อัปเดตแค่หน่วย/Group
  for (const [id, r] of rep) {
    if (storeBuildings.has(r.building)) continue;
    const it = next.get(id);
    if (it?.g) it.g = { ...it.g, unit: r.unit, group: r.group };
  }

  // 4) เทียบก่อน/หลัง
  const creates = [], updates = [];
  for (const [id, it] of next) {
    const old = before.get(id);
    if (!old) { creates.push({ id, data: it }); continue; }
    const patch = {}, changes = [];
    const diff = (path, a, b) => { if (!same(a, b)) { patch[path] = b ?? null; changes.push({ field: path, from: a ?? null, to: b ?? null }); } };
    for (const [key, fields] of [['g', G_FIELDS], ['m', M_FIELDS]]) {
      if (!old[key] || !it[key]) diff(key, old[key], it[key]);
      else for (const f of fields) diff(`${key}.${f}`, old[key][f], it[key][f]);
    }
    for (const f of TOP_FIELDS) diff(f, old[f], it[f]);
    if (changes.length) updates.push({ id, building: it.building, code: it.code, patch, changes });
  }

  const summary = {};
  for (const b of ['CMC', 'NP']) {
    const u = updates.filter((x) => x.building === b);
    summary[b] = {
      created: creates.filter((x) => x.data.building === b).length,
      updated: u.length,
      stockChanged: u.filter((x) => 'g.stock' in x.patch).length,
      needReview: creates.filter((x) => x.data.building === b && x.data.review).length,
      missing: u.filter((x) => x.patch.inGenedia === false).length,
      orderCleared: u.filter((x) => 'ordering' in x.patch && x.patch.ordering === null).length,
    };
  }

  return { creates, updates, summary, taxonomy: master?.taxonomy || null, brands: master?.brands || null };
}
