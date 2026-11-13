'use strict';

const TYPES = {
  itselle: { label: 'Itselleluovutus', title: 'ITSELLELUOVUTUSPÖYTÄKIRJA' },
  vikapuute: { label: 'Vika- ja puutelista', title: 'VIKA- JA PUUTELISTA' },
};
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const $app = document.getElementById('app');

// ---------- Apufunktiot ----------

const PROPS = new Set(['value', 'checked', 'textContent', 'hidden', 'disabled', 'className']);

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid);
  return el;
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fiDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${+m[3]}.${+m[2]}.${m[1]}` : '';
};

function toast(msg) {
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}

function modal(...content) {
  const box = h('div', { class: 'modal-box' }, content);
  const bg = h('div', { class: 'modal' }, box);
  document.body.append(bg);
  return () => bg.remove();
}

function segmented(options, value, onChange) {
  const wrap = h('div', { class: 'seg' });
  const draw = () => {
    wrap.replaceChildren(...options.map(([val, label]) => h('button', {
      type: 'button', class: val === value ? 'on' : '',
      onclick: () => { value = val; draw(); onChange(val); },
    }, label)));
  };
  draw();
  return wrap;
}

function field(label, control) {
  return h('label', { class: 'field' }, h('span', {}, label), control);
}

// ---------- Kuvat ----------

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Kuvaa ei voitu lukea')); };
    img.src = url;
  });
}

function scaled(img, max) {
  const sc = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * sc));
  c.height = Math.max(1, Math.round(img.naturalHeight * sc));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

const canvasBlob = (c, q) => new Promise((resolve, reject) =>
  c.toBlob((b) => (b ? resolve(b) : reject(new Error('Kuvan pakkaus epäonnistui'))), 'image/jpeg', q));

// Pienentää kameran kuvan (max 1600 px) ja tekee listaa varten pikkukuvan.
async function processPhoto(file) {
  const img = await loadImage(file);
  const c = scaled(img, 1600);
  const blob = await canvasBlob(c, 0.8);
  return {
    data: await blob.arrayBuffer(), w: c.width, h: c.height,
    thumb: scaled(img, 200).toDataURL('image/jpeg', 0.6),
  };
}

async function photoForPdf(mediaId) {
  const m = await DB.getMedia(mediaId);
  if (!m) return null;
  try {
    const c = scaled(await loadImage(new Blob([m.data], { type: m.type })), 1100);
    const blob = await canvasBlob(c, 0.72);
    return { bytes: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height };
  } catch (e) {
    console.error(e);
    return null;
  }
}

// ---------- Reititys ----------

let cleanup = [];
let routeSeq = 0;

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function page({ title, back, action, body, footer }) {
  return [
    h('header', { class: 'bar' },
      back ? h('a', { class: 'bar-btn', href: back, 'aria-label': 'Takaisin' }, '‹') : h('span', { class: 'bar-pad' }),
      h('h1', {}, title),
      action || h('span', { class: 'bar-pad' })),
    h('main', {}, body),
    footer ? h('footer', { class: 'actions' }, footer) : null,
  ];
}

async function route() {
  const seq = ++routeSeq;
  const pending = cleanup;
  cleanup = [];
  for (const f of pending) {
    try { await f(); } catch (e) { console.error(e); }
  }
  const p = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  let view;
  try {
    if (p[0] === 'd' && p[1] && p[2] === 'info') view = await viewDocInfo(p[1]);
    else if (p[0] === 'd' && p[1] && p[2] === 'i' && p[3]) view = await viewItem(p[1], p[3]);
    else if (p[0] === 'd' && p[1]) view = await viewDoc(p[1]);
    else if (p[0] === 'new') view = await viewDocInfo(null);
    else view = await viewHome();
  } catch (e) {
    console.error(e);
    view = page({ title: 'Virhe', back: '#/', body: h('p', { class: 'empty' }, 'Jokin meni vikaan: ' + (e && e.message || e)) });
  }
  if (seq !== routeSeq) return;
  $app.replaceChildren(...view.filter(Boolean));
  window.scrollTo(0, 0);
}

const notFound = () => page({ title: 'Ei löytynyt', back: '#/', body: h('p', { class: 'empty' }, 'Kohdetta ei löytynyt.') });

// ---------- Etusivu ----------

async function viewHome() {
  const docs = await DB.getDocs();
  const cards = await Promise.all(docs.map(async (d) => {
    const items = await DB.getItems(d.id);
    const open = items.filter((i) => i.status !== 'fixed').length;
    return h('a', { class: 'card', href: `#/d/${d.id}` },
      h('span', { class: 'badge ' + d.type }, TYPES[d.type].label),
      h('strong', {}, d.name || 'Nimetön kohde'),
      h('small', {}, [fiDate(d.date), d.area, `${items.length} havaintoa, ${open} avoinna`].filter(Boolean).join(' · ')));
  }));
  return page({
    title: 'VikaPuute',
    body: [
      cards.length ? cards : h('p', { class: 'empty' },
        'Ei vielä dokumentteja. Aloita luomalla itselleluovutus tai vika- ja puutelista.'),
      h('p', { class: 'note' }, 'Tiedot tallentuvat vain tähän laitteeseen. Sovellus toimii ilman verkkoyhteyttä.'),
    ],
    footer: h('a', { class: 'btn primary big', href: '#/new' }, '＋ Uusi dokumentti'),
  });
}

