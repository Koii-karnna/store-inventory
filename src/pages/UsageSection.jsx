import { useData } from '../state.jsx';
import { toast } from '../ui.jsx';
import { fmtNum, fmtIsoDateThai, fmtMonthThai } from '../lib/model.js';
import { updateItem } from '../lib/db.js';
import { useUsageStats } from '../lib/usageStore.js';
import { USAGE_RULES } from '../lib/usage.js';

const r2 = (n) => Math.round(n * 100) / 100;

/** ส่วน "การใช้" ในหน้ารายละเอียดรายการ */
export default function UsageSection({ item }) {
  const { isAdmin, user } = useData();
  const { lines, result, loading, error, hasData } = useUsageStats(item.building);
  if (!hasData) return null;
  if (error) return <section><h4>การใช้</h4><p className="error small">โหลดข้อมูลการเบิกไม่ได้</p></section>;
  if (loading || !result) return <section><h4>การใช้</h4><p className="muted">กำลังโหลด…</p></section>;
  const s = result.stats[item.id];
  if (!s) return null;
  const p = s.proposal;
  const recent = lines.filter((l) => l.c === item.code).sort((a, b) => (b.d + (b.f || '')).localeCompare(a.d + (a.f || ''))).slice(0, 10);

  const setFreq = async (v) => {
    const val = v === '' ? null : Number(v);
    if (await updateItem(user, item, { orderFreq: val })) toast('บันทึกความถี่การสั่งแล้ว');
  };

  return (
    <section>
      <h4>การใช้ <small className="muted">(ข้อมูลการเบิกถึง {fmtMonthThai(result.endMonth)})</small></h4>
      <table className="table compact">
        <thead><tr>{result.years.map((y) => <th key={y} className="num">{y + 543}</th>)}<th className="num">รวม</th></tr></thead>
        <tbody><tr>{result.years.map((y) => <td key={y} className="num">{fmtNum(s.byYear[y] || 0)}</td>)}<td className="num"><b>{fmtNum(s.total)}</b></td></tr></tbody>
      </table>
      <dl className="kv" style={{ marginTop: 10 }}>
        <dt>ใช้ต่อเดือน</dt>
        <dd>
          {fmtNum(r2(s.avg))} {s.unitMismatch ? '' : item.v.unit} <span className="muted small">(เฉลี่ย {USAGE_RULES.windowMonths} เดือนล่าสุด)</span>
          {s.unitMismatch && <div className="t-orange small">หน่วยตอนเบิก (ลิตร/กก.) ไม่ตรงกับหน่วยใน Master ({item.v.unit})</div>}
        </dd>
        <dt>ใช้ล่าสุด</dt><dd>{s.last ? `${fmtIsoDateThai(s.last)} (${s.monthsSinceLast} เดือนก่อน)` : 'ไม่เคยถูกเบิกตั้งแต่ ม.ค. 2023'}</dd>
        <dt>พอใช้อีก</dt><dd>{s.monthsCover === null ? '–' : <b className={s.monthsCover < USAGE_RULES.leadMonths ? 't-red' : ''}>{fmtNum(r2(s.monthsCover))} เดือน</b>}</dd>
        <dt>สั่งปีละ</dt>
        <dd>
          {isAdmin ? (
            <select value={item.orderFreq || ''} onChange={(e) => setFreq(e.target.value)}>
              <option value="">อัตโนมัติ ({s.suggestedFreq} ครั้ง)</option>
              <option value="1">1 ครั้ง</option>
              <option value="2">2 ครั้ง</option>
            </select>
          ) : <>{s.freq} ครั้ง {item.orderFreq ? '(กำหนดเอง)' : '(อัตโนมัติ)'}</>}
        </dd>
        <dt>Min/Max เสนอ</dt>
        <dd>
          {p ? <><b>{p.min} / {p.max}</b> <span className="muted small">(ปัจจุบัน {fmtNum(item.v.min)} / {fmtNum(item.v.max)}){p.idle && ' · ไม่ถูกเบิกใน 24 เดือน คงของสำรอง 1 ชิ้น'}</span></>
            : <span className="muted">– {s.excludeReason}</span>}
          <div className="muted small">ค่าเสนอให้ช่างทบทวน — แก้จริงใน Genedia</div>
        </dd>
      </dl>
      {recent.length > 0 && (
        <details>
          <summary>เบิก {recent.length} ครั้งล่าสุด</summary>
          <table className="table compact">
            <thead><tr><th>วันที่</th><th>ใบงาน</th><th className="num">จำนวน</th><th>สถานที่</th></tr></thead>
            <tbody>
              {recent.map((l, i) => (
                <tr key={i} className={l.x ? 'muted' : ''}>
                  <td className="nowrap small">{fmtIsoDateThai(l.d)}</td>
                  <td className="mono small">{l.o}</td>
                  <td className="num">{fmtNum(l.q)}</td>
                  <td className="small">{l.l || ''}{l.x && <div className="t-orange">ไม่นับ: {l.x}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}
