-- Preserve actual mini golf hole quantity (3) and exact £275 bundle total.
-- A 2dp unit price of £91.67 cannot multiply to exactly £275.00.
-- Permit at most 1p total per booking item from unavoidable per-unit rounding.
-- This keeps totals authoritative while avoiding failed 3-hole checkouts.
ALTER TABLE public.booking_items
  DROP CONSTRAINT booking_items_total_matches_quantity;

ALTER TABLE public.booking_items
  ADD CONSTRAINT booking_items_total_matches_quantity
  CHECK (abs(total_price - quantity::numeric * unit_price) <= 0.01);
