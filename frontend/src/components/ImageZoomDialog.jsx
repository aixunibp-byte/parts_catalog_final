import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, Box, IconButton, Stack, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const DOUBLE_CLICK_SCALE = 2.5;
const BUTTON_STEP = 1.4;
const WHEEL_STEP = 1.15;

const INITIAL_VIEW = { scale: 1, x: 0, y: 0 };

const clampScale = (value) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

// Полноэкранный просмотр фото с зумом: колесо мыши / кнопки +/- / двойной клик /
// щипок двумя пальцами; при увеличении картинку можно двигать мышью или пальцем.
// Стрелки на клавиатуре и по краям листают фото, Esc закрывает.
export default function ImageZoomDialog({ open, onClose, images, index, onIndexChange, alt }) {
  const [view, setView] = useState(INITIAL_VIEW);
  const [dragging, setDragging] = useState(false);

  const stageRef = useRef(null);
  const imgRef = useRef(null);
  const viewRef = useRef(INITIAL_VIEW);
  const pointers = useRef(new Map());
  const gesture = useRef(null);

  viewRef.current = view;

  const current = images?.[index];
  const hasMany = (images?.length || 0) > 1;

  // Не даём утащить картинку за пределы области просмотра: пока она целиком
  // помещается по одной из осей, по этой оси она остаётся по центру.
  const clampView = useCallback((next) => {
    const stage = stageRef.current;
    const img = imgRef.current;
    const scale = clampScale(next.scale);
    if (!stage || !img || scale <= MIN_SCALE) {
      return { scale, x: 0, y: 0 };
    }
    const maxX = Math.max(0, (img.offsetWidth * scale - stage.clientWidth) / 2);
    const maxY = Math.max(0, (img.offsetHeight * scale - stage.clientHeight) / 2);
    return {
      scale,
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    };
  }, []);

  // Масштаб относительно точки (clientX, clientY) — точка под курсором остаётся на месте.
  const zoomAbout = useCallback(
    (base, targetScale, clientX, clientY) => {
      const stage = stageRef.current;
      const scale = clampScale(targetScale);
      if (!stage) return { ...base, scale };
      const rect = stage.getBoundingClientRect();
      const px = (clientX ?? rect.left + rect.width / 2) - (rect.left + rect.width / 2);
      const py = (clientY ?? rect.top + rect.height / 2) - (rect.top + rect.height / 2);
      const ratio = scale / base.scale;
      return clampView({
        scale,
        x: px - (px - base.x) * ratio,
        y: py - (py - base.y) * ratio,
      });
    },
    [clampView]
  );

  const zoomBy = useCallback(
    (factor, clientX, clientY) => {
      setView((prev) => zoomAbout(prev, prev.scale * factor, clientX, clientY));
    },
    [zoomAbout]
  );

  const resetView = useCallback(() => setView(INITIAL_VIEW), []);

  // Новое фото / повторное открытие — начинаем с масштаба "вписать".
  useEffect(() => {
    if (open) setView(INITIAL_VIEW);
  }, [open, index]);

  const goTo = useCallback(
    (delta) => {
      if (!hasMany) return;
      onIndexChange((index + delta + images.length) % images.length);
    },
    [hasMany, index, images, onIndexChange]
  );

  function handleKeyDown(e) {
    if (e.key === "ArrowLeft") goTo(-1);
    else if (e.key === "ArrowRight") goTo(1);
    else if (e.key === "+" || e.key === "=") zoomBy(BUTTON_STEP);
    else if (e.key === "-" || e.key === "_") zoomBy(1 / BUTTON_STEP);
    else if (e.key === "0") resetView();
  }

  function handleWheel(e) {
    zoomBy(e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP, e.clientX, e.clientY);
  }

  function handleDoubleClick(e) {
    setView((prev) =>
      prev.scale > MIN_SCALE + 0.01
        ? INITIAL_VIEW
        : zoomAbout(prev, DOUBLE_CLICK_SCALE, e.clientX, e.clientY)
    );
  }

  function startPan(pointer) {
    gesture.current = {
      type: "pan",
      startX: pointer.x,
      startY: pointer.y,
      origX: viewRef.current.x,
      origY: viewRef.current.y,
    };
    setDragging(true);
  }

  function startPinch() {
    const [a, b] = Array.from(pointers.current.values());
    gesture.current = {
      type: "pinch",
      startDistance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      base: { ...viewRef.current },
    };
    setDragging(true);
  }

  function handlePointerDown(e) {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      startPinch();
    } else if (pointers.current.size === 1 && viewRef.current.scale > MIN_SCALE) {
      startPan({ x: e.clientX, y: e.clientY });
    }
  }

  function handlePointerMove(e) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;

    if (g.type === "pinch" && pointers.current.size >= 2) {
      const [a, b] = Array.from(pointers.current.values());
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      setView(zoomAbout(g.base, g.base.scale * (distance / g.startDistance), midX, midY));
    } else if (g.type === "pan") {
      setView(
        clampView({
          scale: viewRef.current.scale,
          x: g.origX + (e.clientX - g.startX),
          y: g.origY + (e.clientY - g.startY),
        })
      );
    }
  }

  function handlePointerUp(e) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 1 && viewRef.current.scale > MIN_SCALE) {
      startPan(Array.from(pointers.current.values())[0]);
    } else if (pointers.current.size === 0) {
      gesture.current = null;
      setDragging(false);
    }
  }

  const zoomed = view.scale > MIN_SCALE + 0.01;
  const toolbarButtonSx = {
    color: "#fff",
    bgcolor: "rgba(255,255,255,0.12)",
    "&:hover": { bgcolor: "rgba(255,255,255,0.24)" },
    "&.Mui-disabled": { color: "rgba(255,255,255,0.3)" },
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen
      onKeyDown={handleKeyDown}
      PaperProps={{ sx: { bgcolor: "rgba(8, 16, 26, 0.96)", backgroundImage: "none" } }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 2, p: { xs: 1, sm: 2 } }}
      >
        <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.75)", pl: 1 }}>
          {hasMany ? `${index + 1} / ${images.length}` : ""}
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography
            variant="caption"
            sx={{ color: "rgba(255,255,255,0.65)", minWidth: 44, textAlign: "right" }}
          >
            {Math.round(view.scale * 100)}%
          </Typography>
          <IconButton
            onClick={() => zoomBy(1 / BUTTON_STEP)}
            disabled={!zoomed}
            size="small"
            aria-label="Уменьшить"
            sx={toolbarButtonSx}
          >
            <ZoomOutIcon />
          </IconButton>
          <IconButton
            onClick={() => zoomBy(BUTTON_STEP)}
            disabled={view.scale >= MAX_SCALE}
            size="small"
            aria-label="Увеличить"
            sx={toolbarButtonSx}
          >
            <ZoomInIcon />
          </IconButton>
          <IconButton
            onClick={resetView}
            disabled={!zoomed}
            size="small"
            aria-label="Вписать в экран"
            sx={toolbarButtonSx}
          >
            <RestartAltIcon />
          </IconButton>
          <IconButton onClick={onClose} size="small" aria-label="Закрыть" sx={toolbarButtonSx}>
            <CloseIcon />
          </IconButton>
        </Stack>
      </Stack>

      <Box
        ref={stageRef}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        sx={{
          flex: 1,
          minHeight: 0,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          touchAction: "none",
          userSelect: "none",
          cursor: zoomed ? (dragging ? "grabbing" : "grab") : "zoom-in",
          px: { xs: 0, sm: 8 },
          pt: 8,
          pb: 3,
        }}
      >
        {current && (
          <img
            ref={imgRef}
            src={current.url}
            alt={alt || ""}
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              transition: dragging ? "none" : "transform 0.15s ease-out",
              willChange: "transform",
            }}
          />
        )}
      </Box>

      {hasMany && (
        <>
          <IconButton
            onClick={() => goTo(-1)}
            aria-label="Предыдущее фото"
            sx={{ ...toolbarButtonSx, position: "absolute", left: { xs: 6, sm: 16 }, top: "50%", zIndex: 2 }}
          >
            <ChevronLeftIcon />
          </IconButton>
          <IconButton
            onClick={() => goTo(1)}
            aria-label="Следующее фото"
            sx={{ ...toolbarButtonSx, position: "absolute", right: { xs: 6, sm: 16 }, top: "50%", zIndex: 2 }}
          >
            <ChevronRightIcon />
          </IconButton>
        </>
      )}
    </Dialog>
  );
}
