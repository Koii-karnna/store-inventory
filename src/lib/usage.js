// ข้อมูลการเบิกอะไหล่: กติกา, การรวมรายการนำเข้า, สถิติ และ Min/Max เสนอ
// กติกาทั้งหมดผู้ใช้ยืนยันแล้ว (2026-10-24) — ค่า Min/Max เป็น "ค่าเสนอ" ให้ช่างทบทวนเท่านั้น

export const USAGE_RULES = {
  startMonth: '2023-01', // ข้อมูลประวัติเริ่ม ม.ค. 2023
  windowMonths: 24, // ใช้ต่อเดือน = เฉลี่ย 24 เดือนล่าสุด
  leadMonths: 2, // ระยะรอของ
  twiceYearlyAt: 24, // ใช้ ≥ 24 ชิ้น/ปี → เสนอสั่งปีละ 2 ครั้ง
  idle: { min: 1, max: 2 }, // ไม่ถูกเบิกใน 24 เดือน → คงของสำรองฉุกเฉิน
};

// เดือนที่ข้อมูลตกหล่น (ไม่นับเป็นเดือนในค่าเฉลี่ย)
export const USAGE_GAPS = { CMC: ['2026-02', '2026-03'], NP: [] };

export const usageDocId = (building, year) => `usage_${building}_${year}`;
export const USAGE_META_ID = 'usage_meta';

/**
 * บรรทัดการเบิก (เก็บแบบย่อ)
 * { s:'G1'|'G2', o: เลขใบงาน, c: รหัส (ตาม Master), cs?: รหัสในต้นทาง, q: จำนวน,
 *   f: วันปิดงานในต้นทาง 'YYYY-MM-DDTHH:mm:ss', i?: วันที่เบิก (G2), d: วันที่ใช้คำนวณ 'YYYY-MM-DD',
 *   p?: ราคา, l?: สถานที่, x?: เหตุผลที่ไม่นับ }
 * ตัวตรวจซ้ำ: อาคาร + ใบงาน + รหัส + จำนวน + วันปิดงาน + วันที่เบิก (ระดับนาที เพราะ Excel ปัดเศษวินาทีไม่ตรงกัน)
 * ใบงานเดียวกันอาจเบิกรหัสเดียวกันหลายครั้งในนาทีเดียว จึงเทียบ "จำนวนบรรทัด" ของแต่ละตัวตรวจ ไม่ใช่แค่มี/ไม่มี
 */
export const lineKey = (building, ln) => [building, ln.o, ln.c, ln.q, (ln.f || '').slice(0, 16), (ln.i || '').slice(0, 16)].join('|');

export const monthOf = (iso) => iso.slice(0, 7);
const addMonths = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
export const monthRange = (from, to) => {
  const out = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
};
const ceil = (x) => Math.ceil(x - 1e-9);

/** จับคู่บรรทัดนำเข้ากับที่มีอยู่ → เฉพาะบรรทัดใหม่ แยกตามเอกสาร (อาคาร-ปี) */
export function planUsage(existingDocs, incoming, { replace = false } = {}) {
  const docs = {};
  const have = {}; // ตัวตรวจ → จำนวนบรรทัดที่มีอยู่แล้ว
  if (!replace) {
    for (const [id, doc] of Object.entries(existingDocs)) {
      docs[id] = [...(doc.lines || [])];
      for (const ln of doc.lines || []) { const k = lineKey(doc.building, ln); have[k] = (have[k] || 0) + 1; }
    }
  }
  const summary = {};
  for (const { building, lines } of incoming) {
    const s = (summary[building] ??= { added: 0, duplicate: 0, notCounted: 0, badDate: 0, qty: 0 });
    for (const ln of lines) {
      const k = lineKey(building, ln);
      if (have[k] > 0) { have[k]--; s.duplicate++; continue; }
      const id = usageDocId(building, ln.d.slice(0, 4));
      (docs[id] ??= []).push(ln);
      s.added++;
      if (ln.x) s.notCounted++; else s.qty += ln.q;
      if (ln.d < `${USAGE_RULES.startMonth}-01`) s.badDate++;
    }
  }
  const changed = Object.keys(docs).filter((id) => replace || (docs[id].length !== (existingDocs[id]?.lines?.length || 0)));
  return { docs, changed, summary };
}

