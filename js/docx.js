'use strict';
// Word-raportin (.docx) luonti ilman ulkoisia kirjastoja (toimii offline-tilassa).
// .docx on zip-paketti, jossa on XML-tiedostoja ja kuvat; paketti kirjoitetaan pakkaamatta.
const DOCXGen = (() => {
  const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const NS_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const TEXT_W = 9638; // tekstialueen leveys (twip), A4 ja 2 cm marginaalit
  const utf8 = new TextEncoder();

  // ---------- ZIP ----------

  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(b) {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zip(files) {
    const parts = [], central = [];
    let off = 0;
    for (const f of files) {
      const data = typeof f.data === 'string' ? utf8.encode(f.data) : f.data;
      const name = utf8.encode(f.name);
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true);
      lh.setUint16(12, 0x21, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true);
      lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(14, 0x21, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true);
      ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true);
      ch.setUint32(42, off, true);
      central.push(new Uint8Array(ch.buffer), name);
      off += 30 + name.length + data.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, central.reduce((s, p) => s + p.length, 0), true);
    end.setUint32(16, off, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: MIME });
  }

  // ---------- WordprocessingML ----------

  const x = (s) => String(s == null ? '' : s)
    .replace(/[^\x09\x0A\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // o: { bold, color ('RRGGBB'), size (pt) }
  function run(text, o) {
    o = o || {};
    const rpr = (o.bold ? '<w:b/>' : '') + (o.color ? `<w:color w:val="${o.color}"/>` : '') +
      (o.size ? `<w:sz w:val="${o.size * 2}"/><w:szCs w:val="${o.size * 2}"/>` : '');
    const body = x(text).split('\n').map((t) => `<w:t xml:space="preserve">${t}</w:t>`).join('<w:br/>');
    return `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}${body}</w:r>`;
  }

  // o: { keepNext, borderTop, shade ('RRGGBB'), rightTab, before, after (twip) }
  function para(runs, o) {
    o = o || {};
    const ppr = (o.keepNext ? '<w:keepNext/>' : '') +
      (o.borderTop ? '<w:pBdr><w:top w:val="single" w:sz="4" w:space="6" w:color="C8C8C8"/></w:pBdr>' : '') +
      (o.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.shade}"/>` : '') +
      (o.rightTab ? `<w:tabs><w:tab w:val="right" w:pos="${TEXT_W}"/></w:tabs>` : '') +
      (o.before != null || o.after != null
        ? `<w:spacing w:before="${o.before || 0}" w:after="${o.after == null ? 80 : o.after}"/>` : '');
    return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${runs}</w:p>`;
  }

  const TAB = '<w:r><w:tab/></w:r>';

  function table(widths, rows) {
    return '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>' +
      widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('') + '</w:tblGrid>' +
      rows.map((cells) => '<w:tr>' + cells.map((c, i) =>
        `<w:tc><w:tcPr><w:tcW w:w="${widths[i]}" w:type="dxa"/></w:tcPr>${c}</w:tc>`).join('') + '</w:tr>').join('') +
      '</w:tbl>';
  }

  // Kuva tekstin seassa; mitat pisteinä.
  function picture(n, relId, wPt, hPt) {
    const cx = Math.round(wPt * 12700), cy = Math.round(hPt * 12700);
    return '<w:r><w:drawing>' +
      `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
      `<wp:docPr id="${n}" name="Kuva ${n}"/>` +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      `<pic:nvPicPr><pic:cNvPr id="${n}" name="image${n}.jpg"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  }

  const fiDate = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? `${+m[3]}.${+m[2]}.${m[1]}` : (iso || '');
  };

  /**
   * Rakentaa Word-raportin. Parametrit kuten PDFGen.build:
   * loadPhoto: async (mediaId) => { bytes: Uint8Array (JPEG), w, h } | null
   * opts: { title, typeLabel, onProgress(done, total) }
   */
  async function build(doc, items, loadPhoto, opts) {
    const media = [];
    const body = [];

    body.push(para(run(' ' + opts.title, { bold: true, size: 15, color: 'FFFFFF' }),
      { shade: '12324A', before: 0, after: 200 }));

    const rows = [
      ['Kohde', doc.name], ['Osoite', doc.address], ['Tarkastettu alue', doc.area],
      ['Päivämäärä', fiDate(doc.date)], ['Tarkastaja', doc.inspector],
      ['Osallistujat', doc.participants], ['Lisätiedot', doc.notes],
    ].filter((r) => r[1] && String(r[1]).trim());
    if (rows.length) {
      body.push(table([2300, TEXT_W - 2300], rows.map(([label, value]) => [
        para(run(label, { bold: true, color: '404040' }), { after: 40 }),
        para(run(String(value).trim()), { after: 40 }),
      ])));
    }

    const open = items.filter((i) => i.status !== 'fixed').length;
    body.push(para(run(`Havaintoja yhteensä ${items.length}, avoinna ${open}, korjattu ${items.length - open}.`,
      { bold: true }), { before: 160, after: 160 }));

    const maxW = 235, maxH = 190;
    const totalPhotos = items.reduce((s, i) => s + (i.photoIds || []).length, 0);
    let donePhotos = 0;

    for (const it of items) {
      const pics = [];
      for (const pid of it.photoIds || []) {
        const p = await loadPhoto(pid);
        if (p) {
          const n = media.length + 1;
          media.push(p.bytes);
          const sc = Math.min(maxW / p.w, maxH / p.h);
          pics.push(picture(n, 'rIdImg' + n, p.w * sc, p.h * sc));
        }
        donePhotos++;
        if (opts.onProgress) opts.onProgress(donePhotos, totalPhotos);
      }

      const fixed = it.status === 'fixed';
      const desc = (it.description || '').trim();
      const resp = (it.responsible || '').trim();
      body.push(para(
        run(`${it.num}. ${it.location || 'Havainto'}`, { bold: true, size: 11.5 }) + TAB +
        run(fixed ? 'KORJATTU' : 'AVOIN', { bold: true, size: 9, color: fixed ? '1A8033' : 'C7291A' }),
        { keepNext: true, borderTop: true, rightTab: true, before: 200, after: 60 }));
      if (desc) body.push(para(run(desc), { keepNext: pics.length > 0 || !!resp, after: 60 }));
      else if (it.audioIds && it.audioIds.length) {
        body.push(para(run('(Äänimuistio tallennettu sovellukseen, ei kirjoitettu tekstiksi)', { size: 9, color: '737373' }),
          { keepNext: pics.length > 0 || !!resp, after: 60 }));
      }
      if (resp) body.push(para(run('Vastuu: ' + resp, { size: 9, color: '595959' }), { keepNext: pics.length > 0, after: 60 }));
      for (let i = 0; i < pics.length; i += 2) {
        body.push(para(pics.slice(i, i + 2).join(run('  ')), { before: 40, after: 80 }));
      }
    }
    if (!items.length) body.push(para(run('Ei havaintoja.')));

    // Allekirjoitukset
    const half = TEXT_W / 2;
    const sig = (label, name) =>
      para(run('______________________________'), { keepNext: true, before: 500, after: 20 }) +
      para(run(label, { size: 9, color: '595959' }), { after: 20 }) +
      para(run(name || '', { size: 9 }), { after: 0 });
    body.push(para(run('Allekirjoitukset', { bold: true, size: 11 }), { keepNext: true, borderTop: true, before: 300 }));
    body.push(table([half, half], [[sig('Tarkastaja', doc.inspector), sig('Vastaava työnjohtaja', '')]]));
    body.push(para(''));

    const documentXml = XML +
      `<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}" ` +
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>' +
      body.join('') +
      '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/>' +
      '<w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/>' +
      '</w:sectPr></w:body></w:document>';

    const small = { size: 8, color: '666666' };
    const fld = (code) => '<w:r><w:rPr><w:color w:val="666666"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr>' +
      `<w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${code} </w:instrText></w:r>` +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' + run('1', small) + '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
    const footerXml = XML + `<w:ftr xmlns:w="${NS_W}">` +
      para(run(`${doc.name || ''} – ${opts.typeLabel}`, small) + TAB + run('Sivu ', small) + fld('PAGE') +
        run(' / ', small) + fld('NUMPAGES'), { rightTab: true }) + '</w:ftr>';

    const stylesXml = XML + `<w:styles xmlns:w="${NS_W}"><w:docDefaults>` +
      '<w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>' +
      '<w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="fi-FI"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
      '</w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '</w:styles>';

    const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const files = [
      {
        name: '[Content_Types].xml',
        data: XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Default Extension="jpg" ContentType="image/jpeg"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
          '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
          '</Types>',
      },
      {
        name: '_rels/.rels',
        data: XML + `<Relationships xmlns="${NS_REL}">` +
          `<Relationship Id="rId1" Type="${OD}/officeDocument" Target="word/document.xml"/></Relationships>`,
      },
      { name: 'word/document.xml', data: documentXml },
      {
        name: 'word/_rels/document.xml.rels',
        data: XML + `<Relationships xmlns="${NS_REL}">` +
          `<Relationship Id="rIdStyles" Type="${OD}/styles" Target="styles.xml"/>` +
          `<Relationship Id="rIdFooter" Type="${OD}/footer" Target="footer1.xml"/>` +
          media.map((_, i) => `<Relationship Id="rIdImg${i + 1}" Type="${OD}/image" Target="media/image${i + 1}.jpg"/>`).join('') +
          '</Relationships>',
      },
      { name: 'word/styles.xml', data: stylesXml },
      { name: 'word/footer1.xml', data: footerXml },
      ...media.map((bytes, i) => ({ name: `word/media/image${i + 1}.jpg`, data: bytes })),
    ];
    return zip(files);
  }

  return { build, MIME };
})();
