// 端末間同期のマージ処理(通信なし)。
// 項目(記録・引き落とし・目標・予算)ごとに、ローカルとクラウドを突き合わせる。
//  - 前回の同期後に、この端末で追加・変更した項目 → クラウドへ書く(_u = 今の時刻)
//  - この端末で削除した項目 → クラウドに「削除済み(_d)」を書く
//  - この端末で触っていない項目 → クラウドの内容を取り込む(新しい _u のものを優先)
// 別々の端末で追加した記録はどちらも残る。同じ項目を両方で編集した場合だけ、後から同期した方が勝つ。
export const COLS = ['records', 'bills', 'goals', 'budgets', 'templates'];

const stable = v => v && typeof v === 'object'
  ? Array.isArray(v) ? '[' + v.map(stable).join(',') + ']'
    : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'
  : JSON.stringify(v);
const hashOf = it => { const { _u, _d, ...rest } = it; return stable(rest); };

export function createSyncCore({ getData, applyData, loadBase, saveBase, now = () => Date.now() }) {
  return {
    // remote: { records: {id: doc}, ... }。戻り値: クラウドに書くべき [{col, id, doc}]
    reconcile(remote) {
      const data = getData();
      const base = loadBase() || {};
      const newBase = {};
      const writes = [];
      let changed = false;

      // 自動記録(引き落とし)が2台で同じ日に作られて重複したら、小さいidだけ残す
      const keep = new Map();
      for (const r of data.records) {
        if (r.billId == null) continue;
        const k = r.billId + '|' + r.date;
        if (!keep.has(k) || String(r.id) < String(keep.get(k))) keep.set(k, r.id);
      }
      const before = data.records.length;
      data.records = data.records.filter(r => r.billId == null || keep.get(r.billId + '|' + r.date) === r.id);
      if (data.records.length !== before) changed = true;

      for (const col of COLS) {
        const L = new Map((data[col] || []).map(i => [String(i.id), i]));
        const R = remote[col] || {};
        const B = base[col] || {};
        const out = new Map();
        const nb = {};
        for (const id of new Set([...L.keys(), ...Object.keys(R)])) {
          const l = L.get(id), r = R[id], bh = B[id];
          if (l && hashOf(l) !== bh) {
            // この端末で追加・変更した項目
            if (r && !r._d && hashOf(r) === hashOf(l)) l._u = r._u; // 中身が同じなら書かない
            else { l._u = now(); writes.push({ col, id, doc: l }); }
            if (l._u !== undefined) changed = true;
            out.set(id, l); nb[id] = hashOf(l);
          } else if (!l && bh !== undefined) {
            // この端末で削除した項目
            if (r && !r._d) writes.push({ col, id, doc: { id: r.id, _d: true, _u: now() } });
          } else if (r) {
            // この端末で触っていない項目: クラウドを取り込む
            if (r._d) { if (l) changed = true; }
            else if (!l || r._u > (l._u || 0)) {
              const { _d, ...it } = r;
              out.set(id, it); nb[id] = hashOf(it);
              if (!l || hashOf(l) !== hashOf(it) || l._u !== it._u) changed = true;
            } else { out.set(id, l); nb[id] = hashOf(l); }
          } else if (l) {
            // 同期済みのはずがクラウドに無い(書き込み前に閉じた等)→ 書き直す
            if (l._u === undefined) { l._u = now(); changed = true; }
            writes.push({ col, id, doc: l });
            out.set(id, l); nb[id] = hashOf(l);
          }
        }
        data[col] = [...out.values()];
        newBase[col] = nb;
      }
      if (changed) applyData(data);
      saveBase(newBase);
      return writes;
    },
  };
}
