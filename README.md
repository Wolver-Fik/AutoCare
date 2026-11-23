# AutoCare

**Multilingual vehicle dashboard Â· Tablero del auto multilingÃ¼e**

[![License: PolyForm Noncommercial License 1.0.0](https://img.shields.io/badge/license-PolyForm Noncommercial License 1.0.0-blue.svg)](LICENSE)

**Live demo / Demo en vivo:** **[https://wolver-fik.github.io/AutoCare/](https://wolver-fik.github.io/AutoCare/)**

---

## English

AutoCare is a privacy-first, installable Progressive Web App for keeping track of your vehicle: fuel efficiency, maintenance reminders, document expiry dates and spending â€” all calculated locally in your browser.

### Features

- **Dashboard** â€” odometer, average fuel efficiency gauge, cost per distance, monthly spending and quick actions.
- **Maintenance & documents** â€” reminders by distance, by time or both (whichever comes first), plus insurance, registration and inspection due dates.
- **Analysis & history** â€” efficiency per fill-up, spending per month, where the money goes, and a filterable full history with CSV export.
- **Vehicle card** â€” editable brand, model, year, body type and paint colour, with a lightweight 3D/SVG illustration or an automatically compressed photo (max 600 px, JPEG).
- **8 languages** â€” English, EspaÃ±ol, PortuguÃªs, FranÃ§ais, Italiano, Deutsch, Ð ÑƒÑÑÐºÐ¸Ð¹ and æ—¥æœ¬èªž. Detected from `navigator.language`, remembered in `localStorage`, switchable from the header.
- **Units & currency** â€” metric (km, L, km/L) or imperial (mi, gal, MPG) presets, custom unit combinations, and any valid ISO 4217 currency formatted with `Intl.NumberFormat`.
- **Offline ready** â€” service worker with a network-first strategy for HTML and a cache-first strategy for assets, so the dashboard opens even without a connection.
- **Your data stays yours** â€” everything is stored on the device (`localStorage`, with optional cloud sync when the host provides it). No account is required on GitHub Pages. Export/import a JSON backup at any time from **Settings â†’ Data**.

### Efficiency rules

Efficiency is calculated only between **full-tank fill-ups**. Partial fill-ups are accumulated into the next full one. Distance and amount are stored in metric base units and converted for display, so changing units never corrupts history.

### Deploy

The repository is ready for GitHub Pages: all paths are relative (`./`), `sw.js` is at the root, and `manifest.webmanifest` declares `start_url: "./"`. Publish from the `main` branch at the root folder, then visit **[https://wolver-fik.github.io/AutoCare/](https://wolver-fik.github.io/AutoCare/)**.

### Project structure

```
index.html            app shell, language selector, PWA links
css/styles.css        dark responsive theme
js/i18n.js            translation core (detection, persistence, Intl.PluralRules)
js/i18n/*.js          one module per language
js/storage.js         state, defaults, demo data, import/export, sync status
js/app.js             rendering, calculations, modals, service worker registration
icons/                SVG source + 180/192/512 PNG icons
manifest.webmanifest  PWA manifest
sw.js                 offline cache
```

### License

[PolyForm Noncommercial License 1.0.0](LICENSE) Â© 2026 Wolver-Fik.

---

## EspaÃ±ol

AutoCare es una PWA instalable y centrada en la privacidad para llevar el control de tu vehÃ­culo: rendimiento de combustible, recordatorios de mantenimiento, vencimientos de documentos y gastos. Todo se calcula localmente en tu navegador.

### Funciones

- **Tablero** â€” odÃ³metro, indicador de rendimiento medio, costo por distancia, gasto mensual y acciones rÃ¡pidas.
- **Mantenimiento y documentos** â€” recordatorios por distancia, por tiempo o ambos (se activa el que llegue primero), ademÃ¡s de seguros, patentes e inspecciones.
- **AnÃ¡lisis e historial** â€” rendimiento por carga, gasto por mes, destino del dinero e historial completo filtrable con exportaciÃ³n CSV.
- **Ficha del vehÃ­culo** â€” marca, modelo, aÃ±o, carrocerÃ­a y color editables, con ilustraciÃ³n 3D/SVG ligera o foto comprimida automÃ¡ticamente (mÃ¡x. 600 px, JPEG).
- **8 idiomas** â€” English, EspaÃ±ol, PortuguÃªs, FranÃ§ais, Italiano, Deutsch, Ð ÑƒÑÑÐºÐ¸Ð¹ y æ—¥æœ¬èªž. Se detecta con `navigator.language`, se recuerda en `localStorage` y se cambia desde la cabecera.
- **Unidades y moneda** â€” presets mÃ©trico (km, L, km/L) e imperial (mi, gal, MPG), combinaciones personalizadas y cualquier cÃ³digo ISO 4217 vÃ¡lido formateado con `Intl.NumberFormat`.
- **Funciona sin conexiÃ³n** â€” service worker con red primero para HTML y cachÃ© primero para recursos.
- **Tus datos son tuyos** â€” todo se guarda en el dispositivo (`localStorage`, con sincronizaciÃ³n opcional si el anfitriÃ³n la ofrece). En GitHub Pages no hace falta cuenta. Puedes exportar/importar una copia JSON desde **ConfiguraciÃ³n â†’ Datos**.

### CÃ¡lculo del rendimiento

El rendimiento se calcula solo entre **cargas con tanque lleno**. Las cargas parciales se acumulan en la siguiente carga llena. Distancia y cantidad se guardan en unidades base mÃ©tricas y se convierten al mostrar, asÃ­ que cambiar de unidades nunca corrompe el historial.

### Despliegue

El repositorio estÃ¡ listo para GitHub Pages: todas las rutas son relativas (`./`), `sw.js` estÃ¡ en la raÃ­z y el manifiesto declara `start_url: "./"`. Publica desde la rama `main` en la carpeta raÃ­z y visita **[https://wolver-fik.github.io/AutoCare/](https://wolver-fik.github.io/AutoCare/)**.

### Licencia

[PolyForm Noncommercial License 1.0.0](LICENSE) Â© 2026 Wolver-Fik.

