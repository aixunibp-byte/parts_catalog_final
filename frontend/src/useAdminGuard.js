import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAdminToken, fetchMe, getCachedAdminUser, hasRole } from "./adminApi";
import { adminPath } from "./adminPaths";

export function useNavigateToLoginIfNoToken() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!getAdminToken()) {
      navigate(adminPath("/login"), { replace: true });
    }
  }, [navigate]);
}

// Загружает текущего пользователя (id/username/role) с сервера — источник
// истины для role-gating интерфейса (скрыть/задизейблить кнопки действий,
// на которые не хватает роли; сервер всё равно перепроверяет на каждом
// запросе, это только для UX). Пока грузится — отдаёт закэшированного
// пользователя (если логинились раньше в этой вкладке), чтобы не мигал
// интерфейс. Если токен оказался недействителен — уводит на страницу входа.
export function useCurrentUser() {
  const navigate = useNavigate();
  const [user, setUser] = useState(() => getCachedAdminUser());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getAdminToken()) {
      navigate(adminPath("/login"), { replace: true });
      return;
    }
    let cancelled = false;
    fetchMe()
      .then((data) => {
        if (!cancelled) setUser(data);
      })
      .catch(() => {
        if (!cancelled) navigate(adminPath("/login"), { replace: true });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { user, loading, can: (minRole) => hasRole(user, minRole) };
}
