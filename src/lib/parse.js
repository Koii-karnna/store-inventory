// อ่านไฟล์ Excel ที่ Export จาก Genedia และไฟล์ Master
// ทำงานได้ทั้งในเบราว์เซอร์และใน Node (ใช้ทดสอบกับไฟล์จริง)
import * as XLSX from 'xlsx';
import { subFromCode } from './model.js';

export const BUILDINGS = ['CMC', 'NP'];

/** Genedia ใช้ชื่อ CMA สำหรับอาคาร NP */
export function normBuilding(s) {
  const b = String(s || '').trim().toUpperCase();
  if (b === 'CMA' || b === 'NP') return 'NP';
  if (b === 'CMC') return 'CMC';
  return null;
}

export function readWorkbook(arrayBuffer) {
  return XLSX.read(arrayBuffer, { type: 'array' });
}

function sheetRows(ws) {
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
}

const str = (v) => (v === null || v === undefined ? '' : String(v).trim());

export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function bool(v) {
  if (typeof v === 'boolean') return v;
  const s = str(v).toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'ใช้งาน';
}

/** เดาอาคารจากรหัส: NP ใช้ GG 11–27 รูปแบบ GG-001-01-NNNN, CMC ใช้ GG 01–10 และ 3661 */
export function guessBuildingFromCodes(codes) {
  let np = 0, cmc = 0;
  for (const c of codes) {
    const m = /^(\d{2})-/.exec(c);
    if (/^3661-/.test(c)) cmc++;
    else if (m) (Number(m[1]) >= 11 ? np++ : cmc++);
  }
  if (np + cmc === 0) return null;
  return np > cmc ? 'NP' : 'CMC';
}

/** ตรวจว่าไฟล์เป็นประเภทไหน แล้วอ่านข้อมูลออกมา */
export function parseFile(fileName, wb) {
  const names = wb.SheetNames;
  if (names.includes('CMC Master') && names.includes('NP Master')) return parseMaster(wb);
  if (names.includes('02_ธุรกรรมทั้งหมด') && names.includes('10_สถิติรายรายการ')) return parseUsageBaseline(wb);

  const rows = sheetRows(wb.Sheets[names[0]]);
  const head = (rows[0] || []).map(str);
  if (head.includes('รหัส') && head.includes('คงเหลือ')) return parseStoreList(fileName, rows);
  if (head[0] === 'Part Code' && head.includes('Available')) return parseReport(rows);
  if (head[0] === 'Order No.' && head.includes('Part Issues Date')) return parseUsageReport(rows);
  return { kind: 'unknown', fileName };
}

