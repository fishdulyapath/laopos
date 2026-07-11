const express = require('express');
const router = express.Router();
const { query } = require('../db');

const AR_CREDIT_FLAGS = {
  sale: 44,
  saleReturn: 48,
  saleDebit: 46,
  arOpeningDebt: 93,
  arOtherDebt: 99,
  arOpeningDebit: 95,
  arOtherDebit: 101,
  arOpeningCredit: 97,
  arOtherCredit: 103,
  arPay: 239,
  cashBankIncomeOther: 250,
  cashBankIncomeOtherCredit: 252,
  cashBankIncomeOtherDebit: 254,
  receiveChequeNewDebt: 418,
};

function sqlNumberList(values) {
  return values.map((value) => Number(value)).filter((value) => Number.isFinite(value)).join(',');
}

function arCreditMovementSql({ includeApArTrans = true } = {}) {
  const debtFlags = sqlNumberList([AR_CREDIT_FLAGS.arOpeningDebt, AR_CREDIT_FLAGS.arOtherDebt]);
  const saleDebtFlags = sqlNumberList([
    AR_CREDIT_FLAGS.sale,
    AR_CREDIT_FLAGS.cashBankIncomeOther,
    AR_CREDIT_FLAGS.receiveChequeNewDebt,
  ]);
  const debitFlags = sqlNumberList([
    AR_CREDIT_FLAGS.saleDebit,
    AR_CREDIT_FLAGS.arOpeningDebit,
    AR_CREDIT_FLAGS.arOtherDebit,
    AR_CREDIT_FLAGS.cashBankIncomeOtherDebit,
  ]);
  const creditFlags = sqlNumberList([
    AR_CREDIT_FLAGS.arOpeningCredit,
    AR_CREDIT_FLAGS.arOtherCredit,
    AR_CREDIT_FLAGS.cashBankIncomeOtherCredit,
  ]);
  const paymentSql = includeApArTrans
    ? `UNION ALL
       SELECT roworder, 4 AS calc_type, doc_no, cust_code, -1*COALESCE(total_net_value,0) AS amount
       FROM ap_ar_trans
       WHERE COALESCE(last_status,0)=0
         AND trans_flag=${AR_CREDIT_FLAGS.arPay}`
    : '';
  return `
    SELECT roworder, 1 AS calc_type, doc_no, cust_code, COALESCE(total_amount,0) AS amount
    FROM ic_trans
    WHERE COALESCE(last_status,0)=0
      AND trans_flag IN (${saleDebtFlags})
      AND inquiry_type IN (0,2)
    UNION ALL
    SELECT roworder, 1 AS calc_type, doc_no, cust_code, COALESCE(total_amount,0) AS amount
    FROM ic_trans
    WHERE COALESCE(last_status,0)=0
      AND trans_flag IN (${debtFlags})
    UNION ALL
    SELECT roworder, 2 AS calc_type, doc_no, cust_code, COALESCE(total_amount,0) AS amount
    FROM ic_trans
    WHERE COALESCE(last_status,0)=0
      AND trans_flag IN (${debitFlags})
    UNION ALL
    SELECT roworder, 3 AS calc_type, doc_no, cust_code, -1*COALESCE(total_amount,0) AS amount
    FROM ic_trans
    WHERE COALESCE(last_status,0)=0
      AND trans_flag=${AR_CREDIT_FLAGS.saleReturn}
      AND inquiry_type IN (0,2,4)
    UNION ALL
    SELECT roworder, 3 AS calc_type, doc_no, cust_code, -1*COALESCE(total_amount,0) AS amount
    FROM ic_trans
    WHERE COALESCE(last_status,0)=0
      AND trans_flag IN (${creditFlags})
    ${paymentSql}`;
}

