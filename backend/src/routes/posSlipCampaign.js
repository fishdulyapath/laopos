const express = require('express');
const router = express.Router();
const { processPosSlipCampaign } = require('../utils/posSlipCampaign');

function parseBody(req) {
  if (typeof req.body === 'string') return JSON.parse(req.body);
  return req.body || {};
}

function localDateISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function localTimeHHMM() {
  return new Date().toTimeString().slice(0, 5);
}

router.post('/processPosSlipCampaign', async (req, res) => {
  try {
    const body = parseBody(req);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return res.json({ success: true, data: [] });
    const data = await processPosSlipCampaign(null, {
      docDate: body.doc_date || body.docDate || localDateISO(),
      docTime: body.doc_time || body.docTime || localTimeHHMM(),
      items,
    });
    return res.json({ success: true, data });
  } catch (ex) {
    return res.status(400).json({
      success: false,
      error_type: ex.constructor.name,
      message: ex.message,
      detail: ex.toString(),
    });
  }
});

module.exports = router;