/**
 * สถิติรายรายการของอาคาร
 * @param lines   บรรทัดทั้งหมดของอาคาร (ทุกปี)
 * @param items   รายการของอาคาร (มี v = ค่าที่แสดง)
 * @param noMinMax  Set ของ itemId ที่ไม่ใช้เสนอ Min/Max (หน่วยตอนเบิกไม่ตรง Master)
 */
export function usageStats(building, lines, items, noMinMax = new Set()) {
  const counted = lines.filter((l) => !l.x);
  const endMonth = counted.reduce((m, l) => (monthOf(l.d) > m ? monthOf(l.d) : m), USAGE_RULES.startMonth);
  const gaps = new Set(USAGE_GAPS[building] || []);
  const windowFrom = addMonths(endMonth, -(USAGE_RULES.windowMonths - 1));
  const windowMonths = monthRange(windowFrom, endMonth).filter((m) => !gaps.has(m));
  const allMonths = monthRange(USAGE_RULES.startMonth, endMonth);
  const years = [...new Set(allMonths.map((m) => Number(m.slice(0, 4))))];

  const byCode = {};
  for (const l of counted) (byCode[l.c] ??= []).push(l);

  const stats = {};
  for (const it of items) {
    const ls = byCode[it.code] || [];
    const byYear = Object.fromEntries(years.map((y) => [y, 0]));
    const monthly = {};
    let total = 0, tx = 0, last = null, win = 0;
    for (const l of ls) {
      const y = Number(l.d.slice(0, 4));
      if (y in byYear) byYear[y] += l.q;
      const m = monthOf(l.d);
      monthly[m] = (monthly[m] || 0) + l.q;
      total += l.q;
      if (l.q > 0) tx++;
      if (!last || l.d > last) last = l.d;
      if (m >= windowFrom && m <= endMonth) win += l.q;
    }
    const avg = win / windowMonths.length;
    const annual = avg * 12;
    const used24 = !!last && monthOf(last) >= windowFrom;
    const suggestedFreq = annual >= USAGE_RULES.twiceYearlyAt ? 2 : 1;
    const freq = it.orderFreq === 1 || it.orderFreq === 2 ? it.orderFreq : suggestedFreq;
    const stock = it.v?.stock ?? it.g?.stock ?? null;

    let proposal = null, excludeReason = '';
    if (!it.v?.active) excludeReason = 'ยกเลิกใช้งาน';
    else if (noMinMax.has(it.id)) excludeReason = 'หน่วยตอนเบิกไม่ตรง Master';
    else if (!used24) proposal = { ...USAGE_RULES.idle, idle: true };
    else {
      const min = Math.max(1, ceil(avg * USAGE_RULES.leadMonths));
      const max = Math.max(min + 1, ceil(avg * (12 / freq) + avg * USAGE_RULES.leadMonths));
      proposal = { min, max, idle: false };
    }
    const monthsSinceLast = last ? monthRange(monthOf(last), endMonth).length - 1 : null;
    // หน่วยตอนเบิก (ลิตร/กก.) ไม่ตรงกับหน่วยคงเหลือ → ไม่คำนวณ "พอใช้อีกกี่เดือน"
    const unitMismatch = noMinMax.has(it.id);
    stats[it.id] = {
      byYear, total, tx, last, avg, annual, used24, suggestedFreq, freq, monthly, unitMismatch,
      peakMonth: Object.values(monthly).reduce((a, b) => Math.max(a, b), 0),
      monthsSinceLast, monthsCover: avg > 0 && stock !== null && !unitMismatch ? stock / avg : null,
      proposal, excludeReason,
    };
  }
  return { stats, endMonth, windowFrom, windowMonths: windowMonths.length, years, gaps: [...gaps] };
}

/** รายการทบทวน: Dead Stock = ใช้งาน + มีของ + ไม่เคยเบิกตั้งแต่ 2023 · ยกเลิกแต่มีของ */
export const isDeadStock = (it, st) => it.v?.active && (it.v?.stock ?? 0) > 0 && st && st.total === 0;
export const isInactiveWithStock = (it) => !it.v?.active && (it.v?.stock ?? 0) > 0;