// ---------- Dokumentin tiedot ----------

async function viewDocInfo(id) {
  const existing = id ? await DB.getDoc(id) : null;
  if (id && !existing) return notFound();
  const doc = existing || {
    id: uid(), type: 'itselle', name: '', address: '', area: '', date: todayISO(),
    inspector: localStorage.getItem('vp.inspector') || '', participants: '', notes: '', created: Date.now(),
  };
  const input = (key, attrs) => h('input', Object.assign({
    type: 'text', value: doc[key] || '', autocomplete: 'off',
    oninput: (e) => { doc[key] = e.target.value; },
  }, attrs));

  async function save(e) {
    e.preventDefault();
    if (!doc.name.trim()) { toast('Anna kohteen nimi'); return; }
    doc.updated = Date.now();
    await DB.putDoc(doc);
    if (doc.inspector) localStorage.setItem('vp.inspector', doc.inspector);
    go(`#/d/${doc.id}`);
  }
  async function remove() {
    if (!confirm('Poistetaanko dokumentti ja kaikki sen havainnot ja kuvat? Tätä ei voi perua.')) return;
    await DB.deleteDoc(doc.id);
    go('#/');
  }

  return page({
    title: existing ? 'Dokumentin tiedot' : 'Uusi dokumentti',
    back: existing ? `#/d/${doc.id}` : '#/',
    body: h('form', { id: 'docform', onsubmit: save },
      field('Dokumentin tyyppi', segmented(
        Object.entries(TYPES).map(([k, t]) => [k, t.label]), doc.type, (v) => { doc.type = v; })),
      field('Kohde / työmaa *', input('name', { placeholder: 'esim. As Oy Rantakatu 5' })),
      field('Osoite', input('address')),
      field('Tarkastettava alue', input('area', { placeholder: 'esim. A-rappu, huoneisto A12' })),
      field('Päivämäärä', input('date', { type: 'date' })),
      field('Tarkastaja', input('inspector')),
      field('Osallistujat', input('participants')),
      field('Lisätiedot', h('textarea', {
        rows: 3, value: doc.notes || '', oninput: (e) => { doc.notes = e.target.value; },
      })),
      existing ? h('button', { type: 'button', class: 'btn danger', onclick: remove }, 'Poista dokumentti') : null),
    footer: h('button', { class: 'btn primary big', type: 'submit', form: 'docform' },
      existing ? 'Tallenna' : 'Luo dokumentti'),
  });
}

