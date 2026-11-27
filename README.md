# AutoCare

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-AutoCare-6366F1)](https://wolver-fik.github.io/AutoCare/)

[English](#english) · [Español](#español)

---

## English

AutoCare is a privacy-first, installable Progressive Web App for keeping track of your vehicle: fuel efficiency, maintenance reminders, document expiry dates and spending — all calculated locally in your browser.

### Features

- **Dashboard** — odometer, average fuel efficiency gauge, cost per distance, monthly spending and quick actions.
- **Multi-vehicle garage** — switch between all your vehicles, each with its own odometer, services, documents and expenses.
- **Real cost per kilometre / mile** — fuel, maintenance and fixed costs translated into an accurate cost per distance.
- **Monthly expense comparison** — compare spending month by month to spot trends before they become surprises.
- **Key components & due dates sheet** — keep brakes, tyres, filters, insurance and inspection deadlines in one clear record.
- **Client-side vehicle photo cropping** — crop or reframe your vehicle image locally before saving it; nothing is uploaded.
- **Maintenance & documents** — reminders by distance, by time or both (whichever comes first), plus insurance, registration and inspection due dates.
- **Analysis & history** — efficiency per fill-up, spending per month, where the money goes, and a filterable full history with CSV export.
- **Tyres & depreciation** — track tyre size, fitment, rotation and expected life per vehicle, plus purchase/current value and depreciation; JSON backups carry `schemaVersion`, `appId`, the export date and these records.
- **Fast history & charts** — the history shows 12 entries with a "view more" button and charts plot the last 24 fill-ups, so long garages stay smooth on mobile.
- **Vehicle card** — editable brand, model, year, body type and paint colour, with a lightweight 3D/SVG illustration or an automatically compressed photo (max 600 px, JPEG).
- **8 languages** — English, Español, Português, Français, Italiano, Deutsch, Русский and 日本語. Detected from `navigator.language`, remembered in `localStorage`, switchable from the header.
- **Units & currency** — metric (km, L, km/L) or imperial (mi, gal, MPG) presets, custom unit combinations, and any valid ISO 4217 currency formatted with `Intl.NumberFormat`.
- **Offline ready** — service worker with a network-first strategy for HTML and a cache-first strategy for assets, so the dashboard opens even without a connection.
- **Your data stays yours** — everything is stored on the device (`localStorage`, with optional cloud sync when the host provides it). No account is required on GitHub Pages. Export/import a JSON backup at any time from **Settings → Data**.

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

[PolyForm Noncommercial License 1.0.0](./LICENSE) © 2026 Wolver-Fik.

---

<a id="español"></a>

## Español

AutoCare es una PWA instalable y centrada en la privacidad para llevar el control de tu vehículo: rendimiento de combustible, recordatorios de mantenimiento, vencimientos de documentos y gastos. Todo se calcula localmente en tu navegador.

### Funciones

- **Tablero** — odómetro, indicador de rendimiento medio, costo por distancia, gasto mensual y acciones rápidas.
- **Garaje multi-vehículo** — cambia entre todos tus vehículos, cada uno con su odómetro, mantenimientos, documentos y gastos.
- **Costo real por kilómetro/milla** — combustible, mantenimiento y costes fijos convertidos en un costo exacto por distancia.
- **Comparación mensual de gastos** — contrasta el gasto mes a mes para detectar tendencias antes de que te sorprendan.
- **Ficha de componentes clave y vencimientos** — frenos, neumáticos, filtros, seguro e inspecciones en un único registro claro.
- **Recorte de la foto del vehículo en el cliente** — recorta o reencuadra la imagen en tu dispositivo antes de guardarla; nada se sube.
- **Mantenimiento y documentos** — recordatorios por distancia, por tiempo o ambos (se activa el que llegue primero), además de seguros, patentes e inspecciones.
- **Análisis e historial** — rendimiento por carga, gasto por mes, destino del dinero e historial completo filtrable con exportación CSV.
- **Neumáticos y depreciación** — registra medida, instalación, rotación y vida útil por vehículo, además del valor de compra/actual y su depreciación; el JSON incluye `schemaVersion`, `appId`, la fecha de exportación y estos datos.
- **Historial y gráficos rápidos** — el historial muestra 12 entradas con botón «ver más» y los gráficos usan las últimas 24 cargas, para que garajes largos sigan fluidos en móvil.
- **Ficha del vehículo** — marca, modelo, año, carrocería y color editables, con ilustración 3D/SVG ligera o foto comprimida automáticamente (máx. 600 px, JPEG).
- **8 idiomas** — English, Español, Português, Français, Italiano, Deutsch, Русский y 日本語. Se detecta con `navigator.language`, se recuerda en `localStorage` y se cambia desde la cabecera.
- **Unidades y moneda** — presets métrico (km, L, km/L) e imperial (mi, gal, MPG), combinaciones personalizadas y cualquier código ISO 4217 válido formateado con `Intl.NumberFormat`.
- **Funciona sin conexión** — service worker con red primero para HTML y caché primero para recursos.
- **Tus datos son tuyos** — todo se guarda en el dispositivo (`localStorage`, con sincronización opcional si el anfitrión la ofrece). En GitHub Pages no hace falta cuenta. Puedes exportar/importar una copia JSON desde **Configuración → Datos**.

### Cálculo del rendimiento

El rendimiento se calcula solo entre **cargas con tanque lleno**. Las cargas parciales se acumulan en la siguiente carga llena. Distancia y cantidad se guardan en unidades base métricas y se convierten al mostrar, así que cambiar de unidades nunca corrompe el historial.

### Despliegue

El repositorio está listo para GitHub Pages: todas las rutas son relativas (`./`), `sw.js` está en la raíz y el manifiesto declara `start_url: "./"`. Publica desde la rama `main` en la carpeta raíz y visita **[https://wolver-fik.github.io/AutoCare/](https://wolver-fik.github.io/AutoCare/)**.

### Licencia

[PolyForm Noncommercial License 1.0.0](./LICENSE) © 2026 Wolver-Fik.
