// Grafici SVG semplici per le statistiche, nel tema scuro dell'app. Ogni grafico ha in alto una riga
// di lettura: toccando una barra o un punto (data-tip) lì compare il valore esatto (gestito in app.js).
const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const legend = series => (series.length > 1
  ? `<div class="chart-legend">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`
  : '');

/**
 * Barre verticali, impilate se ci sono più serie. labels: etichette sotto le barre;
 * series: [{ name, color, values }]; fmt: formato dei valori; hint: testo iniziale della riga di lettura.
 */
export function bars({ labels, series, fmt, hint = 'Tocca una barra per il valore' }) {
  const W = Math.max(300, labels.length * 30), H = 150, B = 18, T = 8;
  const totals = labels.map((_, i) => series.reduce((a, s) => a + (s.values[i] || 0), 0));
  const max = Math.max(...totals, 0) || 1;
  const bw = Math.min(18, (W / labels.length) * 0.6);
  const cols = labels.map((label, i) => {
    const x = (i + 0.5) * (W / labels.length);
    let y = H - B;
    const segs = series.map(s => {
      const h = ((s.values[i] || 0) / max) * (H - B - T);
      if (h <= 0) return '';
      y -= h;
      // 2 px di stacco tra i segmenti impilati
      return `<rect x="${(x - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, h - 2).toFixed(1)}" rx="3" fill="${s.color}"/>`;
    }).join('');
    const tip = `${label}: ${fmt(totals[i])}${series.length > 1 ? ' (' + series.map(s => `${s.name} ${fmt(s.values[i] || 0)}`).join(', ') + ')' : ''}`;
    return `<g data-tip="${esc(tip)}"><rect x="${(x - (W / labels.length) / 2).toFixed(1)}" y="0" width="${(W / labels.length).toFixed(1)}" height="${H}" fill="transparent"/>${segs}
      <text x="${x.toFixed(1)}" y="${H - 4}" text-anchor="middle">${esc(label)}</text></g>`;
  }).join('');
  return `<div class="chart"><p class="chart-read">${esc(hint)}</p>${legend(series)}
    <div class="chart-scroll"><svg viewBox="0 0 ${W} ${H}">
      <line class="axis" x1="0" x2="${W}" y1="${H - B}" y2="${H - B}"/>${cols}</svg></div>
    <small class="chart-max">massimo ${esc(fmt(max))}</small></div>`;
}

/**
 * Linee sullo stesso asse (stessa unità). points: etichette; series: [{ name, color, values }].
 * L'asse va dal valore più basso al più alto (con un po' di margine): così si vede anche un calo
 * di 1 kg su 68. Con fromZero parte da zero.
 */
export function lines({ labels, series, fmt, hint = 'Tocca un punto per i valori', fromZero = false }) {
  const W = 600, H = 170, P = 10;
  const all = series.flatMap(s => s.values).filter(v => v != null);
  const hi = Math.max(...all, 0) || 1;
  const lo = fromZero ? 0 : Math.min(...all, hi);
  const pad = fromZero ? 0 : Math.max((hi - lo) * 0.15, hi * 0.01, 0.5);
  const min = Math.max(0, lo - pad), max = hi + pad;
  const x = i => P + (labels.length > 1 ? (i / (labels.length - 1)) * (W - 2 * P) : (W - 2 * P) / 2);
  const y = v => H - P - ((v - min) / (max - min)) * (H - 2 * P);
  const paths = series.map(s => {
    const d = s.values.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean);
    // Pallini sui punti: così si vede anche un valore isolato (una linea ha bisogno di due punti).
    const dots = s.values.map((v, i) => (v == null ? '' : `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" fill="${s.color}" stroke="var(--panel)" stroke-width="2"/>`)).join('');
    return (d.length > 1 ? `<polyline points="${d.join(' ')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>` : '') + dots;
  }).join('');
  const hits = labels.map((label, i) => {
    const tip = `${label}: ` + series.map(s => `${s.name} ${s.values[i] == null ? '—' : fmt(s.values[i])}`).join(', ');
    const w = (W - 2 * P) / Math.max(1, labels.length - 1);
    return `<rect data-tip="${esc(tip)}" x="${(x(i) - w / 2).toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${H}" fill="transparent"/>`;
  }).join('');
  return `<div class="chart"><p class="chart-read">${esc(hint)}</p>${legend(series)}
    <svg viewBox="0 0 ${W} ${H}"><line class="axis" x1="0" x2="${W}" y1="${H - P}" y2="${H - P}"/>${paths}${hits}</svg>
    <div class="chart-axis"><small>${esc(labels[0] ?? '')}</small><small>da ${esc(fmt(lo))} a ${esc(fmt(hi))}</small><small>${esc(labels.at(-1) ?? '')}</small></div></div>`;
}

/** Barre orizzontali per le distribuzioni: items [{ label, value }], ordinati come arrivano. */
export function hbars(items, fmt, color) {
  const max = Math.max(...items.map(i => i.value), 0) || 1;
  return `<div class="hbars">${items.map(i => `<div class="hbar"><span>${esc(i.label)}</span>
    <div class="hbar-track"><i style="width:${(i.value / max) * 100}%;background:${color}"></i></div><b>${esc(fmt(i.value))}</b></div>`).join('')}</div>`;
}
