'use strict';
const CATS = {
  out: [['食費','🍚'],['日用品','🧻'],['交通費','🚃'],['住居・光熱費','🏠'],['通信費','📱'],['娯楽','🎮'],['衣服・美容','👕'],['医療','💊'],['交際費','🍻'],['その他','📦']],
  in: [['給与','💴'],['賞与','🎁'],['副収入','💼'],['その他','📦']]
};
// 支払い方法。未設定の支出は現金扱い(目標のゲージには現金払いの支出だけ反映する)
// カードの引き落としは「現金」で記録する(買った時点ではなく、引き落とし時点でゲージから引く)。旧「口座引落」は現金扱い。
const PAYS = ['現金', 'クレジットカード', '電子マネー・QR', 'その他'];
const payOf = r => !r.pay || r.pay === '口座引落' ? '現金' : r.pay;
const payOptions = sel => PAYS.map(p => `<option${p === sel ? ' selected' : ''}>${p}</option>`).join('');
const KEY = 'kakeibo.records.v1';
const $ = id => document.getElementById(id);
const ymOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const yen =n => '¥' + Math.round(n).toLocaleString('ja-JP');
const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

let records = [];
try { records = JSON.parse(localStorage.getItem(KEY)) || []; } catch { records = []; }
const notifyChange = () => window.kakeiboStore && window.kakeiboStore.onChange && window.kakeiboStore.onChange(); // 同期に変更を知らせる
const save = () => { localStorage.setItem(KEY, JSON.stringify(records)); notifyChange(); };

// 予算は月ごとに保存: { 'YYYY-MM': { total, cats } }。未設定の月は直前に設定した月を引き継ぐ。
// '0000-00' は旧バージョン(全月共通)からの移行用。
const BKEY = 'kakeibo.budget.v2';
let budgets = {};
try {
  budgets = JSON.parse(localStorage.getItem(BKEY));
  if (!budgets) {
    const old = JSON.parse(localStorage.getItem('kakeibo.budget.v1'));
    budgets = old ? { '0000-00': old } : {};
  }
} catch { budgets = {}; }
const budgetFor = ym => {
  const k = Object.keys(budgets).filter(k => k <= ym).sort().pop();
  return k ? { total: 0, cats: {}, ...budgets[k] } : { total: 0, cats: {} };
};

let view = new Date(); view.setDate(1);
let editingId = null;
let selected = null; // 選択中の日付 (YYYY-MM-DD)
const short = n => n >= 10000 ? (Math.round(n / 1000) / 10) + '万' : n.toLocaleString('ja-JP');

