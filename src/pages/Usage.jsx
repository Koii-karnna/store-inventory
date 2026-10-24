import { useMemo, useState } from 'react';
import { useData } from '../state.jsx';
import { Empty, Badge, AsyncButton } from '../ui.jsx';
import { fmtNum, fmtDateTime, fmtMonthThai } from '../lib/model.js';
import { useUsageStats } from '../lib/usageStore.js';
import { USAGE_RULES, monthRange, monthOf, assessItem } from '../lib/usage.js';
import { rulesText } from './Review.jsx';
import ItemDrawer from './ItemDrawer.jsx';

const r1 = (n) => (n === null || n === undefined ? null : Math.round(n * 10) / 10);

const STATUS = {
  short: ['ไม่พอ', 'red'],
  maxHigh: ['Max สูงกว่าค่าเสนอมาก', 'yellow'],
  maxLow: ['Max ต่ำกว่าค่าเสนอมาก', 'orange'],
  unit: ['หน่วยตอนเบิกไม่ตรง', 'gray'],
  ok: ['ปกติ', 'green'],
  none: ['–', 'gray'],
};

/** จำนวนที่กำลังสั่งของแต่ละรายการ (จากใบขอซื้อที่ยังกำลังสั่ง) */
export function useOrderingQty(building) {
  const { pos, byBuilding } = useData();
  return useMemo(() => {
    const items = Object.fromEntries(byBuilding[building].map((r) => [r.id, r]));
    const out = {};
    for (const po of pos) {
      if (po.building !== building || po.status !== 'ordering') continue;
      for (const l of po.lines || []) if (items[l.itemId]?.ordering?.poId === po.id) out[l.itemId] = (out[l.itemId] || 0) + (l.qty || 0);
    }
    return out;
  }, [pos, byBuilding, building]);
}

