// โหลดข้อมูลรับเข้าจาก Firestore (เอกสารละอาคาร ใน collection config)
import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase.js';
import { useData } from '../state.jsx';
import { receiveDocId } from './receive.js';

const cache = new Map();
export function clearReceiveCache() { cache.clear(); }

/** ใส่ข้อมูลลง cache โดยตรง (ใช้ในหน้าทดสอบในเครื่อง) */
export function seedReceiveCache(docs) {
  for (const [id, d] of Object.entries(docs)) cache.set(id, Promise.resolve(d));
}

export function loadReceiveDoc(building) {
  const id = receiveDocId(building);
  if (!cache.has(id)) {
    cache.set(id, getDoc(doc(db, 'config', id)).then((s) => (s.exists() ? s.data() : { building, lines: [] }))
      .catch((e) => { cache.delete(id); throw e; }));
  }
  return cache.get(id);
}

/** บรรทัดรับเข้าของอาคาร (โหลดใหม่เมื่อมีการนำเข้า) */
export function useReceiveLines(building) {
  const { receiveMeta } = useData();
  const version = receiveMeta?.version || 0;
  const [state, setState] = useState({ lines: [], loading: true });
  useEffect(() => {
    let live = true;
    if (!version) { setState({ lines: [], loading: false }); return; }
    loadReceiveDoc(building).then((d) => live && setState({ lines: d.lines || [], loading: false }))
      .catch(() => live && setState({ lines: [], loading: false }));
    return () => { live = false; };
  }, [building, version]);
  return state;
}