const icon = (type, cat) => (CATS[type].find(c => c[0] === cat) || [0, '📦'])[1];
const esc = s => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function render() {
  const ym = ymOf(view);
  $('month').textContent = `${view.getFullYear()}年${view.getMonth() + 1}月`;
  let rs = records.filter(r => r.date.startsWith(ym)).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const monthRs = rs;
  const sum = t => monthRs.filter(r => r.type === t).reduce((s, r) => s + r.amount, 0);
  const inc = sum('in'), out = sum('out');
  $('sumIn').textContent = yen(inc); // 見込収入を含む
  const cashOut = monthRs.filter(r => r.type === 'out' && payOf(r) === '現金').reduce((s, r) => s + r.amount, 0);
  $('sumCash').hidden = !out;
  $('sumCash').textContent = `うち現金 ${yen(cashOut)}`;
  const expSum =monthRs.filter(r => r.type === 'in' && r.expected).reduce((s, r) => s + r.amount, 0);
  $('sumExp').hidden = !expSum;
  $('sumExp').textContent = `うち見込 ${yen(expSum)}`;
  $('sumOut').textContent = yen(out);
  const bal = $('sumBal');
  bal.textContent = (inc - out < 0 ? '-' : '') + yen(Math.abs(inc - out));
  bal.className = inc - out < 0 ? 'out' : 'in';

  renderGoals();

  // これまでの合計(全期間)
  const allIn = records.filter(r => r.type === 'in').reduce((s, r) => s + r.amount, 0);
  const allOut = records.filter(r => r.type === 'out').reduce((s, r) => s + r.amount, 0);
  $('allIn').textContent = yen(allIn);
  $('allOut').textContent = yen(allOut);
  $('allBal').textContent = (allIn - allOut < 0 ? '-' : '') + yen(Math.abs(allIn - allOut));
  $('allBal').className = allIn - allOut < 0 ? 'out' : 'in';
  const firstDate = records.reduce((m, r) => !m || r.date < m ? r.date : m, '');
  $('allTitle').textContent = firstDate ? `これまでの合計(${firstDate.replace(/-/g, '/')}〜)` : 'これまでの合計';

  // カテゴリ別支出
  const by = {};
  monthRs.filter(r => r.type === 'out').forEach(r => by[r.category] = (by[r.category] || 0) + r.amount);
  const budget = budgetFor(ym);
  const bar = (label, spent, budget, cls = '') => {
    const p = budget ? spent / budget : 0;
    const state = !budget ? '' : p > 1 ? ' over' : p >= 0.8 ? ' warn' : '';
    const right = budget ? `${yen(spent)} / ${yen(budget)}` : `${yen(spent)} (${Math.round(spent / out * 100)}%)`;
    const rest = budget ? `<div class="rest">${p > 1 ? `${yen(spent - budget)} 超過` : `残り ${yen(budget - spent)}`}(${Math.round(p * 100)}%)</div>` : '';
    const w = budget ? Math.min(p, 1) * 100 : spent / out * 100;
    return `<div class="bar${cls}${state}"><div class="row"><span>${label}</span><span>${right}</span></div><div class="track${cls ? ' big' : ''}"><div class="fill" style="width:${w}%"></div></div>${rest}</div>`;
  };
  const names = [...new Set([...Object.keys(by), ...Object.keys(budget.cats).filter(c => budget.cats[c] > 0)])];
  const rows = names.sort((a, b) => (by[b] || 0) - (by[a] || 0));
  $('cats').innerHTML = '<h2 class="bh"><span>予算と支出</span><button id="bset">予算設定</button></h2>' +
    (budget.total > 0 ? bar('月の支出', out, budget.total, ' total') : '') +
    rows.map(c => bar(`${icon('out', c)} ${esc(c)}`, by[c] || 0, budget.cats[c] || 0)).join('') +
    (!rows.length && !(budget.total > 0) ? '<p class="hint">支出はまだありません</p>' : '');

  // カレンダー
  const dayTot = {};
  rs.forEach(r => { const t = dayTot[r.date] || (dayTot[r.date] = { in: 0, out: 0, exp: 0 }); t[r.type === 'in' && r.expected ? 'exp' : r.type] += r.amount; });
  const first = new Date(view.getFullYear(), view.getMonth(), 1).getDay();
  const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  if (selected && !selected.startsWith(ym)) selected = null;
  let g = '<span class="cell blank"></span>'.repeat(first);
  for (let d = 1; d <= days; d++) {
    const ds = `${ym}-${pad(d)}`, t = dayTot[ds];
    g += `<button class="cell${ds === today() ? ' today' : ''}${ds === selected ? ' sel' : ''}" data-date="${ds}"><span class="d">${d}</span>` +
      (t && t.in ? `<span class="a in">+${short(t.in)}</span>` : '') +
      (t && t.exp ? `<span class="a exp">~${short(t.exp)}</span>` : '') +
      (t && t.out ? `<span class="a out">-${short(t.out)}</span>` : '') + '</button>';
  }
  $('grid').innerHTML = g;

  // 日ごとの収支
  const ds = $('daySum');
  ds.hidden = !selected;
  if (selected) {
    const t = dayTot[selected] || { in: 0, out: 0, exp: 0 };
    const net = t.in + t.exp - t.out;
    ds.innerHTML = `<span class="in">収入 ${yen(t.in)}</span>` + (t.exp ? `<span class="exp">見込 ${yen(t.exp)}</span>` : '') +
      `<span class="out">支出 ${yen(t.out)}</span><b>収支 ${net < 0 ? '-' : ''}${yen(Math.abs(net))}</b>`;
    const d = new Date(selected + 'T00:00');
    $('listTitle').textContent = `${d.getMonth() + 1}月${d.getDate()}日の明細`;
    rs = rs.filter(r => r.date === selected);
  } else $('listTitle').textContent = '明細';

  // 明細
  let html = '', last = '';
  const wd = '日月火水木金土';
  for (const r of rs) {
    if (r.date !== last) {
      last = r.date;
      const d = new Date(r.date + 'T00:00');
      html += `<li class="day">${d.getMonth() + 1}月${d.getDate()}日(${wd[d.getDay()]})</li>`;
    }
    const ex = r.type === 'in' && r.expected;
    html += `<li class="item${ex ? ' expected' : ''}" data-id="${r.id}"><span class="ic">${icon(r.type, r.category)}</span><div class="t">${esc(r.category)}${ex ? ' <small class="exp">見込</small>' : ''}<span>${esc(r.type === 'out' ? payOf(r) + (r.memo ? '・' + r.memo : '') : r.memo || '')}</span></div><b class="${r.type}${ex ? ' exp' : ''}">${r.type === 'in' ? '+' : '-'}${yen(r.amount)}</b></li>`;
  }
  $('list').innerHTML = html;
  $('empty').hidden = rs.length > 0;
}

