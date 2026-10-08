// Сборка ссылки на карточку товара в сторфронте Ozon.
// ВАЖНО: сторфронт ozon.ru резолвит прямую карточку товара только по SKU.
// product_id — внутренний идентификатор Seller API, на ozon.ru не открывается.
// Официальный формат прямой ссылки: https://www.ozon.ru/product/{sku}
//
// Если SKU ещё не присвоен (частая ситуация для недавно синхронизированных
// или ещё не прошедших модерацию товаров) — ведём на поиск Ozon по артикулу
// (атрибут #9048 / offer_id), а не показываем нерабочую ссылку.
export function getOzonUrl(part) {
  if (!part) return null;
  if (part.ozon_sku) return `https://www.ozon.ru/product/${part.ozon_sku}/`;
  if (part.article) return `https://www.ozon.ru/search/?text=${encodeURIComponent(part.article)}`;
  return null;
}
