import { useMemo, useState } from 'react';
import { useData } from '../state.jsx';
import { go, Empty, Badge, AsyncButton } from '../ui.jsx';
import { fmtNum, fmtIsoDateThai, fmtMonthThai } from '../lib/model.js';
import { useUsageStats } from '../lib/usageStore.js';
import { USAGE_RULES, USAGE_GAPS, isDeadStock, isInactiveWithStock } from '../lib/usage.js';
import ItemDrawer from './ItemDrawer.jsx';

const r2 = (n) => (n === null || n === undefined ? null : Math.round(n * 100) / 100);

const TABS = [
  ['minmax', 'Min-Max'],
  ['dead', 'Dead Stock'],
  ['inactive', 'ยกเลิกแต่ยังมีของ'],
];

export function rulesText(building, result) {
  const gaps = USAGE_GAPS[building] || [];
  return [
    ['อาคาร', building],
    ['ข้อมูลการเบิก', `ม.ค. 2023 – ${fmtMonthThai(result.endMonth)} (นับตามวันที่ปิดงาน)${gaps.length ? ` · ข้อมูลตกหล่น ${gaps.map(fmtMonthThai).join(', ')} ไม่นับเป็นเดือน` : ''}`],
    ['ใช้ต่อเดือน', `เฉลี่ย ${USAGE_RULES.windowMonths} เดือนล่าสุด (${fmtMonthThai(result.windowFrom)} – ${fmtMonthThai(result.endMonth)} = ${result.windowMonths} เดือนที่มีข้อมูล)`],
    ['สั่งปีละ', `ระบบเสนอ 2 ครั้ง เมื่อใช้ ≥ ${USAGE_RULES.twiceYearlyAt} ต่อปี นอกนั้น 1 ครั้ง (Admin เปลี่ยนรายตัวได้ในเว็บ)`],
    ['Min ใหม่ (เสนอ)', `ปัดขึ้น(ใช้ต่อเดือน × ระยะรอของ ${USAGE_RULES.leadMonths} เดือน) อย่างน้อย 1`],
    ['Max ใหม่ (เสนอ)', `ปัดขึ้น(ใช้ต่อเดือน × 12 ÷ สั่งปีละ + ใช้ต่อเดือน × ${USAGE_RULES.leadMonths}) อย่างน้อย Min + 1`],
    ['ไม่ถูกเบิกใน 24 เดือน', `Min ${USAGE_RULES.idle.min} / Max ${USAGE_RULES.idle.max} (คงของสำรองฉุกเฉิน 1 ชิ้น) — ให้ช่างพิจารณา`],
    ['ไม่คำนวณ', 'รายการยกเลิก และรายการที่หน่วยตอนเบิกไม่ตรง Master (น้ำยา/เกลือ ที่เบิกเป็นลิตร/กก.)'],
    ['ข้อควรระวัง', 'ค่า Min-Max เป็นค่าเสนอเบื้องต้นเท่านั้น ช่างต้องพิจารณาความจำเป็น ของสำรองฉุกเฉิน และพื้นที่จัดเก็บก่อนนำไปใช้'],
    ['วิธีส่งกลับ', 'ช่างแก้ทับในช่องสีเหลือง แล้วส่งไฟล์ให้ Admin นำไปแก้ใน Genedia — นำเข้า Store Part List ครั้งถัดไป ค่าใหม่จะขึ้นในเว็บเอง'],
  ];
}