function fillCats(type, selected) {
  $('form').category.innerHTML = CATS[type === 'exp' ? 'in' : type].map(c => `<option${c[0] === selected ? ' selected' : ''}>${c[0]}</option>`).join('');
}

function openDialog(rec) {
  const f = $('form');
  pendingGoal = null; // 目標からの記録は openGoalExpense が開いた後にセットする
  editingId = rec ? rec.id : null;
  $('dlgTitle').textContent = rec ? '記録を編集' : '記録を追加';
  $('del').hidden = !rec;
  const type = rec ? (rec.type === 'in' && rec.expected ? 'exp' : rec.type) : 'out';
  f.type.value = type;
  fillCats(type, rec && rec.category);
  f.date.value = rec ? rec.date : (selected || today());
  f.amount.value = rec ? rec.amount : '';
  f.memo.value = rec ? rec.memo : '';
  f.pay.innerHTML = payOptions(rec && rec.type === 'out' ? payOf(rec) : '現金');
  $('payLabel').hidden = type !== 'out';
  $('dlg').showModal();
}

document.querySelectorAll('input[name=type]').forEach(r => r.addEventListener('change', e => {
  fillCats(e.target.value);
  $('payLabel').hidden = e.target.value !== 'out';
}));
$('fab').onclick = () => openDialog();
$('cancel').onclick = () => $('dlg').close();
$('cats').onclick = e => {
  if (!e.target.closest('#bset')) return;
  const f = $('bform');
  const ym = ymOf(view);
  const budget = budgetFor(ym);
  $('btitle').textContent = `${view.getFullYear()}年${view.getMonth() + 1}月の予算`;
  $('binherit').hidden = !!budgets[ym] || !Object.keys(budget.cats).length && !budget.total;
  f.total.value = budget.total || '';
  $('bcats').innerHTML = CATS.out.map(([c, ic]) =>
    `<label>${ic} ${c}<input type="number" inputmode="numeric" min="0" step="1" data-cat="${c}" value="${budget.cats[c] || ''}"></label>`).join('');
  $('bdlg').showModal();
};
$('bcancel').onclick = () => $('bdlg').close();
$('bform').onsubmit = () => {
  const num = v => Math.max(0, Math.round(+v || 0));
  const b = { total: num($('bform').total.value), cats: {} };
  $('bcats').querySelectorAll('input').forEach(i => { if (num(i.value)) b.cats[i.dataset.cat] = num(i.value); });
  budgets[ymOf(view)] = b;
  localStorage.setItem(BKEY, JSON.stringify(budgets));
  notifyChange();
  render();
};
$('grid').onclick = e => {
  const c = e.target.closest('.cell[data-date]');
  if (!c) return;
  selected = selected === c.dataset.date ? null : c.dataset.date;
  render();
};
$('list').onclick = e => {
  const li = e.target.closest('.item');
  if (li) openDialog(records.find(r => r.id === +li.dataset.id));
};
$('del').onclick = () => {
  if (confirm('この記録を削除しますか?')) {
    records = records.filter(r => r.id !== editingId);
    save(); $('dlg').close(); render();
  }
};
$('form').onsubmit = () => {
  const f = $('form');
  const exp = f.type.value === 'exp'; // 見込収入は type:'in' + expected:true で保存(収支には含める)
  const rec = { id: editingId || Date.now(), type: exp ? 'in' : f.type.value, date: f.date.value, amount: Math.round(+f.amount.value), category: f.category.value, memo: f.memo.value.trim() };
  if (exp) rec.expected = true;
  if (rec.type === 'out') rec.pay = f.pay.value;
  if (pendingGoal) { // 目標の「支出に記録」から: 記録済みにして目標をゲージから外す
    rec.goalId = pendingGoal;
    goals = goals.map(g => g.id === pendingGoal ? { ...g, done: true } : g);
    saveGoals();
    pendingGoal = null;
  }
  if (editingId) records = records.map(r => r.id === editingId ? rec : r); else records.push(rec);
  save();
  view = new Date(rec.date + 'T00:00'); view.setDate(1);
  if (selected) selected = rec.date;
  render();
};
$('prev').onclick = () => { view.setMonth(view.getMonth() - 1); render(); };
$('next').onclick = () => { view.setMonth(view.getMonth() + 1); render(); };

