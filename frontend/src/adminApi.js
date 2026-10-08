import axios from "axios";
import { getAdminUid } from "./adminPaths";

// Именные учётные записи с ролями (viewer/editor/full) вместо общего
// ADMIN_TOKEN — токен сессии выдаётся при логине (/admin/auth/login) и
// живёт ограниченное время (по умолчанию 12 ч абсолютно / 2 ч простоя —
// SESSION_ABSOLUTE_HOURS и SESSION_IDLE_MINUTES на сервере) или до отзыва
// (logout, смена пароля, деактивация пользователя администратором).
const TOKEN_KEY = "admin_token";
const USER_KEY = "admin_user";

export function setAdminToken(token) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export function getAdminToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

// Кэш текущего пользователя (id/username/role) — чтобы не дожидаться сети
// для мгновенного role-gating интерфейса (скрыть кнопку и т.п.). Источник
// истины всё равно сервер: /admin/auth/me перепроверяет при каждой загрузке
// защищённой страницы, см. useCurrentUser в useAdminGuard.js.
export function setCachedAdminUser(user) {
  if (user) sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  else sessionStorage.removeItem(USER_KEY);
}

export function getCachedAdminUser() {
  try {
    const raw = sessionStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearAdminSession() {
  setAdminToken(null);
  setCachedAdminUser(null);
}

const ROLE_LEVELS = { viewer: 0, editor: 1, full: 2 };

// Помогает решить, показывать ли кнопку/поле для действия, требующего
// минимум min роли — например hasRole(user, "editor"). Сервер всё равно
// перепроверяет права на каждом запросе, это только для UI.
export function hasRole(user, min) {
  if (!user) return false;
  return (ROLE_LEVELS[user.role] ?? -1) >= (ROLE_LEVELS[min] ?? Infinity);
}

const client = axios.create({ baseURL: "/api", timeout: 15000 });

client.interceptors.request.use((config) => {
  const token = getAdminToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // Все запросы к /admin* несут секретный uid из адресной строки
  // (/console/<uid>/...). Без него сервер отвечает 404.
  if (typeof config.url === "string" && config.url.startsWith("/admin")) {
    const uid = getAdminUid();
    if (uid) config.headers["X-Admin-Uid"] = uid;
  }
  return config;
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 || error.response?.status === 403) {
      // 403 бывает и из-за нехватки роли на конкретном действии (не значит
      // "сессия недействительна") — сбрасываем сессию только на 401.
      if (error.response?.status === 401) {
        clearAdminSession();
      }
    }
    return Promise.reject(error);
  }
);

// --- Авторизация ---

// Проверка секретного uid из адреса (200 — верный, иначе 404).
export async function pingAdmin() {
  const { data } = await client.get("/admin/ping");
  return data;
}

export async function login(username, password) {
  const { data } = await client.post("/admin/auth/login", { username, password });
  setAdminToken(data.token);
  setCachedAdminUser(data.user);
  return data.user;
}

export async function logout() {
  try {
    await client.post("/admin/auth/logout");
  } finally {
    clearAdminSession();
  }
}

export async function fetchMe() {
  const { data } = await client.get("/admin/auth/me");
  setCachedAdminUser(data);
  return data;
}

// --- Управление пользователями (только роль full) ---

export async function fetchUsers() {
  const { data } = await client.get("/admin/users");
  return data;
}

export async function createUser(payload) {
  const { data } = await client.post("/admin/users", payload);
  return data;
}

export async function updateUser(id, payload) {
  const { data } = await client.patch(`/admin/users/${id}`, payload);
  return data;
}

export async function fetchAdminParts({ search = "", onlyEdited = false, page = 1, pageSize = 50 } = {}) {
  const { data } = await client.get("/admin/parts", {
    params: { search: search || undefined, only_edited: onlyEdited, page, page_size: pageSize },
  });
  return data;
}

export async function fetchAdminPart(id) {
  const { data } = await client.get(`/admin/parts/${id}`);
  return data;
}

export async function updatePartContent(id, payload) {
  const { data } = await client.patch(`/admin/parts/${id}`, payload);
  return data;
}

export async function revertToSync(id) {
  const { data } = await client.post(`/admin/parts/${id}/revert-to-sync`, { confirm: true });
  return data;
}

export async function uploadImage(id, file, setAsPrimary = false) {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await client.post(
    `/admin/parts/${id}/images/upload?set_as_primary=${setAsPrimary}`,
    formData,
    { headers: { "Content-Type": "multipart/form-data" } }
  );
  return data;
}

// Заменяет файл у существующего фото; uid и публичный адрес фото не меняются.
export async function replaceImage(id, imageUid, file) {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await client.post(
    `/admin/parts/${id}/images/${imageUid}/replace`,
    formData,
    { headers: { "Content-Type": "multipart/form-data" } }
  );
  return data;
}

export async function addImageByUrl(id, url, setAsPrimary = false) {
  const { data } = await client.post(`/admin/parts/${id}/images/by-url`, {
    url, set_as_primary: setAsPrimary,
  });
  return data;
}

export async function deleteImage(id, imageUrl) {
  const { data } = await client.delete(`/admin/parts/${id}/images`, {
    params: { image_url: imageUrl },
  });
  return data;
}

export async function reorderImages(id, images) {
  const { data } = await client.put(`/admin/parts/${id}/images/reorder`, { images });
  return data;
}

export async function fetchAuditLog(id) {
  const { data } = await client.get(`/admin/parts/${id}/audit-log`);
  return data;
}

export async function fetchAdminSettings() {
  const { data } = await client.get("/admin/settings");
  return data;
}

export async function updateSiteSettings(payload) {
  const { data } = await client.put("/admin/settings", payload);
  return data;
}

export async function fetchSyncStatus() {
  const { data } = await client.get("/admin/sync/status");
  return data;
}

export async function fetchSyncHistory(limit = 20, source = null) {
  const { data } = await client.get("/admin/sync/history", { params: { limit, source: source || undefined } });
  return data;
}

export async function fetchSyncSettings() {
  const { data } = await client.get("/admin/sync/settings");
  return data;
}

export async function updateSyncSettings(payload) {
  const { data } = await client.put("/admin/sync/settings", payload);
  return data;
}

export async function triggerSync(downloadImages = null) {
  const { data } = await client.post("/admin/sync/run", { download_images: downloadImages });
  return data;
}

export async function triggerFtpSync() {
  const { data } = await client.post("/admin/sync/run-ftp");
  return data;
}

export async function testFtpConnection(payload = {}) {
  const { data } = await client.post("/admin/sync/ftp/test", payload);
  return data;
}

export async function fetchSyncSelfcheck() {
  const { data } = await client.get("/admin/sync/selfcheck");
  return data;
}

