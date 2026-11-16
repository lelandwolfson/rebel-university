import en from './en.js';

const locales = { en };

// t('manage.matches.some', { n: 3 }) -> string. Values are escaped later by html``.
export function translator(locale = 'en') {
  const dict = locales[locale] || en;
  return function t(key, vars) {
    let v = dict[key] ?? en[key];
    if (v === undefined) return key;
    if (typeof v === 'string' && vars) v = v.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
    return v;
  };
}
