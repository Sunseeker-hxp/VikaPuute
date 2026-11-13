# VikaPuute

Mobiilityökalu itselleluovutusdokumentin sekä vika- ja puutelistan tekemiseen työmaalla.
Kierrä kohde, ota puutteesta valokuva ja sanele mikä on vikana. Lopuksi sovellus tekee PDF-raportin.

## Ominaisuudet

- Toimii Android- ja iPhone-puhelimen selaimessa, ja sen voi lisätä aloitusnäytölle sovellukseksi (PWA).
- Toimii ilman verkkoyhteyttä. Kaikki tiedot ja kuvat tallentuvat vain puhelimeen.
- Havaintoon kuuluu valokuvat, sijainti, kuvaus, vastuutaho ja tila (avoin / korjattu).
- Sanelu tekstiksi puheentunnistuksella (vaatii yleensä verkon) tai äänimuistio (toimii aina).
- PDF-raportti kuvineen, jaettavissa suoraan puhelimesta.

## Rakenne

Ei käännösvaihetta eikä ulkoisia kirjastoja: pelkät staattiset tiedostot.

| Tiedosto | Sisältö |
| --- | --- |
| `index.html`, `styles.css` | Sivupohja ja tyylit |
| `js/app.js` | Näkymät ja toiminnot |
| `js/db.js` | Tallennus laitteen IndexedDB-tietokantaan |
| `js/pdf.js` | PDF-raportin luonti |
| `sw.js`, `manifest.webmanifest` | Offline-käyttö ja asennus aloitusnäytölle |

## Kehitys

Paikallinen testipalvelin (Windows PowerShell), osoite http://localhost:8765/:

```powershell
powershell -ExecutionPolicy Bypass -File tools/serve.ps1
```

Kun muutat sovelluksen tiedostoja, nosta `sw.js`-tiedoston `CACHE`-versionumeroa, jotta puhelimet hakevat uuden version.

## Käyttöönotto puhelimessa

Kamera, mikrofoni ja offline-käyttö vaativat, että sovellus tarjoillaan HTTPS-osoitteesta
(esimerkiksi GitHub Pages). Avaa osoite puhelimella ja valitse selaimen valikosta
”Lisää aloitusnäyttöön” / ”Lisää Koti-valikkoon”.
