-- Migration: revert_supplier_payouts_and_rfq_metrics.sql
DROP TABLE IF EXISTS supplier_payouts CASCADE;
DROP TABLE IF EXISTS rfq_metrics CASCADE;
ALTER TABLE IF EXISTS suppliers DROP COLUMN IF EXISTS commission_rate;