$('export').onclick = () => {
  const head = '日付,種別,カテゴリ,金額,支払い方法,メモ';
  const q = s => '"' + String(s).replace(/"/g, '""') + '"';
  const lines = [...records].sort((a, b) => a.date.localeCompare(b.date))
    .map(r => [r.date, r.type === 'in' ? (r.expected ? '見込収入' : '収入') : '支出', r.category, r.amount, r.type === 'out' ? payOf(r) : '', q(r.memo || '')].join(','));
  const blob = new Blob(['﻿' + [head, ...lines].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kakeibo-${today()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
};

// ---------- 定期の引き落とし ----------
const LEAD_DAYS = 7;
const LKEY = 'kakeibo.bills.v1', NKEY = 'kakeibo.notified.v1';
let bills = [];
try { bills = JSON.parse(localStorage.getItem(LKEY)) || []; } catch { bills = []; }
const saveBills = () => { localStorage.setItem(LKEY, JSON.stringify(bills)); notifyChange(); };
let editingBill = null;

const dueIn = (y, m, day) => new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate())); // 月末超えは月末日に
const startOfToday = () => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); };
const nextDue = b => {
  const t = startOfToday();
  let d = dueIn(t.getFullYear(), t.getMonth(), b.day);
  if (d < t) d = dueIn(t.getFullYear(), t.getMonth() + 1, b.day);
  return d;
};
const daysUntil = d => Math.round((d - startOfToday()) / 864e5);
const md = d => `${d.getMonth() + 1}/${d.getDate()}`;
const ymd = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const dueLabel = n => n === 0 ? '今日' : n === 1 ? '明日' : `あと${n}日`;

function upcoming() {
  return bills.map(b => ({ b, d: nextDue(b) })).map(x => ({ ...x, n: daysUntil(x.d) }))
    .filter(x => x.n <= LEAD_DAYS).sort((a, c) => a.n - c.n);
}

