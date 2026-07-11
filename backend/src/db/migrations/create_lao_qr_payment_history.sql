-- Migration: เก็บประวัติการสร้างและตรวจสอบรับเงิน Lao QR/OnePay
-- Run once on target DB. Safe to re-run (IF NOT EXISTS + ON CONFLICT-safe indexes).

CREATE TABLE IF NOT EXISTS public.lao_qr_payment_history (
  id                  BIGSERIAL PRIMARY KEY,
  uuid                VARCHAR(80)  NOT NULL,
  invoiceid           VARCHAR(30)  NOT NULL DEFAULT '',
  provider            VARCHAR(20)  NOT NULL DEFAULT 'laoqr',
  status              VARCHAR(30)  NOT NULL DEFAULT 'pending',
  status_message      TEXT         NOT NULL DEFAULT '',

  amount_lak          NUMERIC(18,2) NOT NULL DEFAULT 0,
  currency_code       VARCHAR(20)   NOT NULL DEFAULT '',
  exchange_rate       NUMERIC(18,8) NOT NULL DEFAULT 0,
  amount_base         NUMERIC(18,2) NOT NULL DEFAULT 0,
  rounding_amount     NUMERIC(18,2) NOT NULL DEFAULT 0,
  pass_book_code      VARCHAR(50)   NOT NULL DEFAULT '',

  shopcode            VARCHAR(50)  NOT NULL DEFAULT '',
  terminalid          VARCHAR(80)  NOT NULL DEFAULT '',
  pos_id              VARCHAR(50)  NOT NULL DEFAULT '',
  pos_code            VARCHAR(50)  NOT NULL DEFAULT '',
  pos_name            VARCHAR(255) NOT NULL DEFAULT '',
  machinecode         VARCHAR(80)  NOT NULL DEFAULT '',
  branch_code         VARCHAR(50)  NOT NULL DEFAULT '',
  creator_code        VARCHAR(50)  NOT NULL DEFAULT '',
  creator_name        VARCHAR(255) NOT NULL DEFAULT '',

  qrc                 TEXT         NOT NULL DEFAULT '',
  bank_result         NUMERIC,
  fccref              VARCHAR(100) NOT NULL DEFAULT '',
  ticket              VARCHAR(100) NOT NULL DEFAULT '',
  service             VARCHAR(50)  NOT NULL DEFAULT '',
  frombank            VARCHAR(100) NOT NULL DEFAULT '',
  bank_tx_datetime    VARCHAR(80)  NOT NULL DEFAULT '',
  bank_amount_lak     NUMERIC(18,2) NOT NULL DEFAULT 0,

  create_request      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  create_response     JSONB        NOT NULL DEFAULT '{}'::jsonb,
  last_check_request  JSONB        NOT NULL DEFAULT '{}'::jsonb,
  last_check_response JSONB        NOT NULL DEFAULT '{}'::jsonb,

  sale_doc_no         VARCHAR(50)  NOT NULL DEFAULT '',
  created_at          TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP    NOT NULL DEFAULT NOW(),
  last_checked_at     TIMESTAMP,
  paid_at             TIMESTAMP,

  CONSTRAINT lao_qr_payment_history_uuid_unique UNIQUE (uuid)
);

CREATE INDEX IF NOT EXISTS idx_lao_qr_payment_history_created_at
  ON public.lao_qr_payment_history (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lao_qr_payment_history_status
  ON public.lao_qr_payment_history (status);

CREATE INDEX IF NOT EXISTS idx_lao_qr_payment_history_invoiceid
  ON public.lao_qr_payment_history (invoiceid);

CREATE INDEX IF NOT EXISTS idx_lao_qr_payment_history_pos_created
  ON public.lao_qr_payment_history (pos_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lao_qr_payment_history_branch_created
  ON public.lao_qr_payment_history (branch_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lao_qr_payment_history_creator_created
  ON public.lao_qr_payment_history (creator_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lao_qr_payment_history_fccref
  ON public.lao_qr_payment_history (fccref)
  WHERE fccref <> '';

CREATE INDEX IF NOT EXISTS idx_lao_qr_payment_history_sale_doc_no
  ON public.lao_qr_payment_history (sale_doc_no)
  WHERE sale_doc_no <> '';

CREATE OR REPLACE FUNCTION public.set_lao_qr_payment_history_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lao_qr_payment_history_updated_at
  ON public.lao_qr_payment_history;

CREATE TRIGGER trg_lao_qr_payment_history_updated_at
BEFORE UPDATE ON public.lao_qr_payment_history
FOR EACH ROW
EXECUTE FUNCTION public.set_lao_qr_payment_history_updated_at();