// ---------- Dokumentti ja havaintolista ----------

async function viewDoc(id) {
  const doc = await DB.getDoc(id);
  if (!doc) return notFound();
  const items = await DB.getItems(id);
  const open = items.filter((i) => i.status !== 'fixed').length;

  async function toggle(it, badge, e) {
    e.preventDefault();
    e.stopPropagation();
    it.status = it.status === 'fixed' ? 'open' : 'fixed';
    await DB.putItem(it);
    badge.className = 'status ' + it.status;
    badge.textContent = it.status === 'fixed' ? 'Korjattu' : 'Avoin';
  }

  async function makePdf() {
    const msg = h('p', {}, 'Luodaan PDF-raporttia…');
    const close = modal(h('h2', {}, 'PDF-raportti'), msg);
    try {
      const blob = await PDFGen.build(doc, items, photoForPdf, {
        title: TYPES[doc.type].title, typeLabel: TYPES[doc.type].label,
        onProgress: (d, t) => { msg.textContent = `Käsitellään kuvia ${d} / ${t}…`; },
      });
      close();
      const name = `${TYPES[doc.type].label}_${doc.name}_${doc.date || todayISO()}`
        .replace(/[^0-9A-Za-zÅÄÖåäö-]+/g, '_').replace(/^_+|_+$/g, '') + '.pdf';
      const file = new File([blob], name, { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const canShare = navigator.canShare && navigator.canShare({ files: [file] });
      const done = modal(
        h('h2', {}, 'PDF valmis'),
        h('p', {}, `${name} (${(blob.size / 1048576).toFixed(1)} Mt)`),
        canShare ? h('button', {
          class: 'btn primary', onclick: () => navigator.share({ files: [file], title: doc.name }).catch(() => {}),
        }, 'Jaa (sähköposti, WhatsApp…)') : null,
        h('a', { class: 'btn' + (canShare ? '' : ' primary'), href: url, download: name }, 'Tallenna laitteeseen'),
        h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener' }, 'Avaa'),
        h('button', { class: 'btn', onclick: () => { done(); setTimeout(() => URL.revokeObjectURL(url), 60000); } }, 'Sulje'));
    } catch (e) {
      console.error(e);
      close();
      toast('PDF:n luonti epäonnistui: ' + (e && e.message || e));
    }
  }

  const rows = items.map((it) => {
    const badge = h('button', { type: 'button', class: 'status ' + (it.status === 'fixed' ? 'fixed' : 'open') },
      it.status === 'fixed' ? 'Korjattu' : 'Avoin');
    badge.addEventListener('click', (e) => toggle(it, badge, e));
    return h('a', { class: 'item', href: `#/d/${id}/i/${it.id}` },
      it.thumb ? h('img', { src: it.thumb, alt: '' }) : h('span', { class: 'nothumb' }, '–'),
      h('span', { class: 'item-text' },
        h('strong', {}, `${it.num}. ${it.location || 'Havainto'}`),
        h('span', { class: 'desc' }, it.description ||
          (it.audioIds && it.audioIds.length ? '🎤 Äänimuistio (ei tekstiä)' : 'Ei kuvausta')),
        it.responsible ? h('small', {}, 'Vastuu: ' + it.responsible) : null),
      badge);
  });

  return page({
    title: doc.name || 'Dokumentti',
    back: '#/',
    action: h('a', { class: 'bar-btn text', href: `#/d/${id}/info` }, 'Tiedot'),
    body: [
      h('p', { class: 'summary' },
        h('span', { class: 'badge ' + doc.type }, TYPES[doc.type].label),
        ' ' + [fiDate(doc.date), doc.area].filter(Boolean).join(' · '),
        h('br'), `${items.length} havaintoa, ${open} avoinna`),
      rows.length ? rows : h('p', { class: 'empty' },
        'Ei vielä havaintoja. Paina ”Uusi havainto”, ota kuva ja sanele mikä on vikana.'),
    ],
    footer: [
      h('button', { class: 'btn', type: 'button', onclick: makePdf }, 'PDF'),
      h('a', { class: 'btn primary big', href: `#/d/${id}/i/new` }, '＋ Uusi havainto'),
    ],
  });
}

// ---------- Havainnon muokkaus ----------

async function viewItem(docId, itemId) {
  const doc = await DB.getDoc(docId);
  if (!doc) return notFound();
  const all = await DB.getItems(docId);
  let item = itemId === 'new' ? null : all.find((i) => i.id === itemId);
  let persisted = !!item;
  if (!item) {
    if (itemId !== 'new') return notFound();
    const last = all[all.length - 1];
    item = {
      id: uid(), docId, num: all.reduce((m, i) => Math.max(m, i.num), 0) + 1,
      location: last ? last.location : '', description: '', responsible: '', status: 'open',
      photoIds: [], audioIds: [], thumb: null, created: Date.now(),
    };
  }
  item.audioIds = item.audioIds || [];

  let alive = true, dirty = false, timer = null, saving = Promise.resolve();
  const urls = new Map();
  const isEmpty = () => !item.photoIds.length && !item.audioIds.length && !item.description.trim();

  // Tallennus tapahtuu automaattisesti jokaisen muutoksen jälkeen.
  function save() {
    clearTimeout(timer);
    timer = null;
    dirty = false;
    saving = saving.then(async () => {
      item.updated = Date.now();
      await DB.putItem(item);
      persisted = true;
      doc.updated = item.updated;
      await DB.putDoc(doc);
      if (alive && location.hash.endsWith('/i/new')) {
        history.replaceState(null, '', `#/d/${docId}/i/${item.id}`);
      }
    }).catch((e) => { console.error(e); toast('Tallennus epäonnistui'); });
    return saving;
  }
  function changed() {
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(save, 500);
  }

  // --- Valokuvat ---
  const photoStrip = h('div', { class: 'photos' });

  async function mediaUrl(id) {
    if (!urls.has(id)) {
      const m = await DB.getMedia(id);
      urls.set(id, m ? URL.createObjectURL(new Blob([m.data], { type: m.type })) : '');
    }
    return urls.get(id);
  }

  async function renderPhotos() {
    const nodes = [];
    for (const pid of item.photoIds) {
      const url = await mediaUrl(pid);
      nodes.push(h('div', { class: 'photo' },
        h('img', {
          src: url, alt: 'Valokuva',
          onclick: () => { const close = modal(h('img', { class: 'full', src: url, alt: '', onclick: () => close() })); },
        }),
        h('button', { type: 'button', 'aria-label': 'Poista kuva', onclick: () => removePhoto(pid) }, '✕')));
    }
    photoStrip.replaceChildren(...nodes);
  }

  async function addFiles(input) {
    const files = [...input.files];
    input.value = '';
    for (const f of files) {
      try {
        const p = await processPhoto(f);
        const id = uid();
        await DB.putMedia({ id, itemId: item.id, docId, kind: 'photo', data: p.data, type: 'image/jpeg', w: p.w, h: p.h, thumb: p.thumb });
        item.photoIds.push(id);
        if (!item.thumb) item.thumb = p.thumb;
        await save();
      } catch (e) {
        console.error(e);
        toast('Kuvan lisääminen epäonnistui');
      }
    }
    renderPhotos();
  }

  async function removePhoto(pid) {
    if (!confirm('Poistetaanko kuva?')) return;
    item.photoIds = item.photoIds.filter((x) => x !== pid);
    await DB.deleteMedia(pid);
    const first = item.photoIds[0] && await DB.getMedia(item.photoIds[0]);
    item.thumb = first ? first.thumb : null;
    await save();
    renderPhotos();
  }

  const fileInput = (attrs) => h('input', Object.assign({
    type: 'file', accept: 'image/*', class: 'hidden-input', onchange: (e) => addFiles(e.target),
  }, attrs));

  // --- Kuvaus, sanelu ja äänimuistio ---
  const desc = h('textarea', {
    rows: 4, value: item.description, placeholder: 'Mikä on vikana tai puuttuu?',
    oninput: (e) => { item.description = e.target.value; changed(); },
  });
  const voiceStatus = h('p', { class: 'voice-status', hidden: true });
  const setStatus = (t) => { voiceStatus.textContent = t || ''; voiceStatus.hidden = !t; };
  const dictBtn = h('button', { type: 'button', class: 'btn' }, '🎤 Sanele tekstiksi');
  const recBtn = h('button', { type: 'button', class: 'btn' }, '⏺ Äänimuistio');
  const audioList = h('div', { class: 'audios' });

  function appendText(t) {
    t = t.trim();
    if (!t) return;
    const cur = desc.value.trimEnd();
    desc.value = cur ? cur + ' ' + t : t.charAt(0).toUpperCase() + t.slice(1);
    item.description = desc.value;
    changed();
  }

  // Puheentunnistus (vaatii yleensä verkkoyhteyden). Yksi painallus = yksi lause.
  let rec = null;
  function stopDictation() {
    if (rec) { try { rec.stop(); } catch (e) { /* jo pysähtynyt */ } }
  }
  function startDictation() {
    if (rec) { stopDictation(); return; }
    if (recorder) { toast('Lopeta äänimuistio ensin'); return; }
    let failed = null;
    try {
      rec = new SR();
      rec.lang = 'fi-FI';
      rec.interimResults = true;
      rec.continuous = false;
      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) appendText(e.results[i][0].transcript);
          else interim += e.results[i][0].transcript;
        }
        setStatus(interim ? '… ' + interim : 'Kuuntelen, puhu nyt…');
      };
      rec.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') failed = e.error; };
      rec.onend = () => {
        rec = null;
        dictBtn.classList.remove('live');
        dictBtn.textContent = '🎤 Sanele tekstiksi';
        setStatus('');
        if (failed && alive) dictationFailed(failed);
      };
      rec.start();
      dictBtn.classList.add('live');
      dictBtn.textContent = '■ Lopeta sanelu';
      setStatus('Kuuntelen, puhu nyt…');
    } catch (e) {
      rec = null;
      dictationFailed('start');
    }
  }
  function dictationFailed(code) {
    if (code === 'not-allowed') { toast('Mikrofonin käyttö on estetty selaimen asetuksista'); return; }
    toast('Sanelu tekstiksi ei onnistu ilman verkkoa – tallennetaan äänimuistio');
    startRecording();
  }

  // Äänimuistio toimii myös ilman verkkoa; sen voi kirjoittaa tekstiksi myöhemmin.
  let recorder = null, recStopped = null, recTimer = null;
  async function startRecording() {
    if (recorder) { stopRecording(); return; }
    if (rec) stopDictation();
    if (!navigator.mediaDevices || !window.MediaRecorder) { toast('Tämä selain ei tue äänitystä'); return; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      toast('Mikrofonia ei saatu käyttöön');
      return;
    }
    if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
    const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m));
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    const started = Date.now();
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recStopped = new Promise((resolve) => {
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(recTimer);
        recorder = null;
        recBtn.classList.remove('live');
        recBtn.textContent = '⏺ Äänimuistio';
        setStatus('');
        try {
          const blob = new Blob(chunks, { type: mr.mimeType || mime || 'audio/webm' });
          if (blob.size) {
            const id = uid();
            await DB.putMedia({ id, itemId: item.id, docId, kind: 'audio', data: await blob.arrayBuffer(), type: blob.type });
            item.audioIds.push(id);
            await save();
            if (alive) renderAudios();
          }
        } catch (e) {
          console.error(e);
          toast('Äänimuistion tallennus epäonnistui');
        }
        resolve();
      };
    });
    recorder = mr;
    mr.start();
    recBtn.classList.add('live');
    recBtn.textContent = '■ Lopeta äänitys';
    const tick = () => setStatus(`Äänitetään… ${Math.floor((Date.now() - started) / 1000)} s`);
    tick();
    recTimer = setInterval(tick, 1000);
  }
  function stopRecording() {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    return recStopped || Promise.resolve();
  }

  async function renderAudios() {
    const nodes = [];
    for (const aid of item.audioIds) {
      const url = await mediaUrl(aid);
      nodes.push(h('div', { class: 'audio' },
        h('audio', { controls: true, src: url, preload: 'metadata' }),
        h('button', {
          type: 'button', 'aria-label': 'Poista äänimuistio',
          onclick: async () => {
            if (!confirm('Poistetaanko äänimuistio?')) return;
            item.audioIds = item.audioIds.filter((x) => x !== aid);
            await DB.deleteMedia(aid);
            await save();
            renderAudios();
          },
        }, '✕')));
    }
    audioList.replaceChildren(...nodes);
  }

  dictBtn.addEventListener('click', startDictation);
  recBtn.addEventListener('click', startRecording);

  // --- Muut kentät ---
  const uniq = (key) => [...new Set(all.map((i) => (i[key] || '').trim()).filter(Boolean))];
  const datalist = (id, values) => h('datalist', { id }, values.map((v) => h('option', { value: v })));
  const textInput = (key, attrs) => h('input', Object.assign({
    type: 'text', value: item[key] || '', autocomplete: 'off',
    oninput: (e) => { item[key] = e.target.value; changed(); },
  }, attrs));

  async function remove() {
    if (!confirm('Poistetaanko havainto kuvineen?')) return;
    clearTimeout(timer);
    await saving;
    item.photoIds = [];
    item.audioIds = [];
    item.description = '';
    go(`#/d/${docId}`);
  }

  cleanup.push(async () => {
    alive = false;
    stopDictation();
    await stopRecording();
    clearTimeout(timer);
    await saving;
    if (isEmpty()) {
      if (persisted) await DB.deleteItem(item.id);
    } else if (dirty || !persisted) {
      await save();
    }
    urls.forEach((u) => u && URL.revokeObjectURL(u));
  });

  await renderPhotos();
  await renderAudios();

  return page({
    title: `Havainto ${item.num}`,
    back: `#/d/${docId}`,
    body: h('div', { class: 'editor' },
      photoStrip,
      h('div', { class: 'row' },
        h('label', { class: 'btn primary big' }, '📷 Ota kuva', fileInput({ capture: 'environment' })),
        h('label', { class: 'btn' }, 'Galleria', fileInput({ multiple: true }))),
      field('Sijainti / tila', textInput('location', { list: 'dl-loc', placeholder: 'esim. Keittiö, A12' })),
      datalist('dl-loc', uniq('location')),
      field('Kuvaus', desc),
      h('div', { class: 'row' }, SR ? dictBtn : null, recBtn),
      voiceStatus,
      audioList,
      field('Vastuu / urakoitsija', textInput('responsible', { list: 'dl-resp', placeholder: 'esim. Maalari, LVI' })),
      datalist('dl-resp', uniq('responsible')),
      field('Tila', segmented([['open', 'Avoin'], ['fixed', 'Korjattu']], item.status === 'fixed' ? 'fixed' : 'open',
        (v) => { item.status = v; changed(); })),
      h('button', { type: 'button', class: 'btn danger', onclick: remove }, 'Poista havainto')),
    footer: [
      h('a', { class: 'btn', href: `#/d/${docId}` }, 'Valmis'),
      h('button', {
        type: 'button', class: 'btn primary big',
        onclick: () => {
          if (isEmpty()) { toast('Lisää ensin kuva, kuvaus tai äänimuistio'); return; }
          go(`#/d/${docId}/i/new`);
        },
      }, 'Seuraava havainto ›'),
    ],
  });
}

// ---------- Käynnistys ----------

window.addEventListener('hashchange', route);
route();

if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker', e));
}
