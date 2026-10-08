import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Container, Grid, Paper, Typography, TextField, Button, Stack, Chip,
  CircularProgress, Alert, Divider, IconButton, ImageList, ImageListItem,
  ImageListItemBar, Dialog, DialogTitle, DialogContent, DialogActions,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DeleteIcon from "@mui/icons-material/Delete";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import LinkIcon from "@mui/icons-material/Link";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import AppHeader from "../components/AppHeader";
import { useNavigateToLoginIfNoToken, useCurrentUser } from "../useAdminGuard";
import {
  fetchAdminPart, updatePartContent, uploadImage, replaceImage, addImageByUrl,
  deleteImage, reorderImages, revertToSync, fetchAuditLog,
} from "../adminApi";
import { adminPath } from "../adminPaths";

export default function AdminPartEditPage() {
  useNavigateToLoginIfNoToken();
  const { can } = useCurrentUser();
  // Редактирование контента карточки и фото — роль editor и выше; сервер
  // требует то же самое на всех мутирующих эндпоинтах /admin/parts/*.
  // viewer видит карточку, но элементы управления задизейблены.
  const canEdit = can("editor");

  const { id } = useParams();
  const navigate = useNavigate();

  const [part, setPart] = useState(null);
  const [form, setForm] = useState({ name: "", description: "", brand: "", category_name: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [newImageUrl, setNewImageUrl] = useState("");
  const [revertDialogOpen, setRevertDialogOpen] = useState(false);
  const [auditLog, setAuditLog] = useState([]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([fetchAdminPart(id), fetchAuditLog(id)])
      .then(([partData, log]) => {
        setPart(partData);
        setAuditLog(log);
        setForm({
          name: partData.name || "",
          description: partData.description || "",
          brand: partData.brand || "",
          category_name: partData.category_name || "",
        });
      })
      .catch(() => setError("Не удалось загрузить карточку."))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function handleSaveContent() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await updatePartContent(id, form);
      setPart(updated);
      setSuccess("Изменения сохранены. Карточка защищена от перезаписи синхронизатором.");
    } catch {
      setError("Не удалось сохранить изменения.");
    } finally {
      setSaving(false);
    }
  }

  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await uploadImage(id, file, part.images.length === 0);
      setPart(updated);
    } catch {
      setError("Не удалось загрузить изображение (проверьте формат и размер до 10 МБ).");
    } finally {
      setSaving(false);
      e.target.value = "";
    }
  }

  async function handleReplaceImage(uid, e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await replaceImage(id, uid, file);
      setPart(updated);
      setSuccess("Фото заменено. Адрес фото остался прежним.");
    } catch {
      setError("Не удалось заменить изображение (проверьте формат и размер до 10 МБ).");
    } finally {
      setSaving(false);
      e.target.value = "";
    }
  }

  async function handleAddByUrl() {
    if (!newImageUrl.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await addImageByUrl(id, newImageUrl.trim(), part.images.length === 0);
      setPart(updated);
      setUrlDialogOpen(false);
      setNewImageUrl("");
    } catch {
      setError("Не удалось добавить изображение по ссылке.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteImage(url) {
    setSaving(true);
    setError(null);
    try {
      const updated = await deleteImage(id, url);
      setPart(updated);
    } catch {
      setError("Не удалось удалить изображение.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSetPrimary(url) {
    setSaving(true);
    setError(null);
    try {
      const images = part.images.map((img) => ({
        url: img.url,
        sort_order: img.sort_order,
        is_primary: img.url === url,
      }));
      const updated = await reorderImages(id, images);
      setPart(updated);
    } catch {
      setError("Не удалось назначить главное фото.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRevert() {
    setSaving(true);
    setError(null);
    try {
      const updated = await revertToSync(id);
      setPart(updated);
      setForm({
        name: updated.name || "",
        description: updated.description || "",
        brand: updated.brand || "",
        category_name: updated.category_name || "",
      });
      setSuccess("Карточка снова управляется автосинхронизацией с Ozon.");
    } catch {
      setError("Не удалось сбросить ручные правки.");
    } finally {
      setSaving(false);
      setRevertDialogOpen(false);
    }
  }

  if (loading) {
    return (
      <>
        <AppHeader />
        <Container sx={{ py: 6, textAlign: "center" }}><CircularProgress /></Container>
      </>
    );
  }

  if (!part) {
    return (
      <>
        <AppHeader />
        <Container sx={{ py: 6 }}>
          <Alert severity="error">{error || "Товар не найден."}</Alert>
        </Container>
      </>
    );
  }

  return (
    <>
      <AppHeader />
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(adminPath("/parts"))} sx={{ mb: 2 }}>
          К списку карточек
        </Button>

        <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
          <Typography variant="h4">{part.name}</Typography>
          {part.manual_override && <Chip label="Отредактировано вручную" color="secondary" />}
        </Stack>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Артикул: {part.offer_id} · Цена и остатки синхронизируются из Ozon автоматически
        </Typography>

        {error && <Alert severity="error" sx={{ my: 2 }}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ my: 2 }} onClose={() => setSuccess(null)}>{success}</Alert>}
        {!canEdit && (
          <Alert severity="info" sx={{ my: 2 }}>
            Ваша роль позволяет только просматривать карточку. Редактировать контент и фото
            может учётная запись с ролью «Редактирование» или выше.
          </Alert>
        )}

        <Grid container spacing={4} sx={{ mt: 1 }}>
          <Grid item xs={12} md={7}>
            <Paper variant="outlined" sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>Контент карточки</Typography>
              <Stack spacing={2} component="fieldset" disabled={!canEdit} sx={{ border: "none", p: 0, m: 0 }}>
                <TextField
                  label="Название"
                  fullWidth
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
                <TextField
                  label="Бренд"
                  fullWidth
                  value={form.brand}
                  onChange={(e) => setForm({ ...form, brand: e.target.value })}
                />
                <TextField
                  label="Категория (отображаемое название)"
                  fullWidth
                  value={form.category_name}
                  onChange={(e) => setForm({ ...form, category_name: e.target.value })}
                />
                <TextField
                  label="Описание"
                  fullWidth
                  multiline
                  minRows={6}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
                <Button
                  variant="contained"
                  onClick={handleSaveContent}
                  disabled={saving}
                  sx={{ alignSelf: "flex-start" }}
                >
                  {saving ? "Сохранение..." : "Сохранить изменения"}
                </Button>
              </Stack>
            </Paper>

            {part.manual_override && (
              <Paper variant="outlined" sx={{ p: 3, mt: 3 }}>
                <Typography variant="subtitle1" gutterBottom>Ручное управление контентом включено</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Название, описание, бренд, категория и фото больше не обновляются
                  автоматически из Ozon. Цена и остатки продолжают синхронизироваться.
                </Typography>
                <Button
                  startIcon={<RestartAltIcon />}
                  color="warning"
                  variant="outlined"
                  onClick={() => setRevertDialogOpen(true)}
                  disabled={!canEdit}
                >
                  Вернуть автосинхронизацию контента
                </Button>
              </Paper>
            )}

            {auditLog.length > 0 && (
              <Paper variant="outlined" sx={{ p: 3, mt: 3 }}>
                <Typography variant="subtitle1" gutterBottom>История изменений</Typography>
                <Stack spacing={1}>
                  {auditLog.map((entry, i) => (
                    <Typography key={i} variant="body2" color="text.secondary">
                      {new Date(entry.created_at).toLocaleString("ru-RU")} — {entry.action}
                    </Typography>
                  ))}
                </Stack>
              </Paper>
            )}
          </Grid>

          <Grid item xs={12} md={5}>
            <Paper variant="outlined" sx={{ p: 3 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                <Typography variant="h6">Фотографии</Typography>
                <Stack direction="row" spacing={1}>
                  <Button
                    component="label"
                    size="small"
                    startIcon={<UploadFileIcon />}
                    disabled={saving || !canEdit}
                  >
                    Загрузить
                    <input type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={handleFileUpload} disabled={!canEdit} />
                  </Button>
                  <Button
                    size="small"
                    startIcon={<LinkIcon />}
                    onClick={() => setUrlDialogOpen(true)}
                    disabled={saving || !canEdit}
                  >
                    По ссылке
                  </Button>
                </Stack>
              </Stack>

              {part.images.length === 0 ? (
                <Alert severity="info">Фотографий пока нет.</Alert>
              ) : (
                <ImageList cols={2} gap={8}>
                  {part.images.map((img) => (
                    <ImageListItem key={img.uid || img.url}>
                      <img
                        src={img.url}
                        alt=""
                        title={`Постоянный адрес: ${window.location.origin}${img.url}`}
                        style={{ height: 140, objectFit: "contain" }}
                      />
                      <ImageListItemBar
                        position="top"
                        actionIcon={
                          <IconButton
                            size="small"
                            sx={{ color: img.is_primary ? "#FFD700" : "#fff" }}
                            onClick={() => handleSetPrimary(img.url)}
                            title="Сделать главным"
                            disabled={!canEdit}
                          >
                            {img.is_primary ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
                          </IconButton>
                        }
                        actionPosition="left"
                        sx={{ background: "transparent" }}
                      />
                      <ImageListItemBar
                        position="bottom"
                        actionIcon={
                          <Stack direction="row" spacing={0.5}>
                            <IconButton
                              component="label"
                              size="small"
                              sx={{ color: "#fff" }}
                              title="Заменить файл (адрес фото не изменится)"
                              disabled={saving || !canEdit}
                            >
                              <SwapHorizIcon fontSize="small" />
                              <input
                                type="file"
                                hidden
                                accept="image/jpeg,image/png,image/webp"
                                onChange={(e) => handleReplaceImage(img.uid, e)}
                                disabled={!canEdit}
                              />
                            </IconButton>
                            <IconButton
                              size="small"
                              sx={{ color: "#fff" }}
                              onClick={() => handleDeleteImage(img.url)}
                              title="Удалить"
                              disabled={!canEdit}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Stack>
                        }
                      />
                    </ImageListItem>
                  ))}
                </ImageList>
              )}
            </Paper>

            <Paper variant="outlined" sx={{ p: 3, mt: 3 }}>
              <Typography variant="subtitle1" gutterBottom>Данные из Ozon (только чтение)</Typography>
              <Divider sx={{ mb: 2 }} />
              <Typography variant="body2">
                Цена: {part.price != null ? `${part.price.toLocaleString("ru-RU")} ₽` : "—"}
              </Typography>
              <Typography variant="body2">
                Наличие: {part.has_stock ? "В наличии" : "Нет в наличии"}
              </Typography>
              <Typography variant="body2">
                Статус модерации: {part.moderate_status || "—"}
              </Typography>
              {part.last_synced_at && (
                <Typography variant="caption" color="text.secondary">
                  Обновлено: {new Date(part.last_synced_at).toLocaleString("ru-RU")}
                </Typography>
              )}
            </Paper>
          </Grid>
        </Grid>
      </Container>

      <Dialog open={urlDialogOpen} onClose={() => setUrlDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Добавить изображение по ссылке</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            autoFocus
            label="URL изображения"
            value={newImageUrl}
            onChange={(e) => setNewImageUrl(e.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUrlDialogOpen(false)}>Отмена</Button>
          <Button variant="contained" onClick={handleAddByUrl} disabled={saving || !canEdit}>Добавить</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={revertDialogOpen} onClose={() => setRevertDialogOpen(false)}>
        <DialogTitle>Вернуть автосинхронизацию?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Все ручные правки названия, описания, бренда, категории и фото будут
            заменены данными из Ozon при следующей синхронизации. Действие необратимо.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevertDialogOpen(false)}>Отмена</Button>
          <Button color="warning" variant="contained" onClick={handleRevert} disabled={saving || !canEdit}>
            Подтвердить
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
