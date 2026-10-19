// GACash: spese ed entrate, budget per categoria, spese fisse e abbonamenti, scontrini e garanzie.
// Tutto resta nel telefono (IndexedDB); il backup è un file da salvare o condividere.
import { db, getSetting, setSetting } from './db.js';
import { bars, hbars } from './charts.js';
import { APP_VERSION } from './version.js';

const $ = sel => document.querySelector(sel);
const view = $('#view');
const sheet = $('#sheet');
const native = window.Android;   // presente solo nell'APK Android

const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const eur = n => (n ?? 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always' });   // 1.487,50 €, non 1487,50 €
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const isoDate = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const shortDate = iso => new Date(iso + 'T12:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: '2-digit' });
const dayName = iso => new Date(iso + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
const monthTitle = ym => new Date(ym + '-15T12:00:00').toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);

function addMonths(iso, n, day = null) {
  const d = new Date(iso + 'T12:00:00');
  const want = day ?? d.getDate();
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1, 12);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(want, last));   // il 31 diventa il 30 o il 28 nei mesi più corti
  return isoDate(target);
}

function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2800);
}

// ---------------------------------------------------------------------------
// Dati
// Movimento: { id, date, type: 'out' | 'in', amount, cat, note, photo (c'è uno scontrino), garanzia (mesi), fixedId }
// Categoria: { id, name, emoji, type, budget (€ al mese, solo spese) }
// Spesa fissa: { id, name, amount, type, cat, every (mesi: 1, 2, 3, 6, 12), day, next, active }
// ---------------------------------------------------------------------------
const DEFAULT_CATS = [
  ['spesa', '🛒', 'Spesa'], ['casa', '🏠', 'Casa e affitto'], ['bollette', '💡', 'Bollette'], ['auto', '🚗', 'Auto e benzina'],
  ['trasporti', '🚌', 'Trasporti'], ['ristoranti', '🍕', 'Ristoranti'], ['bar', '☕', 'Bar e caffè'], ['svago', '🎉', 'Svago e uscite'],
  ['vestiti', '👕', 'Abbigliamento'], ['salute', '💊', 'Salute'], ['sport', '🏋️', 'Sport e palestra'], ['abbonamenti', '📺', 'Abbonamenti'],
  ['regali', '🎁', 'Regali'], ['viaggi', '✈️', 'Viaggi'], ['tech', '📱', 'Tecnologia'], ['hobby', '🎮', 'Hobby'],
  ['animali', '🐾', 'Animali'], ['altro', '✳️', 'Altro'],
].map(([id, emoji, name]) => ({ id, emoji, name, type: 'out', budget: null }))
  .concat([['stipendio', '💼', 'Stipendio'], ['extra', '💶', 'Entrate extra'], ['rimborsi', '↩️', 'Rimborsi'],
    ['regali-in', '🎁', 'Regali ricevuti'], ['vendite', '🏷️', 'Vendite'], ['altro-in', '✳️', 'Altro']]
    .map(([id, emoji, name]) => ({ id, emoji, name, type: 'in', budget: null })));

let moves = [];          // dal più recente
let cats = [];
let fixed = [];
let monthBudget = null;  // budget totale del mese (facoltativo)
let lastBackup = null;
let month = today().slice(0, 7);

const catOf = id => cats.find(c => c.id === id) ?? { id, emoji: '✳️', name: 'Altro', type: 'out' };
const sortMoves = () => moves.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
const inMonth = ym => moves.filter(m => m.date.startsWith(ym));
const sum = list => list.reduce((a, m) => a + m.amount, 0);
const saveCats = () => setSetting('cats', cats);
const saveFixed = () => setSetting('fixed', fixed);

// Spese fisse: alla scadenza si registrano da sole (anche più mesi, se l'app non è stata aperta).
async function applyFixed(quiet = false) {
  let created = 0;
  const now = today();
  for (const f of fixed) {
    if (!f.active) continue;
    while (f.next <= now) {
      const m = { id: Date.now() + created, date: f.next, type: f.type, amount: f.amount, cat: f.cat, note: f.name, photo: false, garanzia: null, fixedId: f.id };
      moves.push(m);
      await db.put('moves', m);
      created++;
      f.next = addMonths(f.next, f.every, f.day);
    }
  }
  if (created) {
    sortMoves();
    await saveFixed();
    if (!quiet) toast(`Registrate da sole: ${plural(created, 'spesa fissa', 'spese fisse')}`);
  }
  return created;
}

