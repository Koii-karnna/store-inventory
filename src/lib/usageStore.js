// โหลดข้อมูลการเบิกจาก Firestore (เอกสารละ อาคาร-ปี ใน collection config) แล้วคำนวณสถิติ
import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase.js';
import { useData } from '../state.jsx';
import { usageDocId, usageStats } from './usage.js';

const cache = new Map(); // docId → Promise<{building, lines}>

export function clearUsageCache() { cache.clear(); }

/** ใส่ข้อมูลลง cache โดยตรง (ใช้ในหน้าทดสอบในเครื่อง) */
export function seedUsageCache(docs) {
  for (const [id, d] of Object.entries(docs)) cache.set(id, Promise.resolve(d));
}

export function loadUsageDoc(building, year) {
  const id = usageDocId(building, year);
  if (!cache.has(id)) {
    cache.set(id, getDoc(doc(db, 'config', id)).then((s) => (s.exists() ? s.data() : { building, year, lines: [] }))
      .catch((e) => { cache.delete(id); throw e; }));
  }
  return cache.get(id);
}

/** โหลดทุกปีของอาคาร → {lines, loading, error} (version เปลี่ยนเมื่อมีการนำเข้าใหม่) */
export function useUsageLines(building) {
  const { usageMeta } = useData();
  const years = usageMeta?.years?.[building] || [];
  const version = usageMeta?.version || 0;
  const [state, setState] = useState({ lines: [], loading: true, error: null });
  useEffect(() => {
    let live = true;
    if (!years.length) { setState({ lines: [], loading: false, error: null }); return; }
    setState((s) => ({ ...s, loading: true }));
    Promise.all(years.map((y) => loadUsageDoc(building, y)))
      .then((docs) => live && setState({ lines: docs.flatMap((d) => d.lines || []), loading: false, error: null }))
      .catch((e) => live && setState({ lines: [], loading: false, error: e }));
    return () => { live = false; };
  }, [building, years.join(','), version]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

/** สถิติการเบิกของอาคารที่เลือก (รวม Min/Max เสนอ) */
export function useUsageStats(building) {
  const { byBuilding, usageMeta } = useData();
  const { lines, loading, error } = useUsageLines(building);
  const result = useMemo(() => {
    if (loading || error) return null;
    return usageStats(building, lines, byBuilding[building], new Set(usageMeta?.noMinMax || []));
  }, [building, lines, loading, error, byBuilding, usageMeta]);
  return { lines, loading, error, result, hasData: (usageMeta?.years?.[building] || []).length > 0 };
}
