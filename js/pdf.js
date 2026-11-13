'use strict';
// Kevyt PDF-kirjoitin ilman ulkoisia kirjastoja (toimii offline-tilassa).
// Tukee Helvetica-tekstiä (WinAnsi, ä/ö/å toimivat), viivoja, täyttöjä ja JPEG-kuvia.
const PDFGen = (() => {
  const PW = 595.28, PH = 841.89, M = 42, CW = PW - 2 * M;
  const FOOT = 30;

  // Helvetican merkkileveydet (1/1000 em), merkit 32–126.
  const WID = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
    667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
    278, 278, 278, 469, 556, 333,
    556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500,
    334, 260, 334, 584];

  const MAP = {
    '€': '\x80', '…': '\x85', 'Š': '\x8a', 'Ž': '\x8e', '‘': '\x91', '’': '\x92', '“': '\x93',
    '”': '\x94', '•': '\x95', '–': '\x96', '—': '\x97', 'š': '\x9a', 'ž': '\x9e', '\t': ' ',
  };

  // Muuntaa tekstin WinAnsi-merkistöön; tuntemattomat merkit korvataan kysymysmerkillä.
  function clean(s) {
    let o = '';
    for (const ch of String(s == null ? '' : s)) {
      if (MAP[ch]) { o += MAP[ch]; continue; }
      const c = ch.codePointAt(0);
      if (c === 13) continue;
      o += (c === 10 || (c >= 32 && c <= 126) || (c >= 160 && c <= 255)) ? ch : '?';
    }
    return o;
  }

  function charW(ch) {
    let c = ch.charCodeAt(0);
    if (c >= 0xc0) {
      const base = ch.normalize('NFD').charCodeAt(0);
      if (base >= 32 && base <= 126) c = base;
    }
    return c >= 32 && c <= 126 ? WID[c - 32] : 556;
  }

  function textW(s, size, bold) {
    let w = 0;
    for (let i = 0; i < s.length; i++) w += charW(s[i]);
    return (w * size) / 1000 * (bold ? 1.08 : 1);
  }

  function wrap(text, size, bold, maxW) {
    const lines = [];
    for (const para of text.split('\n')) {
      let line = '';
      for (let word of para.split(/ +/)) {
        if (!word) continue;
        // Ylipitkä sana pilkotaan merkki kerrallaan.
        while (textW(word, size, bold) > maxW) {
          let n = 1;
          while (n < word.length && textW(word.slice(0, n + 1), size, bold) <= maxW) n++;
          if (line) { lines.push(line); line = ''; }
          lines.push(word.slice(0, n));
          word = word.slice(n);
        }
        const tryLine = line ? line + ' ' + word : word;
        if (textW(tryLine, size, bold) <= maxW) line = tryLine;
        else { lines.push(line); line = word; }
      }
      lines.push(line);
    }
    return lines;
  }

  const esc = (s) => s.replace(/[\\()]/g, '\\$&');
  const n = (v) => String(Math.round(v * 100) / 100);
  const fiDate = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? `${+m[3]}.${+m[2]}.${m[1]}` : (iso || '');
  };

  function enc(s) {
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255;
    return b;
  }

  function serialize(pages, images) {
    const objs = [null, null];
    const add = (parts) => { objs.push(parts); return objs.length; };
    const f1 = add(['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>']);
    const f2 = add(['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>']);
    const xo = images.map((im) => {
      const ref = add([
        `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB ` +
        `/BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`,
        im.bytes, '\nendstream']);
      return `/${im.name} ${ref} 0 R`;
    }).join(' ');
    const res = add([`<< /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> /XObject << ${xo} >> >>`]);
    const kids = pages.map((ops) => {
      const body = enc(ops.join('\n'));
      const c = add([`<< /Length ${body.length} >>\nstream\n`, body, '\nendstream']);
      return add([`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources ${res} 0 R /Contents ${c} 0 R >>`]);
    });
    objs[0] = ['<< /Type /Catalog /Pages 2 0 R >>'];
    objs[1] = [`<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`];

    const out = [];
    let off = 0;
    const push = (p) => { const b = typeof p === 'string' ? enc(p) : p; out.push(b); off += b.length; };
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const offs = [];
    objs.forEach((parts, i) => {
      offs.push(off);
      push(`${i + 1} 0 obj\n`);
      parts.forEach(push);
      push('\nendobj\n');
    });
    const xref = off;
    push(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
      offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join(''));
    push(`trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(out, { type: 'application/pdf' });
  }

  /**
   * Rakentaa raportin.
   * @param doc       dokumentin tiedot
   * @param items     havainnot numerojärjestyksessä
   * @param loadPhoto async (mediaId) => { bytes: Uint8Array (JPEG), w, h } | null
   * @param opts      { title, typeLabel, onProgress(done, total) }
   */
  async function build(doc, items, loadPhoto, opts) {
    const pages = [];
    const images = [];
    let ops, y;

    const newPage = () => { ops = []; pages.push(ops); y = M; };
    const ensure = (hgt) => { if (y + hgt > PH - M - FOOT) newPage(); };
    const text = (s, x, yTop, size, bold, col, target) => (target || ops).push(
      `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${col || '0 0 0'} rg ${n(x)} ${n(PH - yTop)} Td (${esc(s)}) Tj ET`);
    const line = (x1, x2, yTop, col, w, target) => (target || ops).push(
      `${col || '0.78 0.78 0.78'} RG ${w || 0.5} w ${n(x1)} ${n(PH - yTop)} m ${n(x2)} ${n(PH - yTop)} l S`);
    const rect = (x, yTop, w, hh, col) => ops.push(
      `${col} rg ${n(x)} ${n(PH - yTop - hh)} ${n(w)} ${n(hh)} re f`);

    newPage();

    // Otsikkopalkki
    rect(M, y, CW, 34, '0.07 0.2 0.29');
    text(clean(opts.title), M + 12, y + 22.5, 15, true, '1 1 1');
    y += 34 + 20;

    // Perustiedot
    const rows = [
      ['Kohde', doc.name], ['Osoite', doc.address], ['Tarkastettu alue', doc.area],
      ['Päivämäärä', fiDate(doc.date)], ['Tarkastaja', doc.inspector],
      ['Osallistujat', doc.participants], ['Lisätiedot', doc.notes],
    ].filter((r) => r[1] && String(r[1]).trim());
    for (const [label, value] of rows) {
      const lines = wrap(clean(value), 10, false, CW - 115);
      ensure(lines.length * 14);
      text(clean(label), M, y, 10, true, '0.25 0.25 0.25');
      for (const l of lines) { text(l, M + 115, y, 10); y += 14; }
      y += 2;
    }
    const open = items.filter((i) => i.status !== 'fixed').length;
    y += 6;
    text(clean(`Havaintoja yhteensä ${items.length}, avoinna ${open}, korjattu ${items.length - open}.`), M, y, 10, true);
    y += 10;
    line(M, PW - M, y, '0.07 0.2 0.29', 1);
    y += 20;

    // Havainnot
    const colW = (CW - 10) / 2, maxH = 195;
    const totalPhotos = items.reduce((s, i) => s + (i.photoIds || []).length, 0);
    let donePhotos = 0;

    for (const it of items) {
      const photos = [];
      for (const pid of it.photoIds || []) {
        const p = await loadPhoto(pid);
        if (p) {
          const sc = Math.min(colW / p.w, maxH / p.h);
          const name = 'Im' + (images.length + 1);
          images.push({ name, bytes: p.bytes, w: p.w, h: p.h });
          photos.push({ name, w: p.w * sc, h: p.h * sc });
        }
        donePhotos++;
        if (opts.onProgress) opts.onProgress(donePhotos, totalPhotos);
      }

      const fixed = it.status === 'fixed';
      const tag = fixed ? 'KORJATTU' : 'AVOIN';
      const tagW = textW(tag, 9, true);
      const headLines = wrap(clean(`${it.num}. ${it.location || 'Havainto'}`), 11.5, true, CW - tagW - 16);
      const descLines = it.description && it.description.trim() ? wrap(clean(it.description.trim()), 10, false, CW) : [];
      const meta = it.responsible && it.responsible.trim() ? clean('Vastuu: ' + it.responsible.trim()) : '';
      const firstRowH = photos.length ? Math.max(photos[0].h, photos[1] ? photos[1].h : 0) + 8 : 0;
      const need = headLines.length * 15 + descLines.length * 13.5 + (meta ? 15 : 0) + firstRowH + 6;
      ensure(Math.min(need, PH - 2 * M - FOOT));

      text(tag, PW - M - tagW, y, 9, true, fixed ? '0.1 0.5 0.2' : '0.78 0.16 0.1');
      for (const l of headLines) { text(l, M, y, 11.5, true); y += 15; }
      for (const l of descLines) { ensure(13.5); text(l, M, y, 10); y += 13.5; }
      if (meta) { ensure(15); text(meta, M, y + 1, 9, false, '0.35 0.35 0.35'); y += 15; }
      if (it.audioIds && it.audioIds.length && !descLines.length) {
        ensure(14);
        text(clean('(Äänimuistio tallennettu sovellukseen, ei kirjoitettu tekstiksi)'), M, y + 1, 9, false, '0.45 0.45 0.45');
        y += 14;
      }

      for (let i = 0; i < photos.length; i += 2) {
        const pair = photos.slice(i, i + 2);
        const rowH = Math.max(...pair.map((p) => p.h));
        ensure(rowH + 8);
        y -= 4;
        pair.forEach((p, k) => ops.push(
          `q ${n(p.w)} 0 0 ${n(p.h)} ${n(M + k * (colW + 10))} ${n(PH - y - p.h)} cm /${p.name} Do Q`));
        y += rowH + 12;
      }

      y += 2;
      line(M, PW - M, y - 8);
      y += 12;
    }

    if (!items.length) { text(clean('Ei havaintoja.'), M, y, 10); y += 20; }

    // Allekirjoitukset
    ensure(95);
    y += 14;
    text('Allekirjoitukset', M, y, 11, true);
    y += 48;
    const sw = 215;
    line(M, M + sw, y, '0.2 0.2 0.2', 0.7);
    line(PW - M - sw, PW - M, y, '0.2 0.2 0.2', 0.7);
    text('Tarkastaja', M, y + 12, 9, false, '0.35 0.35 0.35');
    text(clean('Vastaava työnjohtaja'), PW - M - sw, y + 12, 9, false, '0.35 0.35 0.35');
    if (doc.inspector) text(clean(doc.inspector), M, y + 24, 9);

    // Alatunnisteet
    const left = clean(`${doc.name || ''} – ${opts.typeLabel}`).slice(0, 90);
    pages.forEach((p, i) => {
      line(M, PW - M, PH - M - 6, '0.8 0.8 0.8', 0.5, p);
      text(left, M, PH - M + 6, 8, false, '0.4 0.4 0.4', p);
      const pg = `Sivu ${i + 1} / ${pages.length}`;
      text(pg, PW - M - textW(pg, 8, false), PH - M + 6, 8, false, '0.4 0.4 0.4', p);
    });

    return serialize(pages, images);
  }

  return { build };
})();
