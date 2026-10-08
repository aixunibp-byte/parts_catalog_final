import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Container, TextField, InputAdornment, FormControlLabel, Switch, Table,
  TableHead, TableBody, TableRow, TableCell, Chip, Avatar, Stack,
  Pagination, CircularProgress, Alert, Paper, Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import EditIcon from "@mui/icons-material/Edit";
import AppHeader from "../components/AppHeader";
import { fetchAdminParts, getAdminToken } from "../adminApi";
import { adminPath } from "../adminPaths";
import { useNavigateToLoginIfNoToken } from "../useAdminGuard";

const PAGE_SIZE = 50;

export default function AdminPartsListPage() {
  useNavigateToLoginIfNoToken();

  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [onlyEdited, setOnlyEdited] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 400);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    if (!getAdminToken()) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchAdminParts({ search, onlyEdited, page, pageSize: PAGE_SIZE })
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
        setTotal(data.total);
      })
      .catch(() => {
        if (!cancelled) setError("Не удалось загрузить список товаров.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [search, onlyEdited, page]);

  return (
    <>
      <AppHeader />
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Typography variant="h4" gutterBottom>Управление карточками</Typography>

        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 3 }}>
          <TextField
            fullWidth
            placeholder="Поиск по названию или артикулу"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start"><SearchIcon /></InputAdornment>
              ),
            }}
          />
          <FormControlLabel
            control={
              <Switch checked={onlyEdited} onChange={(e) => { setOnlyEdited(e.target.checked); setPage(1); }} />
            }
            label="Только отредактированные"
            sx={{ whiteSpace: "nowrap" }}
          />
        </Stack>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {loading ? (
          <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress /></Stack>
        ) : (
          <>
            <Paper variant="outlined">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Фото</TableCell>
                    <TableCell>Название</TableCell>
                    <TableCell>Артикул</TableCell>
                    <TableCell>Цена</TableCell>
                    <TableCell>Наличие</TableCell>
                    <TableCell>Статус</TableCell>
                    <TableCell align="right">Действие</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.map((part) => (
                    <TableRow
                      key={part.id}
                      hover
                      sx={{ cursor: "pointer" }}
                      onClick={() => navigate(adminPath(`/parts/${part.id}`))}
                    >
                      <TableCell>
                        <Avatar
                          variant="rounded"
                          src={part.primary_image || undefined}
                          sx={{ width: 48, height: 48, bgcolor: "background.default" }}
                        />
                      </TableCell>
                      <TableCell sx={{ maxWidth: 320 }}>
                        <Typography noWrap title={part.name}>{part.name}</Typography>
                      </TableCell>
                      <TableCell>{part.offer_id}</TableCell>
                      <TableCell>
                        {part.price != null ? `${part.price.toLocaleString("ru-RU")} ₽` : "—"}
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={part.has_stock ? "В наличии" : "Нет"}
                          color={part.has_stock ? "success" : "default"}
                        />
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5}>
                          {part.manual_override && (
                            <Chip size="small" label="Отредактировано" color="secondary" />
                          )}
                          {part.is_archived && (
                            <Chip size="small" label="Архив" variant="outlined" />
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell align="right">
                        <EditIcon fontSize="small" color="action" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Paper>

            <Stack alignItems="center" sx={{ mt: 3 }}>
              <Pagination count={pageCount} page={page} onChange={(_, v) => setPage(v)} color="primary" />
            </Stack>
          </>
        )}
      </Container>
    </>
  );
}