// ---------------------------------------------------------------------------
// Mese: saldo, budget, rinnovi, categorie, movimenti
// ---------------------------------------------------------------------------
function monthPage() {
  const list = inMonth(month);
  const out = list.filter(m => m.type === 'out'), inc = list.filter(m => m.type === 'in');
  const spent = sum(out), earned = sum(inc), balance = earned - spent;
  const isCurrent = month === today().slice(0, 7);
  const daysIn = new Date(+month.slice(0, 4), +month.slice(5, 7), 0).getDate();
  const dayNow = isCurrent ? +today().slice(8, 10) : daysIn;
  // Previsione a fine mese: spese variabili al ritmo di oggi + spese fisse che devono ancora arrivare.
  const variable = sum(out.filter(m => !m.fixedId));
  const fixedLeft = isCurrent ? fixed.filter(f => f.active && f.type === 'out' && f.next.startsWith(month)).reduce((a, f) => a + f.amount, 0) : 0;
  const forecast = isCurrent ? spent + (variable / Math.max(1, dayNow)) * (daysIn - dayNow) + fixedLeft : null;
  const byCat = new Map();
  for (const m of out) byCat.set(m.cat, (byCat.get(m.cat) ?? 0) + m.amount);
  const catBars = [...byCat].sort((a, b) => b[1] - a[1]).map(([id, value]) => ({ label: `${catOf(id).emoji} ${catOf(id).name}`, value }));
  const budgets = cats.filter(c => c.type === 'out' && c.budget).map(c => ({ c, used: byCat.get(c.id) ?? 0 }));
  const upcoming = fixed.filter(f => f.active && daysBetween(today(), f.next) <= 10).sort((a, b) => a.next.localeCompare(b.next));
  view.innerHTML = `<header class="top"><div class="brand">GA</div><h1>GACash</h1></header>
    ${updateBanner()}${backupReminder()}${alerts(budgets, spent)}${warrantyAlert()}
    <div class="month-nav"><button class="icon" data-month="-1" aria-label="Mese precedente">‹</button>
      <b>${esc(monthTitle(month))}</b>
      <button class="icon" data-month="1" aria-label="Mese successivo" ${isCurrent ? 'disabled' : ''}>›</button></div>
    <div class="balance ${balance < 0 ? 'neg' : ''}"><small>Saldo del mese</small><b>${eur(balance)}</b>
      <div class="balance-row"><span><i class="dot out"></i>Spese <b>${eur(spent)}</b></span><span><i class="dot in"></i>Entrate <b>${eur(earned)}</b></span></div>
      ${forecast != null && spent ? `<small class="forecast">Di questo passo a fine mese avrai speso circa <b>${eur(forecast)}</b></small>` : ''}</div>
    ${monthBudget ? budgetRow({ name: 'Budget del mese', emoji: '🎯' }, spent, monthBudget) : ''}
    ${budgets.length ? `<h2>Budget</h2>${budgets.map(({ c, used }) => budgetRow(c, used, c.budget)).join('')}` : ''}
    ${upcoming.length ? `<h2>In arrivo</h2>${upcoming.map(f => `<button class="row" data-editfixed="${f.id}">
      <span class="row-emoji">${catOf(f.cat).emoji}</span><span class="row-body"><b>${esc(f.name)}</b>
      <small>${f.next === today() ? 'oggi' : `tra ${plural(daysBetween(today(), f.next), 'giorno', 'giorni')}`} · ${shortDate(f.next)}</small></span>
      <b class="${f.type === 'in' ? 'plus' : ''}">${f.type === 'in' ? '+' : '−'}${eur(f.amount)}</b></button>`).join('')}` : ''}
    ${catBars.length ? `<h2>Dove vanno i soldi</h2>${hbars(catBars, eur, '#f2c14e')}` : ''}
    <h2>Movimenti del mese</h2>
    ${list.length ? movesList(list) : `<div class="empty-state"><p>Nessun movimento ${isCurrent ? 'questo mese' : 'in questo mese'}.</p>
      ${isCurrent ? '<button class="primary" data-add>Aggiungi la prima spesa</button>' : ''}</div>`}`;
}

function budgetRow(c, used, budget) {
  const pct = budget ? used / budget : 0;
  const level = pct >= 1 ? 'over' : pct >= 0.8 ? 'warn' : '';
  return `<div class="budget ${level}"><div class="budget-head"><span>${c.emoji} ${esc(c.name)}</span>
    <span><b>${eur(used)}</b> di ${eur(budget)}</span></div>
    <div class="budget-bar"><i style="width:${Math.min(100, pct * 100)}%"></i></div>
    <small>${pct >= 1 ? `Superato di ${eur(used - budget)}` : `Restano ${eur(budget - used)}`}</small></div>`;
}

function alerts(budgets, spent) {
  if (month !== today().slice(0, 7)) return '';
  const over = budgets.filter(b => b.used >= b.c.budget);
  const near = budgets.filter(b => b.used < b.c.budget && b.used >= b.c.budget * 0.8);
  const total = monthBudget && spent >= monthBudget * 0.8;
  if (!over.length && !near.length && !total) return '';
  return `<div class="hint ${over.length || (monthBudget && spent >= monthBudget) ? 'bad' : ''}"><b>${over.length ? 'Budget superato' : 'Budget quasi finito'}</b>
    <span>${[...over.map(b => `${b.c.emoji} ${b.c.name}: ${eur(b.used)} su ${eur(b.c.budget)}`),
      ...near.map(b => `${b.c.emoji} ${b.c.name}: restano ${eur(b.c.budget - b.used)}`),
      ...(total ? [`🎯 Totale del mese: ${eur(spent)} su ${eur(monthBudget)}`] : [])].map(esc).join('<br>')}</span></div>`;
}

/** Movimenti raggruppati per giorno, con il totale del giorno. */
function movesList(list) {
  const byDay = new Map();
  for (const m of list) {
    if (!byDay.has(m.date)) byDay.set(m.date, []);
    byDay.get(m.date).push(m);
  }
  return [...byDay].map(([d, ms]) => `<div class="day"><div class="day-head"><span>${esc(d === today() ? 'Oggi' : dayName(d))}</span>
      <small>${eur(sum(ms.filter(m => m.type === 'out')))}</small></div>
    ${ms.map(m => `<button class="row" data-edit="${m.id}"><span class="row-emoji">${catOf(m.cat).emoji}</span>
      <span class="row-body"><b>${esc(m.note || catOf(m.cat).name)}</b><small>${esc(catOf(m.cat).name)}${m.fixedId ? ' · fissa' : ''}${m.photo ? ' · 📎 scontrino' : ''}${m.garanzia ? ' · 🛡️ garanzia' : ''}</small></span>
      <b class="${m.type === 'in' ? 'plus' : ''}">${m.type === 'in' ? '+' : '−'}${eur(m.amount)}</b></button>`).join('')}</div>`).join('');
}