export default function Usage() {
  const { building, byBuilding, usageMeta, isAdmin, taxonomy } = useData();
  const { lines, result, loading, error, hasData } = useUsageStats(building);
  const orderingQty = useOrderingQty(building);
  const [group, setGroup] = useState('');
  const [sub, setSub] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [sort, setSort] = useState({ k: 'avg', dir: -1 });
  const [openId, setOpenId] = useState(null);
  const rows = byBuilding[building];
  const groups = useMemo(() => [...new Set(rows.map((r) => r.group).filter(Boolean))].sort(), [rows]);
  const subs = (taxonomy?.subs || []).filter((s) => s.group === group);
  const subName = useMemo(() => Object.fromEntries((taxonomy?.subs || []).map((s) => [s.code, s.name])), [taxonomy]);

  // รายการในขอบเขตที่เลือก
  const scope = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return rows.filter((r) => (!group || r.group === group) && (!sub || r.sub === sub)
      && (!ql || [r.code, r.v.name].some((s) => s.toLowerCase().includes(ql))));
  }, [rows, group, sub, q]);

  const data = useMemo(() => {
    if (!result) return null;
    const codes = new Set(scope.map((r) => r.code));
    const counted = lines.filter((l) => !l.x && codes.has(l.c));
    const year = Number(result.endMonth.slice(0, 4));
    const yl = counted.filter((l) => Number(l.d.slice(0, 4)) === year);
    const cards = {
      qty: yl.reduce((s, l) => s + l.q, 0), tx: yl.filter((l) => l.q > 0).length,
      items: new Set(yl.map((l) => l.c)).size, value: yl.reduce((s, l) => s + l.q * (l.p || 0), 0),
    };
    const yearTotals = Object.fromEntries(result.years.map((y) => [y, counted.filter((l) => Number(l.d.slice(0, 4)) === y).reduce((s, l) => s + l.q, 0)]));
    const months = monthRange(result.windowFrom, result.endMonth);
    const monthly = Object.fromEntries(months.map((m) => [m, 0]));
    for (const l of counted) { const m = monthOf(l.d); if (m in monthly) monthly[m] += l.q; }
    // ตารางวิเคราะห์
    const table = scope.filter((r) => showInactive || r.v.active).map((r) => {
      const s = result.stats[r.id];
      const a = assessItem(r, s, orderingQty[r.id] || 0);
      return { r, s, ...a };
    });
    return { year, cards, yearTotals, months, monthly, table };
  }, [result, lines, scope, showInactive, orderingQty]);

  const sorted = useMemo(() => {
    if (!data) return [];
    const val = {
      code: (x) => x.r.code, avg: (x) => x.s?.avg ?? -1, stock: (x) => x.r.v.stock ?? -1, cover: (x) => x.s?.monthsCover ?? Infinity,
      suggest: (x) => x.suggest ?? -1, last: (x) => x.s?.monthsSinceLast ?? 9999,
    }[sort.k];
    const list = data.table.filter((x) => !status || x.status === status);
    return list.sort((a, b) => { const va = val(a), vb = val(b); return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir || a.r.code.localeCompare(b.r.code); });
  }, [data, sort, status]);

  if (!hasData) {
    return <div className="page"><h1>การใช้อะไหล่ · {building}</h1><Empty>ยังไม่มีข้อมูลการเบิกของอาคาร {building}{isAdmin && <><br /><a href="#/import">นำเข้าไฟล์ประวัติการเบิก / Part Usage Report →</a></>}</Empty></div>;
  }
  if (error) return <div className="page"><p className="error">โหลดข้อมูลการเบิกไม่ได้: {error.message}</p></div>;
  if (loading || !data) return <div className="page"><Empty>กำลังโหลดข้อมูลการเบิก…</Empty></div>;

  const maxYear = Math.max(1, ...Object.values(data.yearTotals));
  const maxMonth = Math.max(1, ...data.months.map((m) => data.monthly[m]));
  const gaps = new Set(result.gaps);
  const lastImp = usageMeta?.lastImport;
  const scopeLabel = sub ? `${sub} ${subName[sub] || ''}` : group || 'ทุก Group';
  const statusCount = data.table.reduce((c, x) => ({ ...c, [x.status]: (c[x.status] || 0) + 1 }), {});
  const th = (k, label, cls = 'num') => (
    <th className={`sortable ${cls}`} onClick={() => setSort((s) => ({ k, dir: s.k === k ? -s.dir : k === 'code' ? 1 : -1 }))}>
      {label}{sort.k === k && (sort.dir > 0 ? ' ▲' : ' ▼')}
    </th>
  );

  const exportXlsx = async () => {
    const { buildReviewExcel, download } = await import('../lib/excel.js');
    const ys = result.years;
    const columns = [
      { h: 'Part Code', k: 'code', w: 16 }, { h: 'ชื่ออะไหล่', k: 'name', w: 42 }, { h: 'Group', k: 'group', w: 18 }, { h: 'หมวดย่อย', k: 'sub', w: 22 }, { h: 'หน่วย', k: 'unit', w: 8 },
      ...ys.map((y) => ({ h: `ใช้ปี ${y}`, k: `y${y}`, w: 9, num: true })),
      { h: `ใช้/เดือน (${USAGE_RULES.windowMonths} เดือนล่าสุด)`, k: 'avg', w: 11, dec: true }, { h: 'คงเหลือ', k: 'stock', w: 9, num: true }, { h: 'กำลังสั่ง', k: 'ordering', w: 9, num: true },
      { h: 'Min ปัจจุบัน', k: 'min', w: 9, num: true }, { h: 'Max ปัจจุบัน', k: 'max', w: 9, num: true }, { h: 'สั่งปีละ', k: 'freq', w: 8, num: true },
      { h: 'Min เสนอ', k: 'pmin', w: 9, num: true }, { h: 'Max เสนอ', k: 'pmax', w: 9, num: true }, { h: 'ควรสั่ง (ถึง Max เสนอ)', k: 'suggest', w: 11, num: true },
      { h: 'พอใช้ (เดือน)', k: 'cover', w: 9, dec: true }, { h: 'ไม่ถูกเบิก (เดือน)', k: 'since', w: 9, num: true }, { h: 'สถานะ', k: 'status', w: 22 },
    ];
    const out = sorted.map(({ r, s, suggest, status: st }) => ({
      code: r.code, name: r.v.name, group: r.group, sub: r.sub ? `${r.sub} ${subName[r.sub] || ''}` : '', unit: r.v.unit,
      ...Object.fromEntries(ys.map((y) => [`y${y}`, s?.byYear[y] ?? 0])), avg: s ? Math.round(s.avg * 100) / 100 : '', stock: r.v.stock,
      ordering: orderingQty[r.id] || '', min: r.v.min, max: r.v.max, freq: s?.freq, pmin: s?.proposal?.min ?? '', pmax: s?.proposal?.max ?? '',
      suggest: suggest ?? '', cover: s?.monthsCover === null || s?.monthsCover === undefined ? '' : Math.round(s.monthsCover * 10) / 10,
      since: s?.monthsSinceLast ?? 'ไม่เคย', status: STATUS[st][0],
    }));
    const buf = await buildReviewExcel({ sheetName: 'วิเคราะห์การใช้', columns, rows: out, howto: [['ขอบเขต', scopeLabel], ...rulesText(building, result)] });
    download(buf, `วิเคราะห์การใช้_${building}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const openItem = openId && rows.find((r) => r.id === openId);
  return (
    <div className="page">
      <div className="page-head">
        <h1>การใช้อะไหล่ · อาคาร {building}</h1>
        <div className="freshness">ข้อมูลการเบิกถึง {fmtMonthThai(result.endMonth)}{lastImp?.at && ` · นำเข้าล่าสุด ${fmtDateTime(lastImp.at)} โดย ${lastImp.by}`}</div>
      </div>

      <div className="filters">
        <select value={group} onChange={(e) => { setGroup(e.target.value); setSub(''); }} aria-label="Group">
          <option value="">ทุก Group</option>
          {groups.map((g) => <option key={g}>{g}</option>)}
        </select>
        {building === 'CMC' && (
          <select value={sub} onChange={(e) => setSub(e.target.value)} disabled={!group} aria-label="หมวดย่อย">
            <option value="">ทุกหมวดย่อย</option>
            {subs.map((s) => <option key={s.code} value={s.code}>{s.code} {s.name}</option>)}
          </select>
        )}
        <input type="search" placeholder="ค้นหา รหัส / ชื่อ" value={q} onChange={(e) => setQ(e.target.value)} />
        {(group || q) && <button className="btn btn-ghost btn-sm" onClick={() => { setGroup(''); setSub(''); setQ(''); }}>ล้างตัวกรอง</button>}
      </div>

      <div className="cards cards-4">
        <div className="stat"><span className="stat-n">{fmtNum(r1(data.cards.qty))}</span><span className="stat-l">จำนวนเบิกปี {data.year + 543} · {scopeLabel}</span></div>
        <div className="stat"><span className="stat-n">{fmtNum(data.cards.tx)}</span><span className="stat-l">ครั้งการเบิก ปี {data.year + 543}</span></div>
        <div className="stat"><span className="stat-n">{fmtNum(data.cards.items)}</span><span className="stat-l">รายการที่ถูกเบิก ปี {data.year + 543}</span></div>
        <div className="stat"><span className="stat-n">{fmtNum(Math.round(data.cards.value))}</span><span className="stat-l">มูลค่าการเบิก (บาท · ราคาในใบงาน)</span></div>
      </div>

      <div className="usage-charts">
        <section className="card">
          <h2>รายปี <small>({scopeLabel} · ปี {result.years[result.years.length - 1] + 543} ถึง {fmtMonthThai(result.endMonth)})</small></h2>
          <div className="vbars">
            {result.years.map((y) => (
              <div key={y} className="vbar">
                <span className="vbar-n">{fmtNum(r1(data.yearTotals[y]))}</span>
                <span className="vbar-fill" style={{ height: `${(data.yearTotals[y] / maxYear) * 100}%` }} />
                <span className="vbar-l">{y + 543}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="card">
          <h2>รายเดือน {USAGE_RULES.windowMonths} เดือนล่าสุด</h2>
          <div className="vbars vbars-months">
            {data.months.map((m) => (
              <div key={m} className={`vbar ${gaps.has(m) ? 'vbar-gap' : ''}`} title={gaps.has(m) ? 'ข้อมูลตกหล่น' : `${fmtMonthThai(m)}: ${r1(data.monthly[m])}`}>
                <span className="vbar-n">{gaps.has(m) || !data.monthly[m] ? '' : fmtNum(r1(data.monthly[m]))}</span>
                <span className="vbar-fill" style={{ height: gaps.has(m) ? '100%' : `${(data.monthly[m] / maxMonth) * 100}%` }} />
                <span className="vbar-l">{fmtMonthThai(m).replace(' ', '\n')}</span>
              </div>
            ))}
          </div>
          {result.gaps.length > 0 && <p className="muted small">ช่องลาย = ข้อมูลตกหล่น ไม่นับเป็นเดือนในค่าเฉลี่ย</p>}
        </section>
      </div>

      <section className="card">
        <h2>วิเคราะห์รายการ <small>({scopeLabel} · คลิกรายการเพื่อดูกราฟรายเดือนย้อนหลัง)</small></h2>
        <div className="filters">
          <div className="chips">
            <button className={`chip ${!status ? 'chip-on' : ''}`} onClick={() => setStatus('')}>ทั้งหมด <b>{data.table.length}</b></button>
            {['short', 'maxLow', 'maxHigh', 'ok', 'unit'].filter((k) => statusCount[k]).map((k) => (
              <button key={k} className={`chip ${status === k ? 'chip-on' : ''}`} onClick={() => setStatus(k)}>{STATUS[k][0]} <b>{statusCount[k]}</b></button>
            ))}
          </div>
          <label className="inline small"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> รวมรายการยกเลิก</label>
          <AsyncButton className="btn btn-sm" onClick={exportXlsx} disabled={!sorted.length}>Export Excel</AsyncButton>
        </div>
        <p className="muted small">
          ควรสั่ง = Max เสนอ − คงเหลือ − กำลังสั่ง · ไม่พอ = พอใช้น้อยกว่าระยะรอของ {USAGE_RULES.leadMonths} เดือน ·
          Max สูง/ต่ำกว่าค่าเสนอมาก = ต่างกันเกิน 1.5 เท่า / ต่ำกว่าครึ่ง · ค่าเสนอยังไม่ผ่านการทบทวนจากช่าง
        </p>
        {!sorted.length ? <Empty>ไม่มีรายการ</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {th('code', 'รหัส / ชื่อ', '')}
                  {result.years.map((y) => <th key={y} className="num">{y + 543}</th>)}
                  {th('avg', 'ใช้/เดือน')}
                  {th('stock', 'คงเหลือ')}
                  <th className="num">กำลังสั่ง</th>
                  <th className="num">Min/Max<br />ปัจจุบัน</th>
                  <th className="num">Min/Max<br />เสนอ</th>
                  {th('suggest', 'ควรสั่ง')}
                  {th('cover', 'พอใช้ (ด.)')}
                  {th('last', 'ไม่ถูกเบิก (ด.)')}
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {sorted.slice(0, 500).map(({ r, s, suggest, status: st }) => (
                  <tr key={r.id} className="clickable" onClick={() => setOpenId(r.id)}>
                    <td className="name-cell"><span className="mono small">{r.code}</span><div>{r.v.name}</div><span className="muted small">{r.v.unit}{!r.v.active && ' · ยกเลิก'}</span></td>
                    {result.years.map((y) => <td key={y} className="num muted">{fmtNum(s?.byYear[y] ?? 0)}</td>)}
                    <td className="num"><b>{fmtNum(r1(s?.avg))}</b></td>
                    <td className="num">{fmtNum(r.v.stock)}</td>
                    <td className="num">{orderingQty[r.id] ? <Badge color="blue">{orderingQty[r.id]}</Badge> : ''}</td>
                    <td className="num nowrap">{fmtNum(r.v.min)} / {fmtNum(r.v.max)}</td>
                    <td className="num nowrap">{s?.proposal ? `${s.proposal.min} / ${s.proposal.max}` : <span className="muted small">–</span>}</td>
                    <td className="num"><b>{suggest ? fmtNum(suggest) : suggest === 0 ? '0' : '–'}</b></td>
                    <td className="num">{s?.monthsCover === null || s?.monthsCover === undefined ? '–' : fmtNum(r1(s.monthsCover))}</td>
                    <td className="num">{s?.monthsSinceLast ?? <span className="muted small">ไม่เคย</span>}</td>
                    <td><Badge color={STATUS[st][1]}>{STATUS[st][0]}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sorted.length > 500 && <p className="muted">แสดง 500 รายการแรก — กรองเพิ่มหรือ Export Excel</p>}
          </div>
        )}
      </section>
      {openItem && <ItemDrawer item={openItem} onClose={() => setOpenId(null)} />}
    </div>
  );
}
