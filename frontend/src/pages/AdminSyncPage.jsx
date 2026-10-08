import { useCallback, useEffect, useRef, useState } from "react";
import {
  Container, Paper, Typography, Stack, Grid, Chip, Alert, Button,
  CircularProgress, TextField, FormControlLabel, Switch, Divider,
  Table, TableHead, TableBody, TableRow, TableCell, Box, Tooltip, List,
  ListItem, ListItemIcon, ListItemText,
} from "@mui/material";
import SyncIcon from "@mui/icons-material/Sync";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import InventoryIcon from "@mui/icons-material/Inventory";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import AppHeader from "../components/AppHeader";
import { useNavigateToLoginIfNoToken, useCurrentUser } from "../useAdminGuard";
import {
  fetchSyncStatus, fetchSyncHistory, fetchSyncSettings, updateSyncSettings,
  triggerSync, triggerFtpSync, testFtpConnection, fetchSyncSelfcheck,
} from "../adminApi";

const STATUS_LABELS = {
  running: { label: "Выполняется", color: "info" },
  success: { label: "Успешно", color: "success" },
  success_with_errors: { label: "Успешно, с ошибками", color: "warning" },
  failed: { label: "Ошибка", color: "error" },
  never_run: { label: "Ещё не запускалась", color: "default" },
};

function StatusChip({ status }) {
  const meta = STATUS_LABELS[status] || { label: status || "—", color: "default" };
  return <Chip size="small" label={meta.label} color={meta.color} />;
}

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ru-RU");
}

function formatDuration(seconds) {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.round(seconds)} сек`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes} мин ${rest} сек`;
}

function CheckRow({ ok, message, name }) {
  const icon =
    ok === true ? <CheckCircleIcon fontSize="small" color="success" /> :
    ok === false ? <CancelIcon fontSize="small" color="error" /> :
    <HelpOutlineIcon fontSize="small" color="disabled" />;
  return (
    <ListItem disableGutters sx={{ py: 0.75 }}>
      <ListItemIcon sx={{ minWidth: 36 }}>{icon}</ListItemIcon>
      <ListItemText primary={name} secondary={message} />
    </ListItem>
  );
}