// ---------------------------------------------------------------------------
// Aggiungi / modifica: importo con il tastierino, categoria con un tocco
// ---------------------------------------------------------------------------
let draft = null;   // { id?, type, digits, cat, date, note, photo (data URL o true), garanzia }

function usageOrder(type) {
  const since = addMonths(today(), -3);
  const count = new Map();
  for (const m of moves) if (m.type === type && m.date >= since) count.set(m.cat, (count.get(m.cat) ?? 0) + 1);
  return cats.filter(c => c.type === type).sort((a, b) => (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0));
}

async function openEditor(id = null) {
  const m = moves.find(x => x.id === id);
  draft = m
    ? { id: m.id, type: m.type, digits: String(Math.round(m.amount * 100)), cat: m.cat, date: m.date, note: m.note, photo: m.photo ? (await db.get('photos', m.id))?.data ?? true : null, garanzia: m.garanzia }
    : { id: null, type: 'out', digits: '', cat: null, date: today(), note: '', photo: null, garanzia: null };
  renderEditor();
  if (!sheet.open) sheet.showModal();
}

const draftAmount = () => (+draft.digits || 0) / 100;

function renderEditor() {
  const d = draft;
  const order = usageOrder(d.type);
  d.cat ??= order[0]?.id;
  const yesterday = isoDate(new Date(Date.now() - 86400000));
  sheet.innerHTML = `<div class="sheet-head"><div class="seg">
      <button class="${d.type === 'out' ? 'on' : ''}" data-type="out">Spesa</button><button class="${d.type === 'in' ? 'on in' : ''}" data-type="in">Entrata</button></div>
      <button class="icon" data-close aria-label="Chiudi">✕</button></div>
    <div class="amount ${d.type}" id="amount">${eur(draftAmount())}</div>
    <div class="cats">${order.map(c => `<button class="cat ${c.id === d.cat ? 'on' : ''}" data-cat="${c.id}"><span>${c.emoji}</span><small>${esc(c.name)}</small></button>`).join('')}</div>
    <div class="chips">
      <button class="chip ${d.date === today() ? 'on' : ''}" data-date="${today()}">Oggi</button>
      <button class="chip ${d.date === yesterday ? 'on' : ''}" data-date="${yesterday}">Ieri</button>
      <label class="chip date-chip ${d.date !== today() && d.date !== yesterday ? 'on' : ''}">${d.date !== today() && d.date !== yesterday ? esc(shortDate(d.date)) : 'Altro giorno'}
        <input type="date" id="moveDate" value="${d.date}" max="${today()}"></label>
    </div>
    <input id="moveNote" value="${esc(d.note)}" placeholder="Nota (es. Esselunga, pizza con amici)" autocomplete="off">
    ${d.type === 'out' ? `<div class="extras">
      ${d.photo ? `<div class="receipt">${typeof d.photo === 'string' ? `<img src="${d.photo}" alt="Scontrino" data-zoom>` : ''}<button class="link" data-nophoto>Togli lo scontrino</button></div>`
        : '<label class="chip">📷 Scontrino<input type="file" id="receipt" accept="image/*" capture="environment" hidden></label>'}
      <select id="warranty" aria-label="Garanzia"><option value="">🛡️ Garanzia: no</option>
        ${[12, 24, 36].map(n => `<option value="${n}" ${d.garanzia === n ? 'selected' : ''}>🛡️ Garanzia ${n / 12} ${n === 12 ? 'anno' : 'anni'}</option>`).join('')}</select>
    </div>` : ''}
    <div class="keypad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '⌫'].map(k => `<button data-key="${k}">${k}</button>`).join('')}</div>
    <button class="primary" data-save>${d.id ? 'Salva le modifiche' : `Salva ${d.type === 'out' ? 'la spesa' : "l'entrata"}`}</button>
    ${d.id ? '<button class="link danger" data-delete>Elimina questo movimento</button>' : ''}`;
}

function readEditor() {
  draft.note = $('#moveNote')?.value.trim() ?? draft.note;
  const w = $('#warranty');
  if (w) draft.garanzia = w.value ? +w.value : null;
}

async function saveMove() {
  readEditor();
  const amount = draftAmount();
  if (!amount) return toast('Scrivi l\'importo con il tastierino.');
  const old = moves.find(x => x.id === draft.id);
  const m = { id: draft.id ?? Date.now(), date: draft.date, type: draft.type, amount, cat: draft.cat, note: draft.note,
    photo: !!draft.photo && draft.type === 'out', garanzia: draft.type === 'out' ? draft.garanzia : null, fixedId: old?.fixedId ?? null };
  if (typeof draft.photo === 'string' && m.photo) await db.put('photos', { id: m.id, data: draft.photo });
  if (!m.photo) await db.del('photos', m.id);
  moves = moves.filter(x => x.id !== m.id).concat(m);
  sortMoves();
  await db.put('moves', m);
  sheet.close();
  if (!old) month = m.date.slice(0, 7);
  toast(`${m.type === 'out' ? 'Spesa' : 'Entrata'} salvata: ${eur(amount)} · ${catOf(m.cat).name}`);
  budgetToast(m);
  route();
}

/** Dopo una spesa: avviso se la sua categoria ha superato (o quasi) il budget. */
function budgetToast(m) {
  const c = catOf(m.cat);
  if (m.type !== 'out' || !c.budget) return;
  const used = sum(inMonth(m.date.slice(0, 7)).filter(x => x.type === 'out' && x.cat === c.id));
  if (used >= c.budget) setTimeout(() => toast(`${c.emoji} Budget ${c.name} superato: ${eur(used)} su ${eur(c.budget)}`), 2900);
  else if (used >= c.budget * 0.8) setTimeout(() => toast(`${c.emoji} ${c.name}: restano ${eur(c.budget - used)} di budget`), 2900);
}

