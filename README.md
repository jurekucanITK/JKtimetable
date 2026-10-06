# JKtimetable

Preprosta spletna aplikacija (PWA) za tedenski pregled urnika iz [Wise Timetable](https://www.wise-tt.com/).
Pri vsakem predmetu izbereš svojo skupino za vaje, aplikacija pa prikaže samo tiste ure, ki se te tičejo.

- tedenski pogled, menjava tedna s puščicami ali potegom (swipe)
- izbira skupine za vsak predmet posebej (ali skrij predmet)
- podrobnosti ure ob dotiku: prostor, izvajalci, skupine
- deluje brez povezave (prikaže zadnji naloženi urnik)
- namestljiva na začetni zaslon (iPhone in Android)
- urnik se samodejno osveži prek GitHub Actions, strežnik ni potreben

## Kako deluje

GitHub Actions dvakrat na dan prenese iCal datoteko urnika iz Wise Timetable in jo shrani v `data/urnik.ics`.
GitHub Pages objavi aplikacijo, ki to datoteko prebere in prikaže v brskalniku. Izbrane skupine se hranijo
lokalno na napravi.

## Postavitev za svoj urnik

1. **Forkaj** ta repozitorij (ali ga kopiraj v nov javen repozitorij).
2. **Poišči povezavo do svojega urnika:** v Wise Timetable odpri urnik svoje smeri/letnika in kopiraj
   povezavo za izvoz v iCal. Oblika je približno:
   ```
   https://www.wise-tt.com/web/<šola>/reports?g=<ID>&lang=sl&format=ics
   ```
3. **Vpiši povezavo** v [`.github/workflows/fetch.yml`](.github/workflows/fetch.yml) namesto obstoječe.
4. *Settings → Actions → General → Workflow permissions* → **Read and write permissions** → Save.
5. *Actions → Posodobi urnik → Run workflow* — prvi prenos urnika. Preveri, da se zaključi brez napak.
   Nato se urnik posodablja samodejno.
6. *Settings → Pages*: Source = **Deploy from a branch**, Branch = `main`, mapa `/ (root)` → Save.
   Čez minuto je aplikacija dostopna na `https://<uporabnik>.github.io/<repozitorij>/`.

Urnik posodabljanja lahko spremeniš v vrsticah `cron` v `fetch.yml` (časi so v UTC).

## Namestitev na telefon

- **iPhone:** odpri povezavo v Safariju → Deli → **Dodaj na začetni zaslon**.
- **Android:** odpri povezavo v Chromu → meni ⋮ → **Namesti aplikacijo**.

Ob prvem zagonu izberi svoje skupine. Kasneje jih spremeniš z ⚙︎.

## Uporaba

- ‹ › ali poteg levo/desno: prejšnji/naslednji teden
- dotik naslova: nazaj na tekoči teden
- dotik ure: podrobnosti

## Razvoj

Aplikacija je čisti HTML/CSS/JS brez odvisnosti in gradnje. Za lokalni preizkus zaženi poljuben statični strežnik:

```
npx serve .
```

Datoteke:

| Datoteka | Namen |
| --- | --- |
| `index.html`, `style.css`, `app.js` | aplikacija in razčlenjevalnik iCal |
| `sw.js` | service worker za delovanje brez povezave |
| `manifest.json`, `icons/` | podatki za namestitev in ikone |
| `.github/workflows/fetch.yml` | samodejni prenos urnika |
| `data/urnik.ics` | zadnji preneseni urnik |

Po spremembi kode povečaj številko v `CACHE` v `sw.js` (npr. `jktimetable-v2` → `jktimetable-v3`),
da nameščene aplikacije prevzamejo novo različico.

Razčlenjevanje skupin (npr. `RV - 1. sk`) je prilagojeno obliki opisov v Wise Timetable. Če tvoja šola
uporablja drugačno obliko, prilagodi regularni izraz v funkciji `toEvent` v `app.js`.