export default function Review({ params }) {
  const tab = params.tab || 'minmax';
  const { building, byBuilding, taxonomy } = useData();
  const { result, loading, error, hasData } = useUsageStats(building);
  const [group, setGroup] = useState('');
  const [q, setQ] = useState('');
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [openId, setOpenId] = useState(null);
  const rows = byBuilding[building];
  const subName = useMemo(() => Object.fromEntries((taxonomy?.subs || []).map((s) => [s.code, s.name])), [taxonomy]);
  const groups = [...new Set(rows.map((r) => r.group).filter(Boolean))].sort();

  const list = useMemo(() => {
    if (!result) return [];
    const st = (r) => result.stats[r.id];
    let out;
    if (tab === 'minmax') out = rows.filter((r) => r.v.active);
    else if (tab === 'dead') out = rows.filter((r) => isDeadStock(r, st(r)));
    else out = rows.filter((r) => isInactiveWithStock(r));
    const ql = q.trim().toLowerCase();
    out = out.filter((r) => (!group || r.group === group) && (!ql || [r.code, r.v.name].some((s) => s.toLowerCase().includes(ql))));
    if (tab === 'minmax' && onlyDiff) out = out.filter((r) => { const p = st(r)?.proposal; return p && (p.min !== (r.v.min ?? null) || p.max !== (r.v.max ?? null)); });
    const value = (r) => (r.v.stock || 0) * (r.v.unitPrice || 0);
    return out.sort(tab === 'minmax' ? (a, b) => a.code.localeCompare(b.code) : (a, b) => value(b) - value(a));
  }, [result, rows, tab, group, q, onlyDiff]);

  if (!hasData) return <div className="page"><h1>ทบทวน · {building}</h1><Empty>ยังไม่มีข้อมูลการเบิกของอาคาร {building} — นำเข้าไฟล์ประวัติการเบิกก่อน</Empty></div>;
  if (error) return <div className="page"><p className="error">โหลดข้อมูลการเบิกไม่ได้: {error.message}</p></div>;
  if (loading || !result) return <div className="page"><Empty>กำลังคำนวณ…</Empty></div>;

  const S = (r) => result.stats[r.id];
  const totalValue = list.reduce((s, r) => s + (r.v.stock || 0) * (r.v.unitPrice || 0), 0);
  const lastYears = result.years.slice(-4);

  const exportXlsx = async () => {
    const { buildReviewExcel, download } = await import('../lib/excel.js');
    const yearCols = lastYears.map((y) => ({ h: `ใช้ปี ${y}`, k: `y${y}`, w: 9, num: true }));
    const base = (r) => {
      const s = S(r);
      return {
        code: r.code, name: r.v.name, group: r.group, sub: r.sub ? `${r.sub} ${subName[r.sub] || ''}` : '', unit: r.v.unit,
        stock: r.v.stock, min: r.v.min, max: r.v.max, price: r2(r.v.unitPrice), value: r2((r.v.stock || 0) * (r.v.unitPrice || 0)),
        total: s?.total ?? 0, avg: r2(s?.avg), last: s?.last ? fmtIsoDateThai(s.last) : '', since: s?.monthsSinceLast ?? '',
        ...Object.fromEntries(lastYears.map((y) => [`y${y}`, s?.byYear[y] ?? 0])),
      };
    };
    let cfg;
    if (tab === 'minmax') {
      cfg = {
        sheetName: '01_Min-Max Review', file: 'MinMax_Review',
        columns: [
          { h: 'Part Code', k: 'code', w: 16 }, { h: 'ชื่ออะไหล่', k: 'name', w: 42 }, { h: 'Group', k: 'group', w: 18 }, { h: 'หมวดย่อย', k: 'sub', w: 22 },
          { h: 'หน่วย', k: 'unit', w: 8 }, { h: 'คงเหลือ', k: 'stock', w: 9, num: true }, { h: 'Min ปัจจุบัน', k: 'min', w: 9, num: true }, { h: 'Max ปัจจุบัน', k: 'max', w: 9, num: true },
          ...yearCols, { h: `ใช้ต่อเดือน (${USAGE_RULES.windowMonths} เดือนล่าสุด)`, k: 'avg', w: 11, dec: true },
          { h: 'วันที่ใช้ล่าสุด', k: 'last', w: 13 }, { h: 'ไม่ถูกเบิก (เดือน)', k: 'since', w: 9, num: true },
          { h: 'สั่งปีละ (ครั้ง)', k: 'freq', w: 9, num: true }, { h: 'Min ใหม่ (เสนอ)', k: 'pmin', w: 9, num: true }, { h: 'Max ใหม่ (เสนอ)', k: 'pmax', w: 9, num: true },
          { h: 'หมายเหตุระบบ', k: 'note', w: 26, wrap: true }, { h: 'ราคาอ้างอิง/หน่วย (ต้นทุน Genedia)', k: 'price', w: 11, money: true },
          { h: 'Min ใหม่ (ช่างแก้ไข)', k: 'tmin', w: 10, num: true, tech: true }, { h: 'Max ใหม่ (ช่างแก้ไข)', k: 'tmax', w: 10, num: true, tech: true },
          { h: 'หมายเหตุช่าง', k: 'tnote', w: 30, tech: true },
        ],
        rows: list.map((r) => {
          const s = S(r); const p = s?.proposal;
          return {
            ...base(r), freq: s?.freq, pmin: p?.min ?? '', pmax: p?.max ?? '', tmin: p?.min ?? '', tmax: p?.max ?? '',
            note: s?.excludeReason || [p?.idle && 'ไม่ถูกเบิกใน 24 เดือน (คงของสำรอง 1 ชิ้น)', r.orderFreq && `สั่งปีละ ${r.orderFreq} ครั้ง (กำหนดเอง)`].filter(Boolean).join(' · '),
          };
        }),
      };
    } else if (tab === 'dead') {
      cfg = {
        sheetName: '02_Dead Stock Review', file: 'DeadStock_Review',
        columns: [
          { h: 'Part Code', k: 'code', w: 16 }, { h: 'ชื่ออะไหล่', k: 'name', w: 42 }, { h: 'Group', k: 'group', w: 18 }, { h: 'หน่วย', k: 'unit', w: 8 },
          { h: 'คงเหลือ', k: 'stock', w: 9, num: true }, { h: 'ราคาอ้างอิง/หน่วย (ต้นทุน Genedia)', k: 'price', w: 11, money: true }, { h: 'มูลค่าคงเหลือ', k: 'value', w: 13, money: true },
          ...yearCols, { h: 'ใช้รวม (ม.ค. 2023 – ปัจจุบัน)', k: 'total', w: 11, num: true },
          { h: 'ผลการพิจารณา', k: 'tres', w: 22, tech: true }, { h: 'หมายเหตุช่าง', k: 'tnote', w: 30, tech: true },
        ],
        rows: list.map(base),
      };
    } else {
      cfg = {
        sheetName: '03_ยกเลิกมีคงเหลือ', file: 'Inactive_Stock_Review',
        list: ['เก็บไว้ชั่วคราว', 'คืน/ใช้ให้หมด', 'เลิกใช้และจัดการคงเหลือ', 'ขอตรวจสอบเพิ่ม'],
        columns: [
          { h: 'Part Code', k: 'code', w: 16 }, { h: 'ชื่ออะไหล่', k: 'name', w: 42 }, { h: 'Group', k: 'group', w: 18 }, { h: 'หน่วย', k: 'unit', w: 8 },
          { h: 'คงเหลือ', k: 'stock', w: 9, num: true }, { h: 'ราคาอ้างอิง/หน่วย (ต้นทุน Genedia)', k: 'price', w: 11, money: true }, { h: 'มูลค่าคงเหลือ', k: 'value', w: 13, money: true },
          ...yearCols, { h: 'วันที่ใช้ล่าสุด', k: 'last', w: 13 },
          { h: 'ผลการตรวจสอบ', k: 'tres', w: 22, tech: true }, { h: 'หมายเหตุช่าง', k: 'tnote', w: 30, tech: true },
        ],
        rows: list.map(base),
      };
    }
    const buf = await buildReviewExcel({ ...cfg, howto: rulesText(building, result) });
    download(buf, `${cfg.file}_${building}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const openItem = openId && rows.find((r) => r.id === openId);
  return (
    <div className="page">
      <div className="page-head">
        <h1>ทบทวน · อาคาร {building}</h1>
        <div className="seg-tabs">
          {TABS.map(([k, l]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => go('/review', { tab: k })}>{l}</button>)}
        </div>
      </div>
      <p className="muted small">
        {tab === 'minmax' && <>ค่าเสนอคำนวณจากการเบิก {USAGE_RULES.windowMonths} เดือนล่าสุด ({fmtMonthThai(result.windowFrom)} – {fmtMonthThai(result.endMonth)}) · ระยะรอของ {USAGE_RULES.leadMonths} เดือน · เป็นค่าเสนอให้ช่างทบทวนเท่านั้น</>}
        {tab === 'dead' && <>Dead Stock Candidate = ใช้งาน + มีของ + ไม่ถูกเบิกเลยตั้งแต่ ม.ค. 2023 — เป็นรายการให้ตรวจสอบ ไม่ใช่คำสั่งเลิกใช้</>}
        {tab === 'inactive' && <>สถานะยกเลิก (ใน Genedia หรือ Master) แต่ยังมีของคงเหลือ — ให้ตรวจสอบก่อนจัดการยอดคงเหลือ</>}
      </p>
      <div className="filters">
        <input type="search" placeholder="ค้นหา รหัส / ชื่อ" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Group">
          <option value="">ทุก Group</option>
          {groups.map((g) => <option key={g}>{g}</option>)}
        </select>
        {tab === 'minmax' && <label className="inline small"><input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> เฉพาะที่ค่าเสนอต่างจากปัจจุบัน</label>}
        <span className="muted">{list.length.toLocaleString('th-TH')} รายการ{tab !== 'minmax' && ` · มูลค่าคงเหลือ ${fmtNum(Math.round(totalValue))} บาท`}</span>
        {list.length > 0 && <AsyncButton className="btn btn-sm" onClick={exportXlsx}>Export Excel ให้ช่าง</AsyncButton>}
      </div>

      {!list.length ? <Empty>ไม่มีรายการ</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>รหัส</th><th>ชื่อ</th><th>หน่วย</th><th className="num">คงเหลือ</th>
                {tab === 'minmax' ? <>
                  <th className="num">Min/Max ปัจจุบัน</th><th className="num">ใช้/เดือน</th><th className="num">ไม่ถูกเบิก (ด.)</th>
                  <th className="num">สั่งปีละ</th><th className="num">Min/Max เสนอ</th>
                </> : <>
                  <th className="num">ราคาอ้างอิง</th><th className="num">มูลค่า</th><th className="num">ใช้รวม</th><th>ใช้ล่าสุด</th>
                </>}
              </tr>
            </thead>
            <tbody>
              {list.slice(0, 600).map((r) => {
                const s = S(r); const p = s?.proposal;
                const changed = p && (p.min !== (r.v.min ?? null) || p.max !== (r.v.max ?? null));
                return (
                  <tr key={r.id} className="clickable" onClick={() => setOpenId(r.id)}>
                    <td className="mono nowrap">{r.code}</td>
                    <td className="name-cell">{r.v.name}</td>
                    <td>{r.v.unit}</td>
                    <td className="num">{fmtNum(r.v.stock)}</td>
                    {tab === 'minmax' ? <>
                      <td className="num">{fmtNum(r.v.min)} / {fmtNum(r.v.max)}</td>
                      <td className="num">{fmtNum(r2(s?.avg))}</td>
                      <td className="num">{s?.monthsSinceLast ?? <span className="muted">ไม่เคย</span>}</td>
                      <td className="num">{s?.freq}{r.orderFreq && <span className="muted small"> (กำหนด)</span>}</td>
                      <td className="num nowrap">
                        {p ? <b className={changed ? 't-orange' : ''}>{p.min} / {p.max}</b> : <span className="muted small">– {s?.excludeReason}</span>}
                        {p?.idle && <> <Badge color="gray">ไม่ถูกเบิก 24 ด.</Badge></>}
                      </td>
                    </> : <>
                      <td className="num">{fmtNum(r.v.unitPrice)}</td>
                      <td className="num">{fmtNum(Math.round((r.v.stock || 0) * (r.v.unitPrice || 0)))}</td>
                      <td className="num">{fmtNum(s?.total ?? 0)}</td>
                      <td className="small nowrap">{s?.last ? fmtIsoDateThai(s.last) : <span className="muted">–</span>}</td>
                    </>}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {list.length > 600 && <p className="muted">แสดง 600 รายการแรก — Export Excel เพื่อดูทั้งหมด</p>}
        </div>
      )}
      {openItem && <ItemDrawer item={openItem} onClose={() => setOpenId(null)} />}
    </div>
  );
}