/** Foto dello scontrino ridotta (lato massimo 1400 px, JPEG): leggibile ma leggera. */
async function shrinkPhoto(file) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.75);
}

// ---------------------------------------------------------------------------
// Movimenti: cerca e filtra
// ---------------------------------------------------------------------------
let filter = { q: '', type: 'all', cat: '' };

function movesPage() {
  view.innerHTML = `<header class="top"><h1>Movimenti</h1></header>
    <input type="search" id="search" value="${esc(filter.q)}" placeholder="Cerca (es. benzina, Amazon)" autocomplete="off">
    <div class="chips scroll">${[['all', 'Tutti'], ['out', 'Spese'], ['in', 'Entrate']].map(([v, l]) => `<button class="chip ${filter.type === v ? 'on' : ''}" data-ftype="${v}">${l}</button>`).join('')}
      <select id="fcat" aria-label="Categoria"><option value="">Tutte le categorie</option>${cats.map(c => `<option value="${c.id}" ${filter.cat === c.id ? 'selected' : ''}>${c.emoji} ${esc(c.name)}${c.type === 'in' ? ' (entrata)' : ''}</option>`).join('')}</select></div>
    <div id="moveList"></div>`;
  renderMoveList();
}

function renderMoveList() {
  const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const q = norm(filter.q);
  const list = moves.filter(m => (filter.type === 'all' || m.type === filter.type) && (!filter.cat || m.cat === filter.cat)
    && (!q || norm(`${m.note} ${catOf(m.cat).name}`).includes(q)));
  const byMonth = new Map();
  for (const m of list) {
    const k = m.date.slice(0, 7);
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k).push(m);
  }
  $('#moveList').innerHTML = list.length ? `<p class="note">${plural(list.length, 'movimento', 'movimenti')} · spese ${eur(sum(list.filter(m => m.type === 'out')))} · entrate ${eur(sum(list.filter(m => m.type === 'in')))}</p>
    ${[...byMonth].slice(0, 24).map(([k, ms]) => `<h2>${esc(monthTitle(k))} <small>−${eur(sum(ms.filter(m => m.type === 'out')))}</small></h2>${movesList(ms)}`).join('')}`
    : '<p class="empty">Nessun movimento.</p>';
}

// ---------------------------------------------------------------------------
// Spese fisse e abbonamenti
// ---------------------------------------------------------------------------
const EVERY = [[1, 'Ogni mese'], [2, 'Ogni 2 mesi'], [3, 'Ogni 3 mesi'], [6, 'Ogni 6 mesi'], [12, 'Ogni anno']];
const everyLabel = n => EVERY.find(e => e[0] === n)?.[1] ?? `Ogni ${n} mesi`;

function fixedPage() {
  const active = fixed.filter(f => f.active);
  const monthly = t => active.filter(f => f.type === t).reduce((a, f) => a + f.amount / f.every, 0);
  view.innerHTML = `<header class="top"><h1>Spese fisse</h1></header>
    <p class="note">Affitto, bollette, abbonamenti, rate… e lo stipendio: alla data giusta si registrano da sole.</p>
    <div class="kpis"><div><b>${eur(monthly('out'))}</b><small>spese fisse al mese</small></div>
      <div><b>${eur(monthly('out') * 12)}</b><small>all'anno</small></div></div>
    <button class="primary" data-newfixed>+ Aggiungi spesa fissa o abbonamento</button>
    ${fixed.length ? [...fixed].sort((a, b) => b.active - a.active || a.next.localeCompare(b.next)).map(f => `<button class="row ${f.active ? '' : 'off'}" data-editfixed="${f.id}">
      <span class="row-emoji">${catOf(f.cat).emoji}</span><span class="row-body"><b>${esc(f.name)}</b>
      <small>${everyLabel(f.every)} · ${f.active ? `prossima ${shortDate(f.next)}` : 'sospesa'}</small></span>
      <b class="${f.type === 'in' ? 'plus' : ''}">${f.type === 'in' ? '+' : '−'}${eur(f.amount)}</b></button>`).join('')
      : '<p class="empty">Ancora nessuna spesa fissa.</p>'}`;
}

let fdraft = null;
function fixedEditor(id = null) {
  const f = fixed.find(x => x.id === id);
  fdraft = f ? { ...f } : { id: null, name: '', amount: null, type: 'out', cat: 'abbonamenti', every: 1, day: +today().slice(8, 10), next: today(), active: true };
  renderFixedEditor();
  if (!sheet.open) sheet.showModal();
}

