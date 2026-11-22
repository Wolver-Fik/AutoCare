/* AutoCare · Núcleo de internacionalización: detección, persistencia y traducción */
(function (AC) {
  'use strict';

  const LANGS = ['en', 'es', 'pt', 'fr', 'it', 'de', 'ru', 'ja'];
  const LOCALE = { en: 'en-US', es: 'es-ES', pt: 'pt-BR', fr: 'fr-FR', it: 'it-IT', de: 'de-DE', ru: 'ru-RU', ja: 'ja-JP' };
  const KEY = 'autocare-lang';
  const dict = {};
  let lang = 'en';

  function detect() {
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) {}
    if (saved && LANGS.indexOf(saved) >= 0) return saved;
    const nav = (navigator.language || navigator.userLanguage || 'en').toLowerCase().replace('_', '-');
    if (LANGS.indexOf(nav) >= 0) return nav;
    const base = nav.split('-')[0];
    return LANGS.indexOf(base) >= 0 ? base : 'en';
  }

  function interpolate(str, vars) {
    if (!vars) return str;
    return str.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? '' : String(vars[k])));
  }

  function t(key, vars) {
    const table = dict[lang] || dict.en || {};
    let value = table[key];
    if (value === undefined && dict.en) value = dict.en[key];
    if (value === undefined) return key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const n = vars && vars.n !== undefined ? vars.n : 1;
      let cat = 'other';
      try { cat = new Intl.PluralRules(LOCALE[lang] || lang).select(n); } catch (e) {}
      value = value[cat] === undefined ? (value.other === undefined ? (value.one || Object.keys(value).map(k => value[k])[0]) : value.other) : value[cat];
    }
    return interpolate(String(value), vars);
  }

  /* Listas (p. ej. sugerencias de descripción) */
  function tl(key) {
    const table = dict[lang] || dict.en || {};
    let value = Array.isArray(table[key]) ? table[key] : (dict.en && Array.isArray(dict.en[key]) ? dict.en[key] : []);
    return value.slice();
  }

  function apply() {
    const html = document.documentElement;
    html.lang = lang;
    html.dir = 'ltr';
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
    document.querySelectorAll('[data-i18n-title]').forEach(el => { el.setAttribute('title', t(el.dataset.i18nTitle)); });
    try { document.dispatchEvent(new CustomEvent('ac:langchange', { detail: { lang, locale: locale() } })); } catch (e) {}
  }

  function set(next) {
    if (LANGS.indexOf(next) < 0) return false;
    lang = next;
    try { localStorage.setItem(KEY, lang); } catch (e) {}
    apply();
    return true;
  }

  const locale = () => LOCALE[lang] || lang;

  AC.i18n = {
    LANGS, LOCALE, KEY,
    register(code, table) { dict[code] = Object.assign(dict[code] || {}, table); },
    t, tl, apply, set,
    get lang() { return lang; },
    get locale() { return locale(); },
    get table() { return dict[lang] || {}; },
    supported: LANGS
  };

  lang = detect();
  apply();
})(window.AC = window.AC || {});
