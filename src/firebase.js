import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { firebaseConfig } from './firebase-config.js';

export const configured = !firebaseConfig.apiKey.startsWith('PASTE');

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// เก็บข้อมูลไว้ในเครื่องด้วย ลดการอ่านจาก server (โควตาฟรี 50,000 ครั้ง/วัน)
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// Firebase ใช้อีเมลในการ login จึงแปลง username เป็นอีเมลภายใน (ไม่มีการส่งเมลจริง)
const USER_DOMAIN = 'store-inventory.local';
export const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
export const toEmail = (username) => `${username.trim().toLowerCase()}@${USER_DOMAIN}`;

/** สร้างบัญชีโดยไม่ทำให้ Admin ที่ login อยู่หลุด (ใช้ Firebase app ตัวที่สอง) */
export async function createAuthUser(username, password) {
  const secondary = initializeApp(firebaseConfig, `create-${Date.now()}`);
  try {
    const secAuth = getAuth(secondary);
    const cred = await createUserWithEmailAndPassword(secAuth, toEmail(username), password);
    await signOut(secAuth);
    return cred.user.uid;
  } finally {
    await deleteApp(secondary);
  }
}
