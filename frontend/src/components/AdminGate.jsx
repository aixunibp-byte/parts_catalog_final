import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { pingAdmin } from "../adminApi";

// Охранник секретного адреса /console/<uid>/...: пока сервер не подтвердил
// uid (GET /admin/ping), не показываем ничего — ни форму входа, ни заглушку.
// При неверном uid уводим на главную, как будто такой страницы нет.
export default function AdminGate() {
  const [state, setState] = useState("checking");

  useEffect(() => {
    let cancelled = false;
    pingAdmin()
      .then(() => {
        if (!cancelled) setState("ok");
      })
      .catch(() => {
        if (!cancelled) setState("denied");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "denied") return <Navigate to="/" replace />;
  if (state !== "ok") return null;
  return <Outlet />;
}