// GET /service/v1/getCustomerCredit
router.get('/getCustomerCredit', async (req, res) => {
  const { cust_code = '' } = req.query;
  try {
    const detailColumns = await query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'ar_customer_detail'
         AND column_name = ANY($1::text[])`,
      [['credit_money', 'credit_money_max', 'credit_status', 'close_credit_date', 'close_reason', 'past_due_day', 'tax_id', 'card_id', 'branch_type', 'branch_code']],
    );
    const hasDetailColumn = new Set(detailColumns.rows.map((row) => row.column_name));
    const creditMoneyExpr = hasDetailColumn.has('credit_money') ? 'COALESCE(d.credit_money,0)' : '0';
    const creditMoneyMaxExpr = hasDetailColumn.has('credit_money_max') ? 'COALESCE(d.credit_money_max,0)' : '0';
    const creditStatusExpr = hasDetailColumn.has('credit_status') ? 'COALESCE(d.credit_status,0)' : '0';
    const closeCreditDateExpr = hasDetailColumn.has('close_credit_date') ? 'd.close_credit_date::date' : 'NULL::date';
    const closeReasonExpr = hasDetailColumn.has('close_reason') ? "COALESCE(d.close_reason,'')" : "''";
    const pastDueDayExpr = hasDetailColumn.has('past_due_day') ? 'COALESCE(d.past_due_day,0)' : '0';
    const taxIdExpr = hasDetailColumn.has('tax_id') ? "COALESCE(d.tax_id,'')" : "''";
    const cardIdExpr = hasDetailColumn.has('card_id') ? "COALESCE(d.card_id,'')" : "''";
    const branchTypeExpr = hasDetailColumn.has('branch_type') ? 'COALESCE(d.branch_type,0)' : '0';
    const branchCodeExpr = hasDetailColumn.has('branch_code') ? "COALESCE(d.branch_code,'')" : "''";
    const sql = `
      SELECT
        c.code AS user_code,
        c.name_1 AS user_name,
        COALESCE(c.address,'') AS address,
        COALESCE(c.telephone,'') AS telephone,
        COALESCE(c.website,'') AS website,
        COALESCE(d.logistic_area,'') AS logistic_area,
        COALESCE(d.credit_day,0) AS credit_day,
        (NOW() + COALESCE(d.credit_day,0) * INTERVAL '1 day')::date AS credit_date,
        ${creditMoneyExpr} AS credit_money,
        ${creditMoneyMaxExpr} AS credit_money_max,
        ${creditStatusExpr} AS credit_status,
        ${closeCreditDateExpr} AS close_credit_date,
        ${closeReasonExpr} AS close_reason,
        ${pastDueDayExpr} AS past_due_day,
        ${taxIdExpr} AS tax_id,
        ${cardIdExpr} AS card_id,
        ${branchTypeExpr} AS branch_type,
        ${branchCodeExpr} AS branch_code,
        COALESCE(d.group_main,'') AS group_main
      FROM ar_customer c
      LEFT JOIN ar_customer_detail d ON d.ar_code = c.code
      WHERE c.code = $1
      LIMIT 1
    `;
    const result = await query(sql, [cust_code]);
    const obj = result.rows.length > 0 ? {
      code: result.rows[0].user_code,
      name: result.rows[0].user_name,
      credit_day: result.rows[0].credit_day,
      credit_date: result.rows[0].credit_date,
      credit_money: result.rows[0].credit_money,
      credit_money_max: result.rows[0].credit_money_max,
      credit_status: result.rows[0].credit_status,
      close_credit_date: result.rows[0].close_credit_date,
      close_reason: result.rows[0].close_reason,
      past_due_day: result.rows[0].past_due_day,
      tax_id: result.rows[0].tax_id,
      card_id: result.rows[0].card_id,
      branch_type: result.rows[0].branch_type,
      branch_code: result.rows[0].branch_code,
    } : {};
    return res.json({ success: true, data: obj });
  } catch (ex) {
    return res.status(400).json({ ERROR: ex.message });
  }
});

// GET /service/v1/getAdvancePayment
router.get('/getAdvancePayment', async (req, res) => {
  const { cust_code = '' } = req.query;
  try {
    const sql = `
      SELECT cust_code,
        CASE WHEN _def_last_status=1 THEN 0 ELSE deposit_buy2 END AS deposit_buy2,
        CASE WHEN _def_last_status=1 THEN 0 ELSE sum_used END AS sum_used,
        CASE WHEN _def_last_status=1 THEN 0 ELSE total_amount-(deposit_buy2+sum_used) END AS balance_amount,
        doc_date, doc_no, total_amount
      FROM (
        SELECT cust_code,
          COALESCE((SELECT SUM(total_amount) FROM ic_trans AS x1 WHERE x1.last_status=0 AND x1.doc_ref=ic_trans.doc_no AND x1.trans_flag IN (112,42)),0) AS deposit_buy2,
          COALESCE((SELECT SUM(amount) FROM cb_trans_detail AS x2 WHERE x2.last_status=0 AND x2.trans_number=ic_trans.doc_no AND x2.trans_flag NOT IN (40,110)),0) AS sum_used,
          doc_date, doc_no, doc_time, total_amount,
          last_status AS _def_last_status
        FROM ic_trans
        WHERE trans_flag IN (40,9040)
          AND is_doc_copy <> 1
          AND cust_code = $1
      ) AS temp1
      ORDER BY doc_date DESC, doc_no
      LIMIT 20
    `;
    const result = await query(sql, [cust_code]);
    const data = result.rows.map(r => ({
      doc_no: r.doc_no,
      doc_date: r.doc_date,
      total_amount: r.total_amount,
      used: r.sum_used,
      balance_amount: r.balance_amount,
    }));
    return res.json({ success: true, data });
  } catch (ex) {
    return res.status(400).json({ ERROR: ex.message });
  }
});

// GET /service/v1/getTotalBalance
router.get('/getTotalBalance', async (req, res) => {
  const { cust_code = '' } = req.query;
  try {
    const apArTransExists = await query("SELECT to_regclass('public.ap_ar_trans') AS table_name");
    const sql = `
      SELECT COALESCE(SUM(amount),0)::numeric AS total_balance
      FROM (${arCreditMovementSql({ includeApArTrans: !!apArTransExists.rows[0]?.table_name })}) AS temp1
      WHERE doc_no <> ''
        AND cust_code = $1
    `;
    const result = await query(sql, [cust_code]);
    let total_balance = 0;
    for (const r of result.rows) {
      total_balance += parseFloat(r.total_balance) || 0;
    }
    return res.json({ success: true, total_balance });
  } catch (ex) {
    return res.status(400).json({ ERROR: ex.message });
  }
});

module.exports = router;