export default function AdminSyncPage() {
  useNavigateToLoginIfNoToken();
  const { can } = useCurrentUser();
  // Запуск синхронизации и изменение настроек (Ozon/FTP) — только роль full,
  // сервер требует то же самое на всех мутирующих эндпоинтах /admin/sync/*.
  // viewer/editor видят статус, историю и самопроверку, но не могут менять.
  const canEdit = can("full");

  const [status, setStatus] = useState(null);
  const [ozonHistory, setOzonHistory] = useState([]);
  const [ftpHistory, setFtpHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [ozonRunning, setOzonRunning] = useState(false);
  const [ftpRunning, setFtpRunning] = useState(false);
  const [skipPhotosOnRun, setSkipPhotosOnRun] = useState(false);
  const [runError, setRunError] = useState(null);

  const [ozonForm, setOzonForm] = useState(null);
  const [ozonSaving, setOzonSaving] = useState(false);
  const [ozonSaveMsg, setOzonSaveMsg] = useState(null);

  const [ftpForm, setFtpForm] = useState(null);
  const [ftpPasswordSet, setFtpPasswordSet] = useState(false);
  const [ftpNewPassword, setFtpNewPassword] = useState("");
  const [ftpSaving, setFtpSaving] = useState(false);
  const [ftpSaveMsg, setFtpSaveMsg] = useState(null);
  const [ftpTesting, setFtpTesting] = useState(false);
  const [ftpTestResult, setFtpTestResult] = useState(null);

  const [selfcheck, setSelfcheck] = useState(null);
  const [selfcheckLoading, setSelfcheckLoading] = useState(false);

  const pollRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const [statusData, ozonHist, ftpHist] = await Promise.all([
        fetchSyncStatus(),
        fetchSyncHistory(15, "ozon"),
        fetchSyncHistory(15, "ftp"),
      ]);
      setStatus(statusData);
      setOzonHistory(ozonHist);
      setFtpHistory(ftpHist);
      setError(null);
      return statusData;
    } catch {
      setError("Не удалось загрузить статус синхронизации.");
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [statusData, settingsData] = await Promise.all([
        refresh(),
        fetchSyncSettings().catch(() => null),
      ]);
      if (cancelled) return;
      if (settingsData) {
        setOzonForm({
          interval_minutes: settingsData.interval_minutes,
          auto_sync_enabled: settingsData.auto_sync_enabled,
          download_images_enabled: settingsData.download_images_enabled,
        });
        setFtpForm({
          ftp_enabled: settingsData.ftp_enabled,
          ftp_interval_minutes: settingsData.ftp_interval_minutes,
          ftp_host: settingsData.ftp_host || "",
          ftp_port: settingsData.ftp_port || 21,
          ftp_user: settingsData.ftp_user || "",
          ftp_remote_path: settingsData.ftp_remote_path || "",
          ftp_use_tls: settingsData.ftp_use_tls,
        });
        setFtpPasswordSet(!!settingsData.ftp_password_set);
      }
      setLoading(false);
      if (statusData?.ozon?.last_run?.status === "running") setOzonRunning(true);
      if (statusData?.ftp?.last_run?.status === "running") setFtpRunning(true);
    })();
    return () => { cancelled = true; };
  }, [refresh]);

  useEffect(() => {
    clearInterval(pollRef.current);
    const anyRunning = ozonRunning || ftpRunning;
    const intervalMs = anyRunning ? 4000 : 20000;
    pollRef.current = setInterval(async () => {
      const data = await refresh();
      if (data?.ozon?.last_run?.status && data.ozon.last_run.status !== "running") setOzonRunning(false);
      if (data?.ftp?.last_run?.status && data.ftp.last_run.status !== "running") setFtpRunning(false);
    }, intervalMs);
    return () => clearInterval(pollRef.current);
  }, [ozonRunning, ftpRunning, refresh]);

  async function handleRunOzon() {
    setRunError(null);
    try {
      await triggerSync(skipPhotosOnRun ? false : null);
      setOzonRunning(true);
      await refresh();
    } catch (e) {
      setRunError(
        e.response?.status === 409 ? "Синхронизация с Ozon уже выполняется." : "Не удалось запустить синхронизацию."
      );
    }
  }

  async function handleRunFtp() {
    setRunError(null);
    try {
      await triggerFtpSync();
      setFtpRunning(true);
      await refresh();
    } catch (e) {
      setRunError(
        e.response?.status === 409 ? "Импорт цен с FTP уже выполняется." : "Не удалось запустить импорт цен."
      );
    }
  }

  async function handleSaveOzon() {
    setOzonSaving(true);
    setOzonSaveMsg(null);
    try {
      await updateSyncSettings({
        interval_minutes: Number(ozonForm.interval_minutes),
        auto_sync_enabled: ozonForm.auto_sync_enabled,
        download_images_enabled: ozonForm.download_images_enabled,
      });
      setOzonSaveMsg({ type: "success", text: "Настройки сохранены." });
      refresh();
    } catch {
      setOzonSaveMsg({ type: "error", text: "Не удалось сохранить настройки." });
    } finally {
      setOzonSaving(false);
    }
  }

  function ftpFormPayload() {
    const payload = {
      ftp_enabled: ftpForm.ftp_enabled,
      ftp_interval_minutes: Number(ftpForm.ftp_interval_minutes),
      ftp_host: ftpForm.ftp_host,
      ftp_port: Number(ftpForm.ftp_port),
      ftp_user: ftpForm.ftp_user,
      ftp_remote_path: ftpForm.ftp_remote_path,
      ftp_use_tls: ftpForm.ftp_use_tls,
    };
    if (ftpNewPassword) payload.ftp_password = ftpNewPassword;
    return payload;
  }

  async function handleSaveFtp() {
    setFtpSaving(true);
    setFtpSaveMsg(null);
    try {
      const updated = await updateSyncSettings(ftpFormPayload());
      setFtpPasswordSet(!!updated.ftp_password_set);
      setFtpNewPassword("");
      setFtpSaveMsg({ type: "success", text: "Настройки FTP сохранены." });
      refresh();
    } catch {
      setFtpSaveMsg({ type: "error", text: "Не удалось сохранить настройки FTP." });
    } finally {
      setFtpSaving(false);
    }
  }

  async function handleTestFtp() {
    setFtpTesting(true);
    setFtpTestResult(null);
    try {
      const result = await testFtpConnection({
        ftp_host: ftpForm.ftp_host || undefined,
        ftp_port: ftpForm.ftp_port ? Number(ftpForm.ftp_port) : undefined,
        ftp_user: ftpForm.ftp_user || undefined,
        ftp_password: ftpNewPassword || undefined,
        ftp_remote_path: ftpForm.ftp_remote_path || undefined,
        ftp_use_tls: ftpForm.ftp_use_tls,
      });
      setFtpTestResult(result);
    } catch {
      setFtpTestResult({ ok: false, message: "Не удалось выполнить проверку." });
    } finally {
      setFtpTesting(false);
    }
  }

  async function handleSelfcheck() {
    setSelfcheckLoading(true);
    try {
      const result = await fetchSyncSelfcheck();
      setSelfcheck(result);
    } catch {
      setSelfcheck({ checks: [], ok: false, error: true });
    } finally {
      setSelfcheckLoading(false);
    }
  }

  if (loading || !ozonForm || !ftpForm) {
    return (
      <>
        <AppHeader />
        <Container sx={{ py: 6, textAlign: "center" }}><CircularProgress /></Container>
      </>
    );
  }

  const lastOzon = status?.ozon?.last_run;
  const lastFtp = status?.ftp?.last_run;

  return (
    <>
      <AppHeader />
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Typography variant="h4" gutterBottom>Синхронизация</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Данные и фото товаров подтягиваются из Ozon Seller API, цены — при необходимости
          можно приоритетно загружать таблицей с FTP-сервера. Ниже — статус, история,
          настройки и самопроверка.
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {runError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setRunError(null)}>{runError}</Alert>}
        {!canEdit && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Ваша роль позволяет только просматривать синхронизацию. Запускать её и менять
            настройки может учётная запись с полным доступом.
          </Alert>
        )}

        {/* Самопроверка */}
        <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
            <Typography variant="h6">Самопроверка</Typography>
            <Button
              size="small"
              variant="outlined"
              startIcon={selfcheckLoading ? <CircularProgress size={14} /> : <FactCheckIcon />}
              onClick={handleSelfcheck}
              disabled={selfcheckLoading}
            >
              Проверить всё
            </Button>
          </Stack>

          {selfcheck ? (
            selfcheck.error ? (
              <Alert severity="error">Не удалось выполнить самопроверку.</Alert>
            ) : (
              <List disablePadding>
                {selfcheck.checks.map((c) => (
                  <CheckRow key={c.name} name={c.name} ok={c.ok} message={c.message} />
                ))}
              </List>
            )
          ) : (
            <Typography variant="body2" color="text.secondary">
              Проверяет: подключение к БД, ключи Ozon API, доступность папки загрузок фото,
              соединение с FTP (если включён), статус последней синхронизации с Ozon.
            </Typography>
          )}
        </Paper>

        {/* --- Товары и фото (Ozon) --- */}
        <Typography variant="h6" sx={{ mb: 1.5 }}>Товары и фото (Ozon)</Typography>
        <Paper variant="outlined" sx={{ p: 3, mb: 2 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
            <Typography variant="subtitle1">Текущий статус</Typography>
            <StatusChip status={lastOzon ? lastOzon.status : "never_run"} />
          </Stack>

          {lastOzon ? (
            <Grid container spacing={2}>
              <Grid item xs={6} sm={3}>
                <Typography variant="caption" color="text.secondary">Запущена</Typography>
                <Typography variant="body2">{formatDateTime(lastOzon.started_at)}</Typography>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Typography variant="caption" color="text.secondary">Завершена</Typography>
                <Typography variant="body2">{formatDateTime(lastOzon.finished_at)}</Typography>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Typography variant="caption" color="text.secondary">Длительность</Typography>
                <Typography variant="body2">{formatDuration(lastOzon.duration_seconds)}</Typography>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Typography variant="caption" color="text.secondary">Следующий запуск</Typography>
                <Typography variant="body2">
                  {ozonForm.auto_sync_enabled ? formatDateTime(status.ozon.next_run_at) : "Автосинхронизация выключена"}
                </Typography>
              </Grid>

              <Grid item xs={12}><Divider /></Grid>

              <Grid item xs={6} sm={3}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <InventoryIcon fontSize="small" color="action" />
                  <Box>
                    <Typography variant="caption" color="text.secondary" display="block">Товаров обработано</Typography>
                    <Typography variant="body1">{lastOzon.products_processed ?? "—"}</Typography>
                  </Box>
                </Stack>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Typography variant="caption" color="text.secondary" display="block">Ошибок по товарам</Typography>
                <Typography variant="body1" color={lastOzon.products_failed ? "error.main" : "text.primary"}>
                  {lastOzon.products_failed ?? "—"}
                </Typography>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <PhotoLibraryIcon fontSize="small" color="action" />
                  <Box>
                    <Typography variant="caption" color="text.secondary" display="block">Фото скачано</Typography>
                    <Typography variant="body1">
                      {lastOzon.download_images_enabled === false ? "выключено" : lastOzon.images_downloaded ?? "—"}
                    </Typography>
                  </Box>
                </Stack>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Typography variant="caption" color="text.secondary" display="block">Фото не скачано</Typography>
                <Typography variant="body1" color={lastOzon.images_failed ? "warning.main" : "text.primary"}>
                  {lastOzon.download_images_enabled === false ? "—" : lastOzon.images_failed ?? "—"}
                </Typography>
              </Grid>

              {!!lastOzon.skipped_other_brand && (
                <Grid item xs={12}>
                  <Typography variant="caption" color="text.secondary">
                    Товаров чужих брендов продавца пропущено (не сохраняются в базу): {lastOzon.skipped_other_brand}
                    {!!lastOzon.removed_other_brand && `, из них удалено ранее сохранённых: ${lastOzon.removed_other_brand}`}
                  </Typography>
                </Grid>
              )}

              {lastOzon.error_message && (
                <Grid item xs={12}><Alert severity="error" sx={{ mt: 1 }}>{lastOzon.error_message}</Alert></Grid>
              )}
            </Grid>
          ) : (
            <Typography variant="body2" color="text.secondary">Синхронизация с Ozon ещё ни разу не запускалась.</Typography>
          )}

          <Divider sx={{ my: 2 }} />

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }}>
            <Button
              variant="contained"
              startIcon={ozonRunning ? <CircularProgress size={16} color="inherit" /> : <SyncIcon />}
              onClick={handleRunOzon}
              disabled={ozonRunning || !canEdit}
            >
              {ozonRunning ? "Выполняется…" : "Запустить сейчас"}
            </Button>
            <FormControlLabel
              control={
                <Switch checked={skipPhotosOnRun} onChange={(e) => setSkipPhotosOnRun(e.target.checked)} disabled={ozonRunning || !canEdit} />
              }
              label="Только данные, без фото (быстрее)"
            />
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 3, mb: 2 }}>
          <Typography variant="subtitle1" gutterBottom>Настройки</Typography>
          {ozonSaveMsg && (
            <Alert severity={ozonSaveMsg.type} sx={{ mb: 2 }} onClose={() => setOzonSaveMsg(null)}>
              {ozonSaveMsg.text}
            </Alert>
          )}
          <Stack spacing={2.5} component="fieldset" disabled={!canEdit} sx={{ border: "none", p: 0, m: 0 }}>
            <TextField
              label="Периодичность автосинхронизации, минут"
              type="number"
              size="small"
              sx={{ maxWidth: 320 }}
              inputProps={{ min: 5, max: 1440 }}
              value={ozonForm.interval_minutes}
              onChange={(e) => setOzonForm((f) => ({ ...f, interval_minutes: e.target.value }))}
              helperText="От 5 минут до 24 часов (1440 мин)"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={ozonForm.auto_sync_enabled}
                  onChange={(e) => setOzonForm((f) => ({ ...f, auto_sync_enabled: e.target.checked }))}
                />
              }
              label="Автосинхронизация по расписанию"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={ozonForm.download_images_enabled}
                  onChange={(e) => setOzonForm((f) => ({ ...f, download_images_enabled: e.target.checked }))}
                />
              }
              label={
                <Tooltip title="Если выключено — обновляются только данные товара (цена, остатки, атрибуты, название), фото карточек не скачиваются и не трогаются">
                  <span>Скачивать фото карточек на сервер</span>
                </Tooltip>
              }
            />
            <Box>
              <Button variant="contained" onClick={handleSaveOzon} disabled={ozonSaving}>
                {ozonSaving ? "Сохранение..." : "Сохранить настройки"}
              </Button>
            </Box>
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ mb: 4 }}>
          <Box sx={{ p: 2, pb: 0 }}><Typography variant="subtitle1">История запусков</Typography></Box>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Начало</TableCell>
                <TableCell>Запуск</TableCell>
                <TableCell>Статус</TableCell>
                <TableCell align="right">Товаров</TableCell>
                <TableCell align="right">Фото</TableCell>
                <TableCell align="right">Длительность</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {ozonHistory.length === 0 && (
                <TableRow><TableCell colSpan={6} align="center" sx={{ color: "text.secondary", py: 3 }}>Пока нет ни одного запуска</TableCell></TableRow>
              )}
              {ozonHistory.map((h) => (
                <TableRow key={h.id}>
                  <TableCell>{formatDateTime(h.started_at)}</TableCell>
                  <TableCell>{h.trigger === "manual" ? "Вручную" : "По расписанию"}</TableCell>
                  <TableCell><StatusChip status={h.status} /></TableCell>
                  <TableCell align="right">
                    {h.products_processed ?? "—"}{h.products_failed ? ` (ошибок: ${h.products_failed})` : ""}
                  </TableCell>
                  <TableCell align="right">{h.download_images_enabled === false ? "—" : (h.images_downloaded ?? "—")}</TableCell>
                  <TableCell align="right">{formatDuration(h.duration_seconds)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>

        {/* --- Цены с FTP --- */}
        <Typography variant="h6" sx={{ mb: 1.5 }}>Цены с FTP</Typography>
        <Paper variant="outlined" sx={{ p: 3, mb: 2 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
            <Typography variant="subtitle1">Текущий статус</Typography>
            <StatusChip status={lastFtp ? lastFtp.status : "never_run"} />
          </Stack>

          <Alert severity="info" sx={{ mb: 2 }}>
            Цена из FTP-файла приоритетнее цены Ozon: для совпавшего по артикулу (offer_id) товара
            она перестаёт обновляться из Ozon, пока товар не пропадёт из файла на FTP.
          </Alert>

          {lastFtp ? (
            <Grid container spacing={2}>
              <Grid item xs={6} sm={3}>
                <Typography variant="caption" color="text.secondary">Запущен</Typography>
                <Typography variant="body2">{formatDateTime(lastFtp.started_at)}</Typography>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Typography variant="caption" color="text.secondary">Завершён</Typography>
                <Typography variant="body2">{formatDateTime(lastFtp.finished_at)}</Typography>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Typography variant="caption" color="text.secondary">Длительность</Typography>
                <Typography variant="body2">{formatDuration(lastFtp.duration_seconds)}</Typography>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Typography variant="caption" color="text.secondary">Следующий запуск</Typography>
                <Typography variant="body2">
                  {ftpForm.ftp_enabled ? formatDateTime(status.ftp.next_run_at) : "Импорт с FTP выключен"}
                </Typography>
              </Grid>

              <Grid item xs={12}><Divider /></Grid>

              <Grid item xs={6} sm={3}>
                <Typography variant="caption" color="text.secondary" display="block">Цен сопоставлено</Typography>
                <Typography variant="body1">{lastFtp.ftp_matched ?? "—"}</Typography>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Typography variant="caption" color="text.secondary" display="block">Артикулов не найдено</Typography>
                <Typography variant="body1" color={lastFtp.ftp_unmatched ? "warning.main" : "text.primary"}>
                  {lastFtp.ftp_unmatched ?? "—"}
                </Typography>
              </Grid>

              {!!lastFtp.ftp_unmatched_sample?.length && (
                <Grid item xs={12}>
                  <Typography variant="caption" color="text.secondary" display="block">Примеры не найденных артикулов</Typography>
                  <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
                    {lastFtp.ftp_unmatched_sample.join(", ")}
                  </Typography>
                </Grid>
              )}

              {!!lastFtp.ftp_ambiguous && (
                <Grid item xs={12}>
                  <Typography variant="caption" color="warning.main" display="block">
                    Неоднозначных совпадений (один ОЕМ-номер у нескольких товаров, цена не проставлена никому): {lastFtp.ftp_ambiguous}
                  </Typography>
                  {!!lastFtp.ftp_ambiguous_sample?.length && (
                    <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
                      {lastFtp.ftp_ambiguous_sample.join(", ")}
                    </Typography>
                  )}
                </Grid>
              )}

              {lastFtp.error_message && (
                <Grid item xs={12}><Alert severity="error" sx={{ mt: 1 }}>{lastFtp.error_message}</Alert></Grid>
              )}
            </Grid>
          ) : (
            <Typography variant="body2" color="text.secondary">Импорт цен с FTP ещё ни разу не запускался.</Typography>
          )}

          <Divider sx={{ my: 2 }} />

          <Button
            variant="contained"
            startIcon={ftpRunning ? <CircularProgress size={16} color="inherit" /> : <CloudUploadIcon />}
            onClick={handleRunFtp}
            disabled={ftpRunning || !ftpForm.ftp_host || !canEdit}
          >
            {ftpRunning ? "Выполняется…" : "Импортировать сейчас"}
          </Button>
        </Paper>

        <Paper variant="outlined" sx={{ p: 3, mb: 2 }}>
          <Typography variant="subtitle1" gutterBottom>Настройки подключения</Typography>
          {ftpSaveMsg && (
            <Alert severity={ftpSaveMsg.type} sx={{ mb: 2 }} onClose={() => setFtpSaveMsg(null)}>{ftpSaveMsg.text}</Alert>
          )}
          {ftpTestResult && (
            <Alert severity={ftpTestResult.ok ? "success" : "error"} sx={{ mb: 2 }} onClose={() => setFtpTestResult(null)}>
              {ftpTestResult.message}
              {ftpTestResult.ok && ftpTestResult.size_bytes != null && ` (${ftpTestResult.size_bytes} байт)`}
            </Alert>
          )}

          <Stack spacing={2.5} component="fieldset" disabled={!canEdit} sx={{ border: "none", p: 0, m: 0 }}>
            <FormControlLabel
              control={
                <Switch checked={ftpForm.ftp_enabled} onChange={(e) => setFtpForm((f) => ({ ...f, ftp_enabled: e.target.checked }))} />
              }
              label="Импорт цен с FTP включён"
            />

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label="Адрес FTP-сервера"
                size="small"
                fullWidth
                value={ftpForm.ftp_host}
                onChange={(e) => setFtpForm((f) => ({ ...f, ftp_host: e.target.value }))}
                placeholder="ftp.example.com или local"
                helperText="«local» — встроенный FTP-сервер сайта: прайс загружается в него по FTPS"
              />
              <TextField
                label="Порт"
                type="number"
                size="small"
                sx={{ maxWidth: 140 }}
                value={ftpForm.ftp_port}
                onChange={(e) => setFtpForm((f) => ({ ...f, ftp_port: e.target.value }))}
              />
            </Stack>

            <TextField
              label="Путь к файлу на сервере"
              size="small"
              fullWidth
              value={ftpForm.ftp_remote_path}
              onChange={(e) => setFtpForm((f) => ({ ...f, ftp_remote_path: e.target.value }))}
              placeholder="/prices/prices.csv"
              helperText="Файл CSV или XLS/XLSX с двумя колонками: артикул (offer_id) и цена. Для «local» — имя файла или пусто (брать самый свежий загруженный)"
            />

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label="Логин"
                size="small"
                fullWidth
                value={ftpForm.ftp_user}
                onChange={(e) => setFtpForm((f) => ({ ...f, ftp_user: e.target.value }))}
              />
              <TextField
                label={ftpPasswordSet ? "Новый пароль (оставьте пустым, чтобы не менять)" : "Пароль"}
                type="password"
                size="small"
                fullWidth
                value={ftpNewPassword}
                onChange={(e) => setFtpNewPassword(e.target.value)}
                helperText={ftpPasswordSet ? "Пароль сохранён" : "Пароль не задан"}
              />
            </Stack>

            <FormControlLabel
              control={
                <Switch checked={ftpForm.ftp_use_tls} onChange={(e) => setFtpForm((f) => ({ ...f, ftp_use_tls: e.target.checked }))} />
              }
              label="Использовать FTPS (шифрование, FTP over TLS)"
            />

            <TextField
              label="Периодичность импорта, минут"
              type="number"
              size="small"
              sx={{ maxWidth: 320 }}
              inputProps={{ min: 5, max: 10080 }}
              value={ftpForm.ftp_interval_minutes}
              onChange={(e) => setFtpForm((f) => ({ ...f, ftp_interval_minutes: e.target.value }))}
              helperText="От 5 минут до 7 суток (10080 мин) — периодичность своя, отдельная от синхронизации с Ozon"
            />

            <Stack direction="row" spacing={2}>
              <Button variant="contained" onClick={handleSaveFtp} disabled={ftpSaving}>
                {ftpSaving ? "Сохранение..." : "Сохранить настройки"}
              </Button>
              <Button
                variant="outlined"
                onClick={handleTestFtp}
                disabled={ftpTesting || !ftpForm.ftp_host}
                startIcon={ftpTesting ? <CircularProgress size={16} /> : null}
              >
                {ftpTesting ? "Проверка..." : "Проверить соединение"}
              </Button>
            </Stack>
          </Stack>
        </Paper>

        <Paper variant="outlined">
          <Box sx={{ p: 2, pb: 0 }}><Typography variant="subtitle1">История импортов</Typography></Box>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Начало</TableCell>
                <TableCell>Запуск</TableCell>
                <TableCell>Статус</TableCell>
                <TableCell align="right">Сопоставлено</TableCell>
                <TableCell align="right">Не найдено</TableCell>
                <TableCell align="right">Длительность</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {ftpHistory.length === 0 && (
                <TableRow><TableCell colSpan={6} align="center" sx={{ color: "text.secondary", py: 3 }}>Пока нет ни одного запуска</TableCell></TableRow>
              )}
              {ftpHistory.map((h) => (
                <TableRow key={h.id}>
                  <TableCell>{formatDateTime(h.started_at)}</TableCell>
                  <TableCell>{h.trigger === "manual" ? "Вручную" : "По расписанию"}</TableCell>
                  <TableCell><StatusChip status={h.status} /></TableCell>
                  <TableCell align="right">{h.ftp_matched ?? "—"}</TableCell>
                  <TableCell align="right">{h.ftp_unmatched ?? "—"}</TableCell>
                  <TableCell align="right">{formatDuration(h.duration_seconds)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      </Container>
    </>
  );
}
