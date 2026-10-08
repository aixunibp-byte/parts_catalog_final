import { ThemeProvider, CssBaseline } from "@mui/material";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useMemo } from "react";
import { getTheme } from "./theme";
import { ThemeModeProvider, useThemeMode } from "./ThemeModeContext";

import CatalogPage from "./pages/CatalogPage";
import PartDetailsPage from "./pages/PartDetailsPage";
import AboutPage from "./pages/AboutPage";
import AdminLoginPage from "./pages/AdminLoginPage";
import AdminPartsListPage from "./pages/AdminPartsListPage";
import AdminPartEditPage from "./pages/AdminPartEditPage";
import AdminSettingsPage from "./pages/AdminSettingsPage";
import AdminSyncPage from "./pages/AdminSyncPage";
import AdminUsersPage from "./pages/AdminUsersPage";
import AdminGate from "./components/AdminGate";

function AppContent() {
  const { mode } = useThemeMode();
  const theme = useMemo(() => getTheme(mode), [mode]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<CatalogPage />} />
          <Route path="/parts/:id" element={<PartDetailsPage />} />
          <Route path="/about" element={<AboutPage />} />

          {/* Админка живёт только по секретному адресу /console/<uid>/...
              (ADMIN_URL_UID на сервере). Обычных /admin/* на сайте нет. */}
          <Route path="/console/:adminUid" element={<AdminGate />}>
            <Route index element={<Navigate to="parts" replace />} />
            <Route path="login" element={<AdminLoginPage />} />
            <Route path="parts" element={<AdminPartsListPage />} />
            <Route path="parts/:id" element={<AdminPartEditPage />} />
            <Route path="settings" element={<AdminSettingsPage />} />
            <Route path="sync" element={<AdminSyncPage />} />
            <Route path="users" element={<AdminUsersPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default function App() {
  return (
    <ThemeModeProvider>
      <AppContent />
    </ThemeModeProvider>
  );
}