function renderBills() {
  const all = [...bills].sort((a, c) => a.day - c.day);
  $('bills').innerHTML = all.map(b =>
    `<li class="bill" data-id="${b.id}"><span class="ic">${icon('out', b.category)}</span><div class="t">${esc(b.name)}<span>毎月${b.day}日${b.day > 28 ? '(月末は末日)' : ''}・次回 ${md(nextDue(b))}</span></div><b>${b.amount ? yen(b.amount) : '—'}</b></li>`).join('');
  $('billEmpty').hidden = bills.length > 0;
  $('ics').hidden = !bills.length;

  const up = upcoming();
  $('upcoming').hidden = !up.length;
  $('upcoming').innerHTML = '<h2>🔔 まもなく引き落とし</h2>' + up.map(({ b, d, n }) =>
    `<div class="u"><span>${esc(b.name)}(${md(d)})</span><span><em>${dueLabel(n)}</em> ${b.amount ? yen(b.amount) : ''}</span></div>`).join('');

  const supported = 'Notification' in window;
  $('notif').hidden = !supported || Notification.permission === 'granted';
  $('notifHint').textContent = !supported ? '' :
    Notification.permission === 'denied' ? '通知がブロックされています。ブラウザの設定から許可してください。' :
    Notification.permission === 'granted' ? 'アプリを開いたときに通知します。アプリを閉じていても通知したい場合は「カレンダーに登録」を使ってください。' : '';
}

async function notifyUpcoming() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  let done = {};
  try { done = JSON.parse(localStorage.getItem(NKEY)) || {}; } catch {}
  const t = ymd(startOfToday());
  for (const { b, d, n } of upcoming()) {
    const key = `${b.id}:${ymd(d)}`;
    if (done[key] === t) continue; // 同じ日に同じ通知は1回だけ
    const title = `${dueLabel(n)}は「${b.name}」の引き落とし日`;
    const opts = { body: `${md(d)}${b.amount ? ' ・ ' + yen(b.amount) : ''}。残高を確認しましょう。`, icon: 'icon.svg', tag: key };
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) await reg.showNotification(title, opts); else new Notification(title, opts);
      done[key] = t;
    } catch {}
  }
  const keep = {}; // 古い履歴は捨てる
  Object.keys(done).forEach(k => { if (done[k] === t) keep[k] = t; });
  localStorage.setItem(NKEY, JSON.stringify(keep));
}

// 引き落とし日が来た分を支出として自動記録する。
// 対象は登録日(since)以降の引き落とし日。lastDue より後だけ記録するので、記録後に消しても再作成されない。
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function applyBills() {
  const t = startOfToday(), today = iso(t);
  let added = 0, billsChanged = false;
  for (const b of bills) {
    if (!b.since) { b.since = today; billsChanged = true; } // 旧データ: 今日から対象
    if (!b.amount) continue;
    const s = new Date(b.since + 'T00:00');
    let y = s.getFullYear(), m = s.getMonth();
    while (y < t.getFullYear() || (y === t.getFullYear() && m <= t.getMonth())) {
      const d = iso(dueIn(y, m, b.day));
      if (d >= b.since && d <= today && d > (b.lastDue || '')) {
        if (!records.some(r => r.billId === b.id && r.date === d)) {
          records.push({ id: Date.now() + added, type: 'out', date: d, amount: b.amount, category: b.category, pay: payOf(b), memo: `引き落とし: ${b.name}`, billId: b.id });
          added++;
        }
        b.lastDue = d; billsChanged = true;
      }
      if (++m > 11) { m = 0; y++; }
    }
  }
  if (added) save();
  if (billsChanged) saveBills();
  if (added) toast(`引き落とし${added}件を支出として記録しました`);
  return added;
}
function toast(msg) {
  const el = $('toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.hidden = true, 4000);
}

function openBill(b) {
  const f = $('billform');
  editingBill = b ? b.id : null;
  $('billTitle').textContent = b ? '引き落としを編集' : '引き落としを追加';
  $('billDel').hidden = !b;
  f.day.innerHTML = Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}">${i + 1}日</option>`).join('');
  f.category.innerHTML = CATS.out.map(c => `<option>${c[0]}</option>`).join('');
  f.pay.innerHTML = payOptions(b ? payOf(b) : '現金');
  f.name.value = b ? b.name : '';
  f.amount.value = b && b.amount ? b.amount : '';
  f.day.value = b ? b.day : startOfToday().getDate();
  f.category.value = b ? b.category : '住居・光熱費';
  $('billdlg').showModal();
}
$('billAdd').onclick = () => openBill();
$('billCancel').onclick = () => $('billdlg').close();
$('bills').onclick = e => {
  const li = e.target.closest('.bill');
  if (li) openBill(bills.find(b => b.id === +li.dataset.id));
};
$('billDel').onclick = () => {
  if (confirm('この引き落とし予定を削除しますか?(過去の記録は消えません)')) {
    bills = bills.filter(b => b.id !== editingBill);
    saveBills(); $('billdlg').close(); renderBills();
  }
};
$('billform').onsubmit = () => {
  const f = $('billform');
  const old = bills.find(x => x.id === editingBill);
  const b = { ...old, id: editingBill || Date.now(), name: f.name.value.trim(), amount: Math.max(0, Math.round(+f.amount.value || 0)), day: +f.day.value, category: f.category.value, pay: f.pay.value };
  if (!old) b.since = iso(startOfToday());
  if (old) bills = bills.map(x => x.id === editingBill ? b : x); else bills.push(b);
  saveBills(); applyBills(); renderBills(); render(); notifyUpcoming();
};
$('notif').onclick = async () => {
  await Notification.requestPermission();
  renderBills(); notifyUpcoming();
};