// ---------- ข้อมูลการเบิก ----------
/** วันที่จาก Excel (ตัวเลข serial หรือข้อความ) → 'YYYY-MM-DDTHH:mm:ss' (ละเอียดถึงวินาที ใช้ตรวจบรรทัดซ้ำ) */
export function excelDateTime(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    if (!(v > 0)) return null;
    const ms = Math.round(v * 86400) * 1000; // ปัดเป็นวินาที
    return new Date(Date.UTC(1899, 11, 30) + ms).toISOString().slice(0, 19);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(v).trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}` : null;
}

/**
 * ไฟล์ Usage_Reconciliation (ตรวจแล้ว) → ประวัติการเบิกตั้งต้น
 * ใช้ชีต 02 (ทุกบรรทัด + นับในยอด) และชีต 10 (รายการที่ไม่ใช้เสนอ Min/Max)
 */
function parseUsageBaseline(wb) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['02_ธุรกรรมทั้งหมด'], { defval: null, raw: true });
  const byB = { CMC: [], NP: [] };
  for (const r of rows) {
    const b = normBuilding(r.Building);
    const code = str(r['Part Code']);
    const qty = num(r.Qty);
    const f = excelDateTime(r['Finish Date']);
    const d = excelDateTime(r['Usage Date']);
    if (!b || !code || qty === null || !d) continue;
    const ln = { s: str(r.System), o: str(r['Order No']), c: code, q: qty, f: f || d, d: d.slice(0, 10) };
    const issued = excelDateTime(r['Part Issues Date']);
    if (issued) ln.i = issued;
    const src = str(r['Part Code (source)']);
    if (src && src !== code) ln.cs = src;
    if (num(r.Price) !== null) ln.p = num(r.Price);
    if (str(r.Location)) ln.l = str(r.Location);
    if (str(r['นับในยอด']) === 'N') ln.x = str(r['ไม่นับเพราะ']) || 'ไม่นับ';
    byB[b].push(ln);
  }
  const st = XLSX.utils.sheet_to_json(wb.Sheets['10_สถิติรายรายการ'], { defval: null, raw: true });
  const noMinMax = st.filter((r) => str(r['ใช้เสนอ Min/Max ได้']) && str(r['ใช้เสนอ Min/Max ได้']) !== 'ได้')
    .map((r) => `${normBuilding(r.Building)}_${str(r['Part Code'])}`);
  return {
    kind: 'usageBaseline',
    usage: Object.entries(byB).map(([building, lines]) => ({ building, lines })),
    noMinMax,
    items: rows,
  };
}

/** Part Usage Report จาก Genedia (G2) — วันที่ใช้ = วันที่ปิดงาน */
function parseUsageReport(rows) {
  let building = null, code = null;
  const lines = [];
  for (const r of rows.slice(1)) {
    const c0 = str(r[0]);
    if (!c0 || c0.startsWith('Branch:') || c0.startsWith('Group:')) continue;
    if (c0.startsWith('Store:')) { building = normBuilding(c0.slice(6)); continue; }
    if (c0.startsWith('Part:')) { code = c0.slice(5).split(' : ')[0].trim(); continue; }
    if (!building || !code) continue;
    const f = excelDateTime(r[3]);
    const qty = num(r[5]);
    if (!f || qty === null) continue;
    const ln = { s: 'G2', o: c0, c: code, q: qty, f, d: f.slice(0, 10) };
    const issued = excelDateTime(r[4]);
    if (issued) ln.i = issued;
    if (num(r[6]) !== null) ln.p = num(r[6]);
    if (str(r[8])) ln.l = str(r[8]);
    lines.push(ln);
  }
  return { kind: 'usageReport', building, usage: [{ building, lines }], items: lines };
}

function parseStoreList(fileName, rows) {
  const head = rows[0].map(str);
  const col = (h) => head.indexOf(h);
  const c = {
    code: col('รหัส'), name: col('ชื่อ'), cost: col('ต้นทุน/หน่วย'), price: col('ราคา/หน่วย'),
    min: col('จำนวนขั้นต่ำ'), max: col('จำนวนสูงสุด'), stock: col('คงเหลือ'), active: col('ใช้งาน'),
  };
  const items = [];
  for (const r of rows.slice(1)) {
    const code = str(r[c.code]);
    if (!code) continue;
    items.push({
      code,
      name: str(r[c.name]),
      cost: num(r[c.cost]),
      price: num(r[c.price]),
      min: num(r[c.min]),
      max: num(r[c.max]),
      stock: num(r[c.stock]) ?? 0,
      active: bool(r[c.active]),
    });
  }
  const m = /\[(CMC|CMA|NP)\]/i.exec(fileName || '');
  const fromName = m ? normBuilding(m[1]) : null;
  const building = fromName || guessBuildingFromCodes(items.map((i) => i.code));
  return { kind: 'store', fileName, building, buildingFromName: !!fromName, items };
}

function parseReport(rows) {
  const items = [];
  let building = null, group = null;
  for (const r of rows.slice(1)) {
    const c0 = str(r[0]);
    if (!c0 || c0.startsWith('Branch:')) continue;
    if (c0.startsWith('Store:')) { building = normBuilding(c0.slice(6)); continue; }
    if (c0.startsWith('Group:')) { group = c0.slice(6).trim(); continue; }
    if (!building) continue;
    items.push({
      building, group, code: c0, name: str(r[1]), unit: str(r[2]),
      min: num(r[3]), max: num(r[4]), stock: num(r[5]), cost: num(r[6]), price: num(r[7]),
    });
  }
  return { kind: 'report', items };
}

const stripParen = (s) => s.replace(/\s*\(.*\)\s*$/, '').trim();

function parseMaster(wb) {
  const items = [];
  for (const [sheet, building] of [['CMC Master', 'CMC'], ['NP Master', 'NP']]) {
    const rows = sheetRows(wb.Sheets[sheet]);
    const head = rows[0].map(str);
    const col = (h) => head.indexOf(h);
    const c = { code: col('Part Code'), name: col('Part Name'), unit: col('Unit'), group: col('Group'), status: col('Status'), brand: col('ยี่ห้อ') };
    for (const r of rows.slice(1)) {
      const code = str(r[c.code]);
      if (!code) continue;
      items.push({
        building, code,
        name: str(r[c.name]),
        unit: str(r[c.unit]),
        group: str(r[c.group]),
        active: str(r[c.status]) !== 'ยกเลิกใช้งาน',
        brand: str(r[c.brand]).toUpperCase() || null,
        sub: subFromCode(building, code),
      });
    }
  }

  // หมวดย่อย CMC (ชื่อเต็ม + Group) จากชีต "หมวดย่อย"
  const subs = [];
  if (wb.Sheets['หมวดย่อย']) {
    for (const r of sheetRows(wb.Sheets['หมวดย่อย'])) {
      const code = str(r[0]);
      const group = str(r[2]);
      if ((/^\d{2}-\d{3}$/.test(code) || code === '3661') && group.startsWith('CMC-')) {
        const name = str(r[1]);
        subs.push({ code, name, group, closed: /ปิดรับ|Legacy/i.test(name) });
      }
    }
  }

  // รหัส GG ของ NP จากชีต "มาตรฐานการตั้งรหัส"
  const npCodes = [];
  if (wb.Sheets['มาตรฐานการตั้งรหัส']) {
    for (const r of sheetRows(wb.Sheets['มาตรฐานการตั้งรหัส'])) {
      const gg = str(r[0]);
      const g = str(r[1]);
      if (/^\d{2}$/.test(gg) && g.startsWith('NP-')) npCodes.push({ gg, group: stripParen(g), desc: str(r[3]) });
    }
  }

  // ยี่ห้อมาตรฐาน: จากคอลัมน์ยี่ห้อใน Master + ตารางยี่ห้อมาตรฐาน
  const brands = new Set(items.map((i) => i.brand).filter(Boolean));
  if (wb.Sheets['มาตรฐานการตั้งชื่อ']) {
    let inBrandTable = false;
    for (const r of sheetRows(wb.Sheets['มาตรฐานการตั้งชื่อ'])) {
      const c0 = str(r[0]);
      if (c0.startsWith('4. ยี่ห้อมาตรฐาน')) { inBrandTable = true; continue; }
      if (inBrandTable && c0 && c0 !== 'เขียนแบบนี้') brands.add(c0.toUpperCase());
    }
  }

  const groups = { CMC: [], NP: [] };
  for (const i of items) if (i.group && !groups[i.building].includes(i.group)) groups[i.building].push(i.group);
  for (const b of Object.keys(groups)) groups[b].sort();

  return {
    kind: 'master',
    items,
    taxonomy: { groups, subs, npCodes },
    brands: [...brands].sort(),
  };
}
