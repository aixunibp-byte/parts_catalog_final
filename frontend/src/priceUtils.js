// Определяет, есть ли у товара значимая скидка на Ozon.
// price/old_price приходят из Ozon Seller API при синхронизации: old_price —
// это "старая" цена, которую Ozon показывает зачёркнутой на сторфронте.
// Порог в 5% отсекает шум от округления и незначительных колебаний цены.
const DISCOUNT_THRESHOLD_PERCENT = 5;

export function getOzonDiscountPercent(part) {
  if (!part || part.price == null || part.old_price == null) return null;
  if (part.old_price <= part.price) return null;
  const pct = Math.round((1 - part.price / part.old_price) * 100);
  return pct >= DISCOUNT_THRESHOLD_PERCENT ? pct : null;
}