// カレンダー(.ics)出力: 毎月の繰り返し予定 + 7日前の朝9時にアラーム
$('ics').onclick = () => {
  const esc2 = s => String(s).replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n');
  const stamp = new Date().toISOString().replace(/[-:]|\.\d+/g, '');
  const ev = bills.map(b => {
    const rrule = b.day > 28 ? `FREQ=MONTHLY;BYMONTHDAY=${Array.from({ length: b.day - 27 }, (_, i) => 28 + i).join(',')};BYSETPOS=-1` : `FREQ=MONTHLY;BYMONTHDAY=${b.day}`;
    const start = nextDue(b), end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    return ['BEGIN:VEVENT', `UID:kakeibo-bill-${b.id}@local`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(start)}`, `DTEND;VALUE=DATE:${ymd(end)}`, `RRULE:${rrule}`,
      `SUMMARY:${esc2('引き落とし: ' + b.name + (b.amount ? ' ' + yen(b.amount) : ''))}`,
      `DESCRIPTION:${esc2('家計簿アプリの定期引き落とし。残高を確認しましょう。')}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc2(b.name + 'の引き落とし日まであと7日')}`,
      'TRIGGER:-P6DT15H', 'END:VALARM', 'END:VEVENT'].join('\r\n');
  });
  const text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//kakeibo//JP', 'CALSCALE:GREGORIAN', ...ev, 'END:VCALENDAR'].join('\r\n') + '\r\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
  a.download = 'kakeibo-bills.ics';
  a.click();
  URL.revokeObjectURL(a.href);
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (applyBills()) render(); else renderGoals();
  renderBills(); notifyUpcoming();
});

// ---------- 目標 ----------
// これまでの収支(収入 - 支出)の残高を、期限が近い目標から順に割り当ててゲージを満たす。
// 期限日になったら目標金額を支出として自動記録する(1回だけ。記録後に消しても再作成されない)。
const GKEY = 'kakeibo.goals.v1';
let goals = [];
try { goals = JSON.parse(localStorage.getItem(GKEY)) || []; } catch { goals = []; }
const saveGoals = () => { localStorage.setItem(GKEY, JSON.stringify(goals)); notifyChange(); };
let editingGoal = null;

// 期限日以降の目標には「支出に記録」ボタンを出し、押すと入力画面を開く(金額は直せる)。
// 保存すると記録済み(done)になる。自動では記録しない。
let pendingGoal = null;
function openGoalExpense(g) {
  openDialog();
  const f = $('form');
  f.type.value = 'out';
  fillCats('out', g.category || 'その他');
  f.amount.value = g.target;
  f.memo.value = `目標: ${g.name}`;
  pendingGoal = g.id;
}
$('dlg').addEventListener('close', () => { pendingGoal = null; });

function renderGoals() {
  const t = startOfToday();
  const active = goals.filter(g => !g.done).sort((a, b) => a.deadline.localeCompare(b.deadline) || a.id - b.id);
  const finished = goals.filter(g => g.done).sort((a, b) => b.deadline.localeCompare(a.deadline));
  $('goalEmpty').hidden = goals.length > 0;

  // ゲージの元になる残高 = 収入(見込み含む) - 現金払いの支出(カード等は引かない)
  let pool = Math.max(0, records.reduce((s, r) => s + (r.type === 'in' ? r.amount : payOf(r) === '現金' ? -r.amount : 0), 0));
  let html = active.map(g => {
    const dl = new Date(g.deadline + 'T00:00'), days = Math.round((dl - t) / 864e5);
    const alloc = Math.min(g.target, pool); pool -= alloc;
    const lack = g.target - alloc, ready = lack === 0, due = days <= 0;
    const when = `${dl.getFullYear() === t.getFullYear() ? '' : dl.getFullYear() + '/'}${md(dl)}`;
    const pace = !ready && days > 0
      ? `<div class="rest pace">不足分の目安: 1日 ${yen(Math.ceil(lack / days))}` + (days >= 7 ? ` / 1週間 ${yen(Math.ceil(lack * 7 / days))}` : '') + (days >= 30 ? ` / 1か月 ${yen(Math.ceil(lack / (days / 30.4375)))}` : '') + '</div>' : '';
    return `<div class="goal" data-id="${g.id}"><div class="bar${ready ? ' done' : ''}">` +
      `<div class="row"><span>${esc(g.name)}</span><span>${yen(alloc)} / ${yen(g.target)}</span></div>` +
      `<div class="track big"><div class="fill" style="width:${alloc / g.target * 100}%"></div></div>` +
      `<div class="rest">${ready ? '✔ 準備OK' : `不足 ${yen(lack)}`}・期限 ${when}(${days > 0 ? `あと${days}日` : days === 0 ? '今日' : `${-days}日超過`})</div>${pace}</div>` +
      `<div class="gbtn">${due ? '<button data-act="pay" class="pay">支出に記録</button>' : ''}<button data-act="edit">編集</button></div></div>`;
  }).join('');
  if (finished.length) {
    html += '<div class="gdone"><small>完了</small>' + finished.map(g => {
      const dl = new Date(g.deadline + 'T00:00');
      return `<div class="u" data-id="${g.id}"><span>${g.skipped ? '期限切れ' : '✔'} ${esc(g.name)} ${yen(g.target)}${g.skipped ? '' : `(${md(dl)}期限・記録済み)`}</span><button data-act="rm">削除</button></div>`;
    }).join('') + '</div>';
  }
  $('goals').innerHTML = html;
}

function openGoal(g) {
  const f = $('goalform');
  const t = startOfToday();
  editingGoal = g ? g.id : null;
  $('goalTitle').textContent = g ? '目標を編集' : '目標を追加';
  $('goalDel').hidden = !g;
  f.category.innerHTML = CATS.out.map(c => `<option>${c[0]}</option>`).join('');
  f.name.value = g ? g.name : '';
  f.target.value = g ? g.target : '';
  f.deadline.min = iso(t);
  f.deadline.value = g ? g.deadline : iso(new Date(t.getFullYear(), t.getMonth() + 1, t.getDate()));
  f.category.value = g ? g.category || 'その他' : 'その他';
  $('goaldlg').showModal();
}
const removeGoal = id => {
  if (!confirm('この目標を削除しますか?(記録済みの支出は消えません)')) return false;
  goals = goals.filter(g => g.id !== id);
  saveGoals(); renderGoals();
  return true;
};
$('goalAdd').onclick = () => openGoal();
$('goalCancel').onclick = () => $('goaldlg').close();
$('goalDel').onclick = () => { if (removeGoal(editingGoal)) $('goaldlg').close(); };
$('goalform').onsubmit = () => {
  const f = $('goalform');
  const old = goals.find(x => x.id === editingGoal);
  const g = { ...old, id: editingGoal || Date.now(), name: f.name.value.trim(), target: Math.max(1, Math.round(+f.target.value)), deadline: f.deadline.value, category: f.category.value };
  if (old) goals = goals.map(x => x.id === editingGoal ? g : x); else goals.push(g);
  saveGoals(); render();
};
$('goals').onclick = e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = +btn.closest('[data-id]').dataset.id;
  if (btn.dataset.act === 'edit') openGoal(goals.find(g => g.id === id));
  else if (btn.dataset.act === 'pay') openGoalExpense(goals.find(g => g.id === id));
  else removeGoal(id);
};

// ---------- 端末間の同期 ----------
// 同期の本体は sync.js / syncCore.js(firebase-config.js が設定されているときだけ読み込む)。
// ここでは、データの受け渡し(bridge)と設定画面だけを持つ。
const syncState = { user: null, status: '同期は未設定です', actions: null, on: false };
const syncMsg = e => ({
  'auth/invalid-credential': 'メールアドレスまたはパスワードが違います',
  'auth/wrong-password': 'メールアドレスまたはパスワードが違います',
  'auth/user-not-found': 'このメールアドレスは登録されていません',
  'auth/email-already-in-use': 'このメールアドレスは登録済みです。「ログイン」を押してください',
  'auth/weak-password': 'パスワードは6文字以上にしてください',
  'auth/invalid-email': 'メールアドレスの形式が正しくありません',
  'auth/network-request-failed': '通信できません。ネットワークを確認してください',
  'auth/too-many-requests': '試行回数が多すぎます。しばらくしてからやり直してください',
}[e && e.code] || `エラー: ${(e && (e.code || e.message)) || e}`);

function renderSync() {
  $('syncStatus').textContent = syncState.user ? `${syncState.user}・${syncState.status}` : syncState.status;
  $('syncState').textContent = syncState.on ? syncState.status : '同期は未設定です。SYNC_SETUP.md の手順でFirebaseを設定すると使えます。';
  $('syncIn').hidden = !syncState.on || !!syncState.user;
  $('syncOut').hidden = !syncState.user;
  $('syncUser').textContent = syncState.user || '';
}
$('syncBtn').onclick = () => { $('syncErr').textContent = ''; renderSync(); $('syncdlg').showModal(); };
$('syncClose').onclick = $('syncClose2').onclick = () => $('syncdlg').close();
const syncAuth = name => async () => {
  const f = $('syncform');
  $('syncErr').textContent = '';
  if (!syncState.actions) return;
  try { await syncState.actions[name](f.email.value.trim(), f.password.value); f.password.value = ''; $('syncdlg').close(); }
  catch (e) { $('syncErr').textContent = syncMsg(e); }
};
$('syncLogin').onclick = syncAuth('login');
$('syncSignup').onclick = syncAuth('signup');
$('syncLogout').onclick = () => { if (confirm('ログアウトします。この端末のデータは残り、同期だけ止まります。')) syncState.actions.logout(); };

(async () => {
  try {
    const cfg = (await import('./firebase-config.js')).default;
    if (!cfg) return renderSync();
    syncState.on = true; syncState.status = '読み込み中…'; renderSync();
    const mod = await import('./sync.js'); // Firebase SDK をネットから読む。オフラインなら失敗してもアプリは普通に動く
    mod.start(cfg, {
      getData: () => ({ records, bills, goals, budgets: Object.entries(budgets).map(([id, b]) => ({ id, ...b })) }),
      applyData: d => {
        records = d.records; bills = d.bills; goals = d.goals;
        budgets = Object.fromEntries(d.budgets.map(({ id, ...b }) => [id, b]));
        localStorage.setItem(KEY, JSON.stringify(records));
        localStorage.setItem(LKEY, JSON.stringify(bills));
        localStorage.setItem(GKEY, JSON.stringify(goals));
        localStorage.setItem(BKEY, JSON.stringify(budgets));
        render(); renderBills();
      },
      setStatus: s => { syncState.status = s; renderSync(); },
      setUser: u => { syncState.user = u; renderSync(); },
      setActions: a => { syncState.actions = a; },
      onChange: fn => { window.kakeiboStore = { onChange: fn }; },
    });
  } catch (e) {
    syncState.status = 'オフラインのため同期できません(戻ったら再読み込みしてください)';
    renderSync();
  }
})();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
applyBills();
render();
renderBills();
notifyUpcoming();
