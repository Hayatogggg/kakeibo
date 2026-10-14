// Firebase(メール/パスワード認証 + Firestore)との接続。マージ処理は syncCore.js。
// データの置き場所: users/{uid}/{records|bills|goals|budgets}/{id}
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, collection, onSnapshot, writeBatch, doc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { createSyncCore, COLS } from './syncCore.js';

export function start(cfg, bridge) {
  const app = initializeApp(cfg);
  const auth = getAuth(app);
  const db = getFirestore(app);
  let uid = null, remote = {}, ready = new Set(), unsubs = [], timer = null, running = false, again = false;

  const baseKey = () => `kakeibo.sync.base.v1:${uid}`;
  const core = createSyncCore({
    getData: bridge.getData,
    applyData: bridge.applyData,
    loadBase: () => { try { return JSON.parse(localStorage.getItem(baseKey())); } catch { return null; } },
    saveBase: b => localStorage.setItem(baseKey(), JSON.stringify(b)),
  });

  const time = () => new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

  async function run() {
    if (!uid || ready.size < COLS.length) return;
    if (running) { again = true; return; }
    running = true;
    try {
      const writes = core.reconcile(remote);
      for (let i = 0; i < writes.length; i += 400) {
        const batch = writeBatch(db);
        for (const w of writes.slice(i, i + 400)) {
          batch.set(doc(db, 'users', uid, w.col, String(w.id)), JSON.parse(JSON.stringify(w.doc)));
        }
        await batch.commit();
      }
      bridge.setStatus(`同期済み(${time()})`);
    } catch (e) {
      bridge.setStatus(navigator.onLine ? `同期エラー: ${e.code || e.message}` : 'オフライン(戻ったら自動で同期します)');
    } finally {
      running = false;
      if (again) { again = false; schedule(); }
    }
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(run, 400); };

  bridge.onChange(schedule);
  window.addEventListener('online', schedule);

  onAuthStateChanged(auth, user => {
    unsubs.forEach(f => f());
    unsubs = []; remote = {}; ready = new Set();
    uid = user ? user.uid : null;
    bridge.setUser(user ? user.email : null);
    if (!user) return bridge.setStatus('未ログイン');
    bridge.setStatus('同期中…');
    for (const col of COLS) {
      unsubs.push(onSnapshot(collection(db, 'users', uid, col), snap => {
        const m = {};
        snap.forEach(d => { m[d.id] = d.data(); });
        remote[col] = m; ready.add(col); schedule();
      }, err => bridge.setStatus(`同期エラー: ${err.code}`)));
    }
  });

  bridge.setActions({
    login: (email, pw) => signInWithEmailAndPassword(auth, email, pw),
    signup: (email, pw) => createUserWithEmailAndPassword(auth, email, pw),
    logout: () => signOut(auth),
  });
}