function renderFixedEditor() {
  const f = fdraft;
  sheet.innerHTML = `<div class="sheet-head"><div class="seg">
      <button class="${f.type === 'out' ? 'on' : ''}" data-ftype-ed="out">Spesa</button><button class="${f.type === 'in' ? 'on in' : ''}" data-ftype-ed="in">Entrata</button></div>
      <button class="icon" data-close aria-label="Chiudi">✕</button></div>
    <label class="field"><span>Nome</span><input id="fName" value="${esc(f.name)}" placeholder="${f.type === 'out' ? 'es. Netflix, Affitto, Palestra' : 'es. Stipendio'}" autocomplete="off"></label>
    <label class="field"><span>Importo (€)</span><input id="fAmount" inputmode="decimal" value="${f.amount != null ? String(f.amount).replace('.', ',') : ''}"></label>
    <label class="field"><span>Categoria</span><select id="fCat">${cats.filter(c => c.type === f.type).map(c => `<option value="${c.id}" ${c.id === f.cat ? 'selected' : ''}>${c.emoji} ${esc(c.name)}</option>`).join('')}</select></label>
    <label class="field"><span>Quanto spesso</span><select id="fEvery">${EVERY.map(([n, l]) => `<option value="${n}" ${n === f.every ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="field"><span>Prossima volta</span><input type="date" id="fNext" value="${f.next}"></label>
    <label class="check"><input type="checkbox" id="fActive" ${f.active ? 'checked' : ''}> Attiva (togli la spunta per sospenderla)</label>
    <p class="note">Dalla data indicata si registra da sola ${everyLabel(f.every).toLowerCase()}, sempre lo stesso giorno del mese.</p>
    <button class="primary" data-savefixed>Salva</button>
    ${f.id ? '<button class="link danger" data-delfixed>Elimina</button>' : ''}`;
}

function readFixed() {
  const f = fdraft;
  f.name = $('#fName').value.trim();
  f.amount = parseFloat($('#fAmount').value.replace(',', '.')) || null;
  f.cat = $('#fCat').value;
  f.every = +$('#fEvery').value;
  f.next = $('#fNext').value || today();
  f.day = +f.next.slice(8, 10);
  f.active = $('#fActive').checked;
}

async function saveFixedItem() {
  readFixed();
  const f = fdraft;
  if (!f.name || !f.amount) return toast('Scrivi nome e importo.');
  if (!f.id) { f.id = Date.now(); fixed.push(f); } else fixed = fixed.map(x => (x.id === f.id ? f : x));
  await saveFixed();
  const created = await applyFixed(true);
  sheet.close();
  toast(`${f.name}: ${everyLabel(f.every).toLowerCase()}, prossima il ${shortDate(f.next)}${created ? ` · registrate le ${created} volte già passate` : ''}`);
  route();
}

// ---------------------------------------------------------------------------
// Garanzie: acquisti con la garanzia e lo scontrino
// ---------------------------------------------------------------------------
const warrantyEnd = m => addMonths(m.date, m.garanzia);

function warrantyAlert() {
  const soon = moves.filter(m => m.garanzia && daysBetween(today(), warrantyEnd(m)) >= 0 && daysBetween(today(), warrantyEnd(m)) <= 30);
  if (!soon.length) return '';
  return `<a class="hint" href="#/garanzie"><b>🛡️ Garanzia in scadenza</b><span>${soon.map(m => `${esc(m.note || catOf(m.cat).name)}: scade il ${shortDate(warrantyEnd(m))}`).join('<br>')}</span></a>`;
}

async function warrantyPage() {
  const list = moves.filter(m => m.garanzia).sort((a, b) => warrantyEnd(a).localeCompare(warrantyEnd(b)));
  const valid = list.filter(m => warrantyEnd(m) >= today()), expired = list.filter(m => warrantyEnd(m) < today());
  const row = m => {
    const left = daysBetween(today(), warrantyEnd(m));
    return `<button class="row" data-edit="${m.id}"><span class="row-emoji">${catOf(m.cat).emoji}</span>
      <span class="row-body"><b>${esc(m.note || catOf(m.cat).name)}</b><small>Comprato il ${shortDate(m.date)} · ${eur(m.amount)}${m.photo ? ' · 📎 scontrino' : ' · senza scontrino'}</small></span>
      <span class="w-left ${left < 0 ? 'exp' : left <= 30 ? 'soon' : ''}">${left < 0 ? 'scaduta' : left <= 60 ? `${left} gg` : `fino al ${shortDate(warrantyEnd(m))}`}</span></button>`;
  };
  view.innerHTML = `<header class="top"><a class="back" href="#/altro" aria-label="Indietro">‹</a><h1>Garanzie</h1></header>
    <p class="note">Quando segni un acquisto scegli la garanzia (1, 2 o 3 anni) e fotografa lo scontrino: qui ritrovi tutto.</p>
    ${valid.length ? `<h2>In garanzia</h2>${valid.map(row).join('')}` : '<p class="empty">Nessun acquisto in garanzia.</p>'}
    ${expired.length ? `<h2>Scadute</h2>${expired.map(row).join('')}` : ''}`;
}

// ---------------------------------------------------------------------------
// Statistiche: ultimi 12 mesi
// ---------------------------------------------------------------------------
const C_OUT = '#f2c14e', C_IN = '#60a5fa';   // oro e azzurro: distinguibili anche per chi non vede bene i colori

function statsPage() {
  const months = [];
  for (let i = 11; i >= 0; i--) months.push(addMonths(today().slice(0, 7) + '-15', -i).slice(0, 7));
  const spent = months.map(k => sum(inMonth(k).filter(m => m.type === 'out')));
  const earned = months.map(k => sum(inMonth(k).filter(m => m.type === 'in')));
  const withData = months.filter((k, i) => spent[i] || earned[i]).length || 1;
  const year = today().slice(0, 4);
  const yearOut = moves.filter(m => m.type === 'out' && m.date.startsWith(year));
  const byCat = new Map();
  for (const m of yearOut) byCat.set(m.cat, (byCat.get(m.cat) ?? 0) + m.amount);
  const saved = earned.reduce((a, b) => a + b, 0) - spent.reduce((a, b) => a + b, 0);
  view.innerHTML = `<header class="top"><a class="back" href="#/altro" aria-label="Indietro">‹</a><h1>Statistiche</h1></header>
    <div class="kpis"><div><b>${eur(spent.reduce((a, b) => a + b, 0) / withData)}</b><small>spesa media al mese</small></div>
      <div><b>${eur(earned.reduce((a, b) => a + b, 0) / withData)}</b><small>entrate medie al mese</small></div>
      <div><b class="${saved < 0 ? 'minus' : 'plus'}">${eur(saved)}</b><small>risparmiati in 12 mesi</small></div>
      <div><b>${eur(sum(yearOut))}</b><small>spesi nel ${year}</small></div></div>
    <h2>Spese ed entrate per mese</h2>
    ${bars({ labels: months.map(k => new Date(k + '-15T12:00:00').toLocaleDateString('it-IT', { month: 'short' })), series: [
      { name: 'Spese', color: C_OUT, values: spent }, { name: 'Entrate', color: C_IN, values: earned }], fmt: eur, hint: 'Tocca un mese per i valori' })}
    <h2>Categorie nel ${year}</h2>
    ${byCat.size ? hbars([...byCat].sort((a, b) => b[1] - a[1]).map(([id, value]) => ({ label: `${catOf(id).emoji} ${catOf(id).name}`, value })), eur, C_OUT) : '<p class="empty">Ancora niente.</p>'}`;
}

// ---------------------------------------------------------------------------
// Categorie e budget
// ---------------------------------------------------------------------------
function catsPage() {
  const row = c => `<div class="cat-row"><span class="row-emoji">${c.emoji}</span><input data-catname="${c.id}" value="${esc(c.name)}" aria-label="Nome">
    ${c.type === 'out' ? `<input data-catbudget="${c.id}" inputmode="decimal" value="${c.budget ?? ''}" placeholder="budget €" aria-label="Budget al mese">` : ''}
    ${moves.some(m => m.cat === c.id) || fixed.some(f => f.cat === c.id) ? '' : `<button class="icon small" data-delcat="${c.id}" aria-label="Elimina">✕</button>`}</div>`;
  view.innerHTML = `<header class="top"><a class="back" href="#/altro" aria-label="Indietro">‹</a><h1>Categorie e budget</h1></header>
    <p class="note">Il budget è quanto vuoi spendere al massimo ogni mese per quella categoria: lascia vuoto se non ti serve.</p>
    <label class="field"><span>🎯 Budget totale del mese</span><input id="monthBudget" inputmode="decimal" value="${monthBudget ?? ''}" placeholder="facoltativo"></label>
    <h2>Spese</h2>${cats.filter(c => c.type === 'out').map(row).join('')}
    <h2>Entrate</h2>${cats.filter(c => c.type === 'in').map(row).join('')}
    <h2>Nuova categoria</h2>
    <div class="cat-row"><input id="newEmoji" class="emoji-in" value="🏷️" aria-label="Emoji"><input id="newCat" placeholder="Nome (es. Moto)" autocomplete="off">
      <select id="newType"><option value="out">Spesa</option><option value="in">Entrata</option></select></div>
    <button class="secondary wide" data-addcat>Aggiungi categoria</button>`;
}

// ---------------------------------------------------------------------------
// Altro: backup, esportazione, aggiornamenti
// ---------------------------------------------------------------------------
function morePage() {
  view.innerHTML = `<header class="top"><h1>Altro</h1></header>
    <div class="list">
      <a class="row" href="#/statistiche"><span class="row-emoji">📊</span><span class="row-body"><b>Statistiche</b><small>12 mesi, media mensile, risparmio, categorie dell'anno</small></span><span class="chev">›</span></a>
      <a class="row" href="#/garanzie"><span class="row-emoji">🛡️</span><span class="row-body"><b>Garanzie e scontrini</b><small>${plural(moves.filter(m => m.garanzia && warrantyEnd(m) >= today()).length, 'acquisto', 'acquisti')} in garanzia</small></span><span class="chev">›</span></a>
      <a class="row" href="#/categorie"><span class="row-emoji">🏷️</span><span class="row-body"><b>Categorie e budget</b><small>nomi, nuove categorie e tetti di spesa</small></span><span class="chev">›</span></a>
    </div>
    <h2>Backup</h2>
    <p class="note">I dati restano solo su questo telefono. ${lastBackup ? `Ultimo backup: ${shortDate(lastBackup)}.` : 'Non hai ancora fatto un backup.'}</p>
    <div class="list">
      <button class="row" data-backup><span class="row-emoji">💾</span><span class="row-body"><b>Salva il backup</b><small>su Drive, email, iCloud (comprende le foto degli scontrini)</small></span></button>
      <button class="row" data-restore><span class="row-emoji">♻️</span><span class="row-body"><b>Ripristina da un backup</b><small>sostituisce i dati di questo telefono</small></span></button>
      <button class="row" data-csv><span class="row-emoji">📄</span><span class="row-body"><b>Esporta per Excel</b><small>tutti i movimenti in un file CSV</small></span></button>
    </div>
    <input type="file" id="restoreFile" accept=".json,application/json,text/plain" hidden>
    <h2>App</h2>
    <p class="note">Versione ${esc(APP_VERSION)}${native ? ` · app Android ${esc(apkVersion())}` : ''}</p>
    ${native ? '<div class="list"><button class="row" data-checkupdate><span class="row-body"><b>Controlla aggiornamenti</b></span></button></div><p class="note" id="updateMsg"></p>' : ''}
    ${!native ? '<p class="note">Su iPhone: apri questa pagina in Safari, tocca Condividi e poi "Aggiungi alla schermata Home".</p>' : ''}`;
}

async function backupJson() {
  const photos = await db.all('photos');
  return JSON.stringify({ app: 'gacash', version: 1, date: today(), moves, cats, fixed, monthBudget, photos });
}

async function shareFile(name, mime, text) {
  if (native?.shareFile) { if (!native.shareFile(name, mime, text)) toast('Salvataggio non riuscito'); return; }
  const file = new File([text], name, { type: mime });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (err) { if (err.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function saveBackup() {
  const json = await backupJson();
  lastBackup = today();
  setSetting('lastBackup', lastBackup);
  if (native?.shareBackup) { if (!native.shareBackup(json)) toast('Backup non riuscito'); return; }
  shareFile(`gacash-backup-${today()}.json`, 'application/json', json);
}

function exportCsv() {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Data', 'Tipo', 'Categoria', 'Importo', 'Nota', 'Garanzia fino al'].map(q).join(';'),
    ...[...moves].reverse().map(m => [m.date, m.type === 'out' ? 'Spesa' : 'Entrata', catOf(m.cat).name,
      (m.type === 'out' ? -m.amount : m.amount).toFixed(2).replace('.', ','), m.note, m.garanzia ? warrantyEnd(m) : ''].map(q).join(';'))];
  shareFile(`gacash-${today()}.csv`, 'text/csv', '﻿' + rows.join('\r\n'));
}

async function restoreBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'gacash') throw new Error('non è un backup di GACash');
    if (!confirm(`Ripristinare il backup del ${shortDate(data.date)}? I dati di questo telefono vengono sostituiti.`)) return;
    await Promise.all([db.clear('moves'), db.clear('photos')]);
    moves = data.moves ?? [];
    for (const m of moves) await db.put('moves', m);
    for (const p of data.photos ?? []) await db.put('photos', p);
    cats = data.cats ?? cats;
    fixed = data.fixed ?? [];
    monthBudget = data.monthBudget ?? null;
    sortMoves();
    await Promise.all([saveCats(), saveFixed(), setSetting('monthBudget', monthBudget)]);
    toast(`Ripristinati ${plural(moves.length, 'movimento', 'movimenti')}`);
    route();
  } catch (err) {
    toast('Ripristino non riuscito: ' + err.message);
  }
}

function backupReminder() {
  if (moves.length < 20) return '';
  const days = lastBackup ? daysBetween(lastBackup, today()) : Infinity;
  if (days < 30) return '';
  return `<a class="hint" href="#/altro"><b>Fai un backup</b><span>${lastBackup ? `L'ultimo è del ${shortDate(lastBackup)}` : 'Non ne hai ancora fatto uno'}: così non perdi i movimenti se cambi telefono.</span></a>`;
}

// Aggiornamenti dell'APK (il contenuto dell'app si aggiorna da solo da GitHub Pages).
const RELEASES = 'https://api.github.com/repos/Gavao/gacash/releases/latest';
let apkUpdate = null;
const apkVersion = () => native?.appVersion?.() ?? '';
const newer = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
};
async function checkApkUpdate() {
  if (!native) return;
  try {
    const rel = await (await fetch(RELEASES)).json();
    const version = rel.tag_name?.replace(/^v/, '');
    const asset = rel.assets?.find(a => a.name.endsWith('.apk'));
    apkUpdate = version && asset && newer(version, apkVersion()) ? { version, url: asset.browser_download_url } : null;
  } catch { /* offline */ }
}
const updateBanner = () => (apkUpdate ? `<button class="warn" data-update>È disponibile la versione ${esc(apkUpdate.version)} dell'app. Tocca per aggiornare.</button>` : '');

async function checkWebUpdate() {
  if (APP_VERSION === 'dev' || sheet.open) return;
  try {
    const latest = (await (await fetch('version.txt', { cache: 'no-store' })).text()).trim();
    if (!latest || latest === APP_VERSION || sessionStorage.getItem('reloadedFor') === latest) return;
    sessionStorage.setItem('reloadedFor', latest);
    location.reload();
  } catch { /* offline */ }
}

// ---------------------------------------------------------------------------
// Tocchi e modifiche
// ---------------------------------------------------------------------------
sheet.addEventListener('click', e => {
  if (e.target === sheet || e.target.closest('[data-close]')) sheet.close();
});

document.addEventListener('click', async e => {
  const t = e.target;
  if (t.closest('[data-add]')) return openEditor();
  const edit = t.closest('[data-edit]');
  if (edit) return openEditor(+edit.dataset.edit);
  const mon = t.closest('[data-month]');
  if (mon) { month = addMonths(month + '-15', +mon.dataset.month).slice(0, 7); monthPage(); return; }

  // Editor del movimento
  if (draft && sheet.open && sheet.contains(t)) {
    const key = t.closest('[data-key]');
    if (key) {
      const k = key.dataset.key;
      if (k === '⌫') draft.digits = draft.digits.slice(0, -1);
      else if (draft.digits.length < 9) draft.digits = (draft.digits + k).replace(/^0+/, '');
      $('#amount').textContent = eur(draftAmount());
      navigator.vibrate?.(8);
      return;
    }
    const type = t.closest('[data-type]');
    if (type) { readEditor(); draft.type = type.dataset.type; draft.cat = null; return renderEditor(); }
    const cat = t.closest('[data-cat]');
    if (cat) { readEditor(); draft.cat = cat.dataset.cat; return renderEditor(); }
    const date = t.closest('[data-date]');
    if (date) { readEditor(); draft.date = date.dataset.date; return renderEditor(); }
    if (t.closest('[data-nophoto]')) { readEditor(); draft.photo = null; return renderEditor(); }
    if (t.closest('[data-zoom]')) { t.classList.toggle('big'); return; }   // scontrino a tutta larghezza
    if (t.closest('[data-save]')) return saveMove();
    if (t.closest('[data-delete]')) {
      if (!confirm('Eliminare questo movimento?')) return;
      moves = moves.filter(m => m.id !== draft.id);
      await db.del('moves', draft.id);
      await db.del('photos', draft.id);
      sheet.close();
      toast('Movimento eliminato');
      route();
      return;
    }
  }

  // Movimenti
  const ft = t.closest('[data-ftype]');
  if (ft) { filter.type = ft.dataset.ftype; movesPage(); return; }

  // Spese fisse
  if (t.closest('[data-newfixed]')) return fixedEditor();
  const ef = t.closest('[data-editfixed]');
  if (ef) return fixedEditor(+ef.dataset.editfixed);
  const fte = t.closest('[data-ftype-ed]');
  if (fte && fdraft) { readFixed(); fdraft.type = fte.dataset.ftypeEd; fdraft.cat = cats.find(c => c.type === fdraft.type)?.id; return renderFixedEditor(); }
  if (t.closest('[data-savefixed]')) return saveFixedItem();
  if (t.closest('[data-delfixed]')) {
    if (!confirm(`Eliminare "${fdraft.name}"? I movimenti già registrati restano.`)) return;
    fixed = fixed.filter(f => f.id !== fdraft.id);
    await saveFixed();
    sheet.close();
    route();
    return;
  }

  // Categorie
  if (t.closest('[data-addcat]')) {
    const name = $('#newCat').value.trim();
    if (!name) return toast('Scrivi il nome della categoria.');
    cats.push({ id: 'c' + Date.now(), emoji: $('#newEmoji').value.trim() || '🏷️', name, type: $('#newType').value, budget: null });
    await saveCats();
    toast('Categoria aggiunta');
    catsPage();
    return;
  }
  const delCat = t.closest('[data-delcat]');
  if (delCat) { cats = cats.filter(c => c.id !== delCat.dataset.delcat); await saveCats(); catsPage(); return; }

  // Altro
  if (t.closest('[data-backup]')) return saveBackup();
  if (t.closest('[data-restore]')) return $('#restoreFile').click();
  if (t.closest('[data-csv]')) return exportCsv();
  if (t.closest('[data-update]')) { native.installUpdate(apkUpdate.url); toast('Download in corso: al termine si apre l\'installazione'); return; }
  if (t.closest('[data-checkupdate]')) {
    $('#updateMsg').textContent = 'Controllo…';
    await checkApkUpdate();
    $('#updateMsg').innerHTML = apkUpdate ? updateBanner() : 'Hai già l\'ultima versione.';
    return;
  }
  const tip = t.closest('[data-tip]');
  if (tip) tip.closest('.chart').querySelector('.chart-read').textContent = tip.dataset.tip;
});

document.addEventListener('input', e => {
  if (e.target.id === 'search') { filter.q = e.target.value; renderMoveList(); }
});

document.addEventListener('change', async e => {
  const el = e.target;
  if (el.id === 'fcat') { filter.cat = el.value; renderMoveList(); return; }
  if (el.id === 'moveDate' && draft) { readEditor(); draft.date = el.value || today(); renderEditor(); return; }
  if (el.id === 'fEvery' && fdraft) { readFixed(); renderFixedEditor(); return; }
  if (el.dataset.catname) { const c = cats.find(x => x.id === el.dataset.catname); c.name = el.value.trim() || c.name; await saveCats(); return; }
  if (el.dataset.catbudget) {
    const c = cats.find(x => x.id === el.dataset.catbudget);
    c.budget = parseFloat(el.value.replace(',', '.')) || null;
    await saveCats();
    toast(c.budget ? `Budget ${c.name}: ${eur(c.budget)} al mese` : `Budget ${c.name} tolto`);
    return;
  }
  if (el.id === 'monthBudget') {
    monthBudget = parseFloat(el.value.replace(',', '.')) || null;
    await setSetting('monthBudget', monthBudget);
    toast(monthBudget ? `Budget del mese: ${eur(monthBudget)}` : 'Budget del mese tolto');
    return;
  }
  const file = el.files?.[0];
  if (!file) return;
  if (el.id === 'receipt' && draft) {
    readEditor();
    try { draft.photo = await shrinkPhoto(file); } catch { toast('Non riesco a leggere questa foto'); }
    renderEditor();
    return;
  }
  if (el.id === 'restoreFile') restoreBackup(file);
  el.value = '';
});

// Tasto Indietro di Android: prima chiude la finestra aperta, poi torna alla pagina precedente.
window.appBack = () => {
  if (sheet.open) { sheet.close(); return true; }
  if (location.hash && location.hash !== '#/') { history.back(); return true; }
  return false;
};

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
function route() {
  const page = location.hash.replace(/^#\/?/, '').split('/')[0];
  const tab = { '': 'month', movimenti: 'moves', fisse: 'fixed', altro: 'more', garanzie: 'more', statistiche: 'more', categorie: 'more' }[page] ?? 'month';
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('on', a.dataset.tab === tab);
  if (page === 'movimenti') movesPage();
  else if (page === 'fisse') fixedPage();
  else if (page === 'altro') morePage();
  else if (page === 'garanzie') warrantyPage();
  else if (page === 'statistiche') statsPage();
  else if (page === 'categorie') catsPage();
  else monthPage();
}

addEventListener('hashchange', () => { route(); scrollTo(0, 0); });
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) return;
  checkWebUpdate();
  const before = moves.length;
  await applyFixed();   // a mezzanotte (o riaprendo l'app) arrivano le spese fisse del giorno
  if (moves.length !== before) route();
});
addEventListener('unhandledrejection', e => toast(e.reason?.message ?? 'Qualcosa non è andato'));

// Avvio
moves = await db.all('moves');
sortMoves();
cats = await getSetting('cats', DEFAULT_CATS);
fixed = await getSetting('fixed', []);
monthBudget = await getSetting('monthBudget', null);
lastBackup = await getSetting('lastBackup', null);
await applyFixed();
route();
navigator.storage?.persist?.().catch(() => {});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
checkWebUpdate();
checkApkUpdate().then(() => { if (apkUpdate && !location.hash.replace(/^#\/?/, '')) monthPage(); });
