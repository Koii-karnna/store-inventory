import { useMemo, useState } from 'react';
import { useData } from '../state.jsx';
import { Empty } from '../ui.jsx';
import { fmtNum, fmtDateTime, fmtMonthThai } from '../lib/model.js';
import { useUsageStats } from '../lib/usageStore.js';
import { USAGE_RULES, monthRange, monthOf } from '../lib/usage.js';
import ItemDrawer from './ItemDrawer.jsx';

const r1 = (n) => Math.round(n * 10) / 10;

export default function Usage() {
  const { building, byBuilding, usageMeta, isAdmin } = useData();
  const { lines, result, loading, error, hasData } = useUsageStats(building);
  const [openId, setOpenId] = useState(null);
  const rows = byBuilding[building];
  const itemById = useMemo(() => Object.fromEntries(rows.map((r) => [r.code, r])), [rows]);

  const data = useMemo(() => {
    if (!result) return null;
    const counted = lines.filter((l) => !l.x);
    const year = Number(result.endMonth.slice(0, 4));
    const yl = counted.filter((l) => Number(l.d.slice(0, 4)) === year);
    const cards = {
      qty: yl.reduce((s, l) => s + l.q, 0),
      tx: yl.filter((l) => l.q > 0).length,
      items: new Set(yl.map((l) => l.c)).size,
      value: yl.reduce((s, l) => s + l.q * (l.p || 0), 0),
    };
    // รายปี × Group
    const groupOf = (c) => itemById[c]?.group || 'ไม่ระบุ Group';
    const byGroupYear = {};
    for (const l of counted) {
      const g = groupOf(l.c), y = Number(l.d.slice(0, 4));
      byGroupYear[g] ??= {};
      byGroupYear[g][y] = (byGroupYear[g][y] || 0) + l.q;
    }
    const yearTotals = Object.fromEntries(result.years.map((y) => [y, counted.filter((l) => Number(l.d.slice(0, 4)) === y).reduce((s, l) => s + l.q, 0)]));
    const groupRows = Object.entries(byGroupYear).map(([g, ys]) => ({ g, ys, total: Object.values(ys).reduce((a, b) => a + b, 0) })).sort((a, b) => b.total - a.total);
    // รายเดือน 24 เดือนล่าสุด
    const months = monthRange(result.windowFrom, result.endMonth);
    const monthly = Object.fromEntries(months.map((m) => [m, { qty: 0, tx: 0 }]));
    for (const l of counted) { const m = monthOf(l.d); if (monthly[m]) { monthly[m].qty += l.q; if (l.q > 0) monthly[m].tx++; } }
    // อันดับ 24 เดือนล่าสุด
    const top = rows.map((r) => ({ r, s: result.stats[r.id] })).filter((x) => x.s && x.s.avg > 0 && !x.s.unitMismatch)
      .sort((a, b) => b.s.avg - a.s.avg).slice(0, 20);
    return { year, cards, groupRows, yearTotals, months, monthly, top };
  }, [result, lines, rows, itemById]);

  if (!hasData) {
    return <div className="page"><h1>การใช้อะไหล่ · {building}</h1><Empty>ยังไม่มีข้อมูลการเบิกของอาคาร {building}{isAdmin && <><br /><a href="#/import">นำเข้าไฟล์ประวัติการเบิก / Part Usage Report →</a></>}</Empty></div>;
  }
  if (error) return <div className="page"><p className="error">โหลดข้อมูลการเบิกไม่ได้: {error.message}</p></div>;
  if (loading || !data) return <div className="page"><Empty>กำลังโหลดข้อมูลการเบิก…</Empty></div>;

  const maxYear = Math.max(1, ...Object.values(data.yearTotals));
  const maxMonth = Math.max(1, ...data.months.map((m) => data.monthly[m].qty));
  const gaps = new Set(result.gaps);
  const lastImp = usageMeta?.lastImport;
  const openItem = openId && rows.find((r) => r.id === openId);

  return (
    <div className="page">
      <div className="page-head">
        <h1>การใช้อะไหล่ · อาคาร {building}</h1>
        <div className="freshness">
          ข้อมูลการเบิกถึง {fmtMonthThai(result.endMonth)}{lastImp?.at && ` · นำเข้าล่าสุด ${fmtDateTime(lastImp.at)} โดย ${lastImp.by}`}
        </div>
      </div>

      <div className="cards cards-4">
        <div className="stat"><span className="stat-n">{fmtNum(r1(data.cards.qty))}</span><span className="stat-l">จำนวนเบิกปี {data.year + 543} (รวมทุกหน่วย)</span></div>
        <div className="stat"><span className="stat-n">{fmtNum(data.cards.tx)}</span><span className="stat-l">ครั้งการเบิก ปี {data.year + 543}</span></div>
        <div className="stat"><span className="stat-n">{fmtNum(data.cards.items)}</span><span className="stat-l">รายการที่ถูกเบิก ปี {data.year + 543}</span></div>
        <div className="stat"><span className="stat-n">{fmtNum(Math.round(data.cards.value))}</span><span className="stat-l">มูลค่าการเบิก (บาท · ราคาในใบงาน)</span></div>
      </div>

      <section className="card">
        <h2>จำนวนเบิกรายปี <small>(นับตามวันที่ปิดงาน · ปี {result.years[result.years.length - 1] + 543} ถึง {fmtMonthThai(result.endMonth)})</small></h2>
        <div className="vbars">
          {result.years.map((y) => (
            <div key={y} className="vbar">
              <span className="vbar-n">{fmtNum(r1(data.yearTotals[y]))}</span>
              <span className="vbar-fill" style={{ height: `${(data.yearTotals[y] / maxYear) * 100}%` }} />
              <span className="vbar-l">{y + 543}</span>
            </div>
          ))}
        </div>
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>Group</th>{result.years.map((y) => <th key={y} className="num">{y + 543}</th>)}<th className="num">รวม</th></tr></thead>
            <tbody>
              {data.groupRows.map((g) => (
                <tr key={g.g}><td>{g.g}</td>{result.years.map((y) => <td key={y} className="num">{fmtNum(r1(g.ys[y] || 0))}</td>)}<td className="num"><b>{fmtNum(r1(g.total))}</b></td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">จำนวนรวมทุกหน่วย — กลุ่มน้ำยา/เกลือ (เช่น CMC-CHEMICAL) บางรายการบันทึกการเบิกเป็นลิตร/กก. ตัวเลขจึงสูงกว่าหน่วยนับใน Master</p>
      </section>

      <section className="card">
        <h2>รายเดือน {USAGE_RULES.windowMonths} เดือนล่าสุด</h2>
        <div className="vbars vbars-months">
          {data.months.map((m) => (
            <div key={m} className={`vbar ${gaps.has(m) ? 'vbar-gap' : ''}`} title={gaps.has(m) ? 'ข้อมูลตกหล่น' : `${data.monthly[m].qty} (${data.monthly[m].tx} ครั้ง)`}>
              <span className="vbar-n">{gaps.has(m) ? '' : fmtNum(r1(data.monthly[m].qty))}</span>
              <span className="vbar-fill" style={{ height: gaps.has(m) ? '100%' : `${(data.monthly[m].qty / maxMonth) * 100}%` }} />
              <span className="vbar-l">{fmtMonthThai(m).replace(' ', '\n')}</span>
            </div>
          ))}
        </div>
        {result.gaps.length > 0 && <p className="muted small">ช่องลาย = ข้อมูลตกหล่น ({result.gaps.map(fmtMonthThai).join(', ')}) ไม่นับเป็นเดือนในค่าเฉลี่ย</p>}
      </section>

      <section className="card">
        <h2>อะไหล่ที่ใช้มากที่สุด 20 อันดับ <small>(ใช้ต่อเดือน เฉลี่ย {USAGE_RULES.windowMonths} เดือนล่าสุด · ไม่รวมน้ำยา/เกลือที่หน่วยตอนเบิกไม่ตรง Master)</small></h2>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>#</th><th>รหัส</th><th>ชื่อ</th><th>หน่วย</th><th className="num">ใช้/เดือน</th><th className="num">ครั้งเบิก (ทั้งหมด)</th><th className="num">คงเหลือ</th><th className="num">พอใช้ (เดือน)</th></tr></thead>
            <tbody>
              {data.top.map(({ r, s }, i) => (
                <tr key={r.id} className="clickable" onClick={() => setOpenId(r.id)}>
                  <td>{i + 1}</td>
                  <td className="mono nowrap">{r.code}</td>
                  <td className="name-cell">{r.v.name}</td>
                  <td>{r.v.unit}</td>
                  <td className="num"><b>{fmtNum(r1(s.avg))}</b></td>
                  <td className="num">{fmtNum(s.tx)}</td>
                  <td className="num">{fmtNum(r.v.stock)}</td>
                  <td className="num">{s.monthsCover === null ? '–' : <span className={s.monthsCover < USAGE_RULES.leadMonths ? 't-red' : ''}>{fmtNum(r1(s.monthsCover))}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {openItem && <ItemDrawer item={openItem} onClose={() => setOpenId(null)} />}
    </div>
  );
}
