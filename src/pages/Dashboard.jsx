import { useMemo } from 'react';
import { useData } from '../state.jsx';
import { go, Empty } from '../ui.jsx';
import { needsOrder, LEVELS, fmtDateTime } from '../lib/model.js';
import { backupAgeDays, BACKUP_REMIND_DAYS } from './Backup.jsx';

const SEGMENTS = ['out', 'low', 'near', 'ok', 'nomin', 'pending', 'nodata'];
const STALE_DAYS = 7;

export default function Dashboard() {
  const { byBuilding, building, taxonomy, lastImport, isAdmin, backupInfo } = useData();
  const bAge = backupAgeDays(backupInfo);
  const rows = byBuilding[building];
  const active = rows.filter((r) => r.v.active);

  const cards = [
    { label: 'ทั้งหมด', n: rows.length, to: { status: 'all' } },
    { label: 'ใช้งาน', n: active.length, to: {} },
    { label: 'ยกเลิก', n: rows.length - active.length, to: { status: 'inactive' } },
    { label: 'ต้องสั่ง', n: rows.filter((r) => needsOrder(r.lv, r)).length, to: { level: 'need' }, tone: 'orange' },
    { label: 'หมด', n: rows.filter((r) => r.lv === 'out').length, to: { level: 'out' }, tone: 'red' },
    { label: 'ไม่มี Min', n: rows.filter((r) => r.lv === 'nomin').length, to: { level: 'nomin' }, tone: 'gray' },
  ];
  const extra = [
    { label: 'ใกล้ Min', n: rows.filter((r) => r.lv === 'near').length, to: { level: 'near' } },
    { label: 'กำลังสั่ง', n: rows.filter((r) => r.ordering).length, to: { level: 'ordering' } },
    { label: 'รอตรวจ Group', n: rows.filter((r) => r.review).length, to: { level: 'review' } },
    { label: 'รอเพิ่มใน Genedia', n: rows.filter((r) => r.lv === 'pending').length, to: { level: 'pending' } },
    { label: 'ยังไม่มีรูป', n: active.filter((r) => !r.hasImage).length, to: { photo: 'none' } },
  ];

  const byGroup = useMemo(() => {
    const m = {};
    for (const r of active) {
      const g = r.group || 'ไม่ระบุ Group';
      m[g] ??= { group: g, total: 0, ...Object.fromEntries(SEGMENTS.map((s) => [s, 0])) };
      m[g].total++;
      m[g][r.lv]++;
    }
    return Object.values(m).sort((a, b) => b.total - a.total);
  }, [active]);
  const maxTotal = Math.max(1, ...byGroup.map((g) => g.total));

  // CMC: Group เป็นหัวข้อ + แถวหมวดย่อย · NP: แถวละ Group
  const table = useMemo(() => {
    const blank = () => ({ active: 0, inactive: 0, need: 0, out: 0, nomin: 0 });
    const add = (x, r) => {
      if (r.v.active) x.active++; else x.inactive++;
      if (needsOrder(r.lv, r)) x.need++;
      if (r.lv === 'out') x.out++;
      if (r.lv === 'nomin') x.nomin++;
    };
    const subName = Object.fromEntries((taxonomy?.subs || []).map((s) => [s.code, s.name]));
    const groups = {};
    for (const r of rows) {
      const g = r.group || 'ไม่ระบุ Group';
      groups[g] ??= { group: g, ...blank(), subs: {} };
      add(groups[g], r);
      if (building === 'CMC') {
        const key = r.sub || '';
        groups[g].subs[key] ??= { key, name: key ? subName[key] || '' : 'ไม่ระบุหมวดย่อย', ...blank() };
        add(groups[g].subs[key], r);
      }
    }
    const firstSub = (g) => Object.keys(g.subs).filter(Boolean).sort()[0] || 'zz';
    return Object.values(groups)
      .map((g) => ({ ...g, subs: Object.values(g.subs).sort((a, b) => (a.key || 'zz').localeCompare(b.key || 'zz')) }))
      .sort((a, b) => (building === 'CMC' ? firstSub(a).localeCompare(firstSub(b)) : a.group.localeCompare(b.group)));
  }, [rows, building, taxonomy]);

  const nums = (x) => <>
    <td className="num">{x.active}</td>
    <td className="num muted">{x.inactive}</td>
    <td className="num">{x.need > 0 ? <b className="t-orange">{x.need}</b> : 0}</td>
    <td className="num">{x.out > 0 ? <b className="t-red">{x.out}</b> : 0}</td>
    <td className="num muted">{x.nomin}</td>
  </>;

  const imp = lastImport[building];
  const ageDays = imp?.at?.toDate ? (Date.now() - imp.at.toDate().getTime()) / 86400000 : null;

  if (!rows.length) {
    return (
      <Empty>
        ยังไม่มีข้อมูลอาคาร {building}
        {isAdmin && <><br /><a href="#/import">ไปหน้านำเข้าไฟล์ →</a></>}
      </Empty>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Dashboard อาคาร {building}</h1>
        <div className={`freshness ${ageDays === null || ageDays > STALE_DAYS ? 'stale' : ''}`}>
          ข้อมูล Genedia ล่าสุด: {imp ? `${fmtDateTime(imp.at)} โดย ${imp.user}` : 'ยังไม่เคยนำเข้า'}
          {ageDays !== null && ageDays > STALE_DAYS && ` · เกิน ${STALE_DAYS} วันแล้ว ควรนำเข้าใหม่`}
        </div>
      </div>

      {isAdmin && (bAge === null || bAge > BACKUP_REMIND_DAYS) && (
        <p className="warn">
          {bAge === null ? 'ยังไม่เคยสำรองข้อมูล' : `ไม่ได้สำรองข้อมูลมา ${Math.floor(bAge)} วันแล้ว`} — <a href="#/settings">ไปหน้าตั้งค่าเพื่อดาวน์โหลดไฟล์สำรอง →</a>
        </p>
      )}

      <div className="cards">
        {cards.map((c) => (
          <button key={c.label} className={`stat ${c.tone ? `stat-${c.tone}` : ''}`} onClick={() => go('/items', c.to)}>
            <span className="stat-n">{c.n.toLocaleString('th-TH')}</span>
            <span className="stat-l">{c.label}</span>
          </button>
        ))}
      </div>
      <div className="chips">
        {extra.map((c) => (
          <button key={c.label} className="chip" onClick={() => go('/items', c.to)}>{c.label} <b>{c.n}</b></button>
        ))}
      </div>

      <section className="card">
        <h2>สถานะตาม Group <small>(เฉพาะรายการที่ใช้งาน)</small></h2>
        <div className="legend">
          {SEGMENTS.map((s) => <span key={s}><i className={`sw sw-${s}`} />{LEVELS[s].label}</span>)}
        </div>
        <div className="bars">
          {byGroup.map((g) => (
            <button key={g.group} className="bar-row" onClick={() => go('/items', { group: g.group })} title="ดูรายการใน Group นี้">
              <span className="bar-label">{g.group}</span>
              <span className="bar-track">
                <span className="bar-fill" style={{ width: `${(g.total / maxTotal) * 100}%` }}>
                  {SEGMENTS.map((s) => g[s] > 0 && (
                    <span key={s} className={`seg sw-${s}`} style={{ flexGrow: g[s] }} title={`${LEVELS[s].label} ${g[s]}`} />
                  ))}
                </span>
              </span>
              <span className="bar-n">{g.total}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>{building === 'CMC' ? 'ตามหมวดย่อย' : 'ตาม Group'}</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {building === 'CMC' ? <><th>หมวด</th><th>ชื่อหมวดย่อย</th></> : <th>Group</th>}
                <th className="num">ใช้งาน</th><th className="num">ยกเลิก</th>
                <th className="num">ต้องสั่ง</th><th className="num">หมด</th><th className="num">ไม่มี Min</th>
              </tr>
            </thead>
            {building === 'CMC' ? table.map((g) => (
              <tbody key={g.group}>
                <tr className="group-row clickable" onClick={() => go('/items', { group: g.group })}>
                  <td colSpan={2}>{g.group}</td>{nums(g)}
                </tr>
                {g.subs.map((x) => (
                  <tr key={x.key || '-'} className="clickable" onClick={() => go('/items', x.key ? { sub: x.key } : { group: g.group })}>
                    <td className="mono">{x.key || '–'}</td><td>{x.name}</td>{nums(x)}
                  </tr>
                ))}
              </tbody>
            )) : (
              <tbody>
                {table.map((g) => (
                  <tr key={g.group} className="clickable" onClick={() => go('/items', { group: g.group })}>
                    <td>{g.group}</td>{nums(g)}
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
      </section>
    </div>
  );
}
