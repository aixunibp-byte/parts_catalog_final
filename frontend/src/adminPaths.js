// Секретный адрес админки: /console/<uid>/... Сам uid в сборку НЕ вшит —
// его знает только администратор (ADMIN_URL_UID на сервере), он берётся из
// адресной строки и подставляется в заголовок X-Admin-Uid при каждом запросе
// к /admin* (см. adminApi.js). Без верного uid сервер отвечает 404.
const UID_RE = /^\/console\/([A-Za-z0-9_-]{24,64})(?:\/|$)/;

export function getAdminUid() {
  const match = UID_RE.exec(window.location.pathname);
  return match ? match[1] : null;
}

// adminPath("/parts") -> "/console/<uid>/parts"
export function adminPath(sub = "") {
  return `/console/${getAdminUid() || "_"}${sub}`;
}

export function isAdminPathname(pathname) {
  return pathname.startsWith("/console/");
}
