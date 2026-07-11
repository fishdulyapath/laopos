const { query } = require('../db');

function asText(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function asNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function firstText(...values) {
  for (const value of values) {
    const text = asText(value);
    if (text) return text;
  }
  return '';
}

function parseDateOnly(value, fallback = new Date()) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const text = asText(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  const parsed = new Date(text);
  if (Number.isFinite(parsed.getTime())) return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  return parseDateOnly(fallback);
}

function parseTimeParts(value, fallback) {
  const text = asText(value) || fallback;
  const [hourRaw, minuteRaw] = text.split(':');
  const hour = Math.min(23, Math.max(0, parseInt(hourRaw, 10) || 0));
  const minute = Math.min(59, Math.max(0, parseInt(minuteRaw, 10) || 0));
  return { hour, minute };
}

function dateTime(dateValue, timeValue, fallbackTime) {
  const date = parseDateOnly(dateValue);
  const time = parseTimeParts(timeValue, fallbackTime);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), time.hour, time.minute, 0);
}

async function tableExists(client, tableName) {
  const runner = client || { query };
  const result = await runner.query('SELECT to_regclass($1) AS table_name', [`public.${tableName}`]);
  return Boolean(result.rows[0]?.table_name);
}

async function loadPosSlipCampaigns(client) {
  const runner = client || { query };
  const requiredTables = [
    'pos_slip_campaign',
    'pos_slip_campaign_items',
    'pos_slip_campaign_group',
    'pos_slip_campaign_brand',
    'pos_slip_campaign_category',
  ];
  const exists = await Promise.all(requiredTables.map((table) => tableExists(runner, table)));
  if (!exists[0]) return [];

  const [campaignRes, itemRes, groupRes, brandRes, categoryRes] = await Promise.all([
    runner.query(
      `SELECT
          code,
          COALESCE(name_1,'') AS name_1,
          COALESCE(display_wording,'') AS display_wording,
          date_begin,
          COALESCE(time_begin,'00:00') AS time_begin,
          date_end,
          COALESCE(time_end,'23:59') AS time_end,
          COALESCE(sale_amount,0) AS sale_amount,
          COALESCE(bill_limit,0) AS bill_limit
       FROM pos_slip_campaign
       WHERE COALESCE(enable,0) = 1
       ORDER BY code`,
      [],
    ),
    exists[1]
      ? runner.query(
        `SELECT campaign_code, COALESCE(item_code,'') AS item_code, COALESCE(unit_code,'') AS unit_code
         FROM pos_slip_campaign_items
         ORDER BY campaign_code, COALESCE(line_number,0)`,
        [],
      )
      : Promise.resolve({ rows: [] }),
    exists[2]
      ? runner.query(
        `SELECT campaign_code,
            COALESCE(group_main,'') AS group_main,
            COALESCE(group_sub1,'') AS group_sub1,
            COALESCE(group_sub2,'') AS group_sub2
         FROM pos_slip_campaign_group
         ORDER BY campaign_code, COALESCE(line_number,0)`,
        [],
      )
      : Promise.resolve({ rows: [] }),
    exists[3]
      ? runner.query(
        `SELECT campaign_code, COALESCE(code,'') AS code
         FROM pos_slip_campaign_brand
         ORDER BY campaign_code, COALESCE(line_number,0)`,
        [],
      )
      : Promise.resolve({ rows: [] }),
    exists[4]
      ? runner.query(
        `SELECT campaign_code, COALESCE(code,'') AS code
         FROM pos_slip_campaign_category
         ORDER BY campaign_code, COALESCE(line_number,0)`,
        [],
      )
      : Promise.resolve({ rows: [] }),
  ]);

  return campaignRes.rows.map((row) => {
    const code = asText(row.code);
    return {
      campaign_code: code,
      campaign_name: asText(row.name_1),
      display_wording: asText(row.display_wording),
      date_begin: row.date_begin,
      time_begin: asText(row.time_begin) || '00:00',
      date_end: row.date_end,
      time_end: asText(row.time_end) || '23:59',
      sale_amount: asNumber(row.sale_amount),
      bill_limit: asNumber(row.bill_limit),
      items: itemRes.rows
        .filter((item) => asText(item.campaign_code) === code)
        .map((item) => ({ item_code: asText(item.item_code), unit_code: asText(item.unit_code) })),
      groups: groupRes.rows
        .filter((item) => asText(item.campaign_code) === code)
        .map((item) => ({ group_main: asText(item.group_main), group_sub1: asText(item.group_sub1), group_sub2: asText(item.group_sub2) })),
      brands: brandRes.rows
        .filter((item) => asText(item.campaign_code) === code)
        .map((item) => ({ code: asText(item.code) })),
      categories: categoryRes.rows
        .filter((item) => asText(item.campaign_code) === code)
        .map((item) => ({ code: asText(item.code) })),
    };
  });
}

async function loadItemMetadata(client, items) {
  const runner = client || { query };
  const itemCodes = Array.from(new Set((items || []).map((item) => asText(item.item_code ?? item._itemCode)).filter(Boolean)));
  if (!itemCodes.length) return new Map();
  const result = await runner.query(
    `SELECT code,
        COALESCE(group_main,'') AS group_main,
        COALESCE(group_sub,'') AS group_sub,
        COALESCE(group_sub2,'') AS group_sub2,
        COALESCE(item_brand,'') AS item_brand,
        COALESCE(item_category,'') AS item_category
     FROM ic_inventory
     WHERE code = ANY($1::text[])`,
    [itemCodes],
  );
  return new Map(result.rows.map((row) => [asText(row.code), row]));
}

function normalizeCampaignSaleItems(items, metadataByCode = new Map()) {
  return (items || [])
    .map((item) => {
      const itemCode = asText(item.item_code ?? item._itemCode);
      if (!itemCode) return null;
      const meta = metadataByCode.get(itemCode) || {};
      const qty = asNumber(item.qty ?? item._qty);
      const price = asNumber(item.price ?? item._price);
      const amount = asNumber(item.amount ?? item._amount ?? item.sum_amount, qty * price);
      return {
        item_code: itemCode,
        item_name: asText(item.item_name ?? item._itemName),
        unit_code: firstText(item.unit_code, item._unitCode),
        amount,
        group_main: firstText(item.group_main, item.groupMain, meta.group_main),
        group_sub1: firstText(item.group_sub1, item.groupSub1, item.group_sub, meta.group_sub),
        group_sub2: firstText(item.group_sub2, item.groupSub2, meta.group_sub2),
        brand: firstText(item.brand, item.item_brand, meta.item_brand),
        category: firstText(item.category, item.item_category, meta.item_category),
      };
    })
    .filter(Boolean);
}

function itemMatchesCampaignItem(campaignItem, saleItem) {
  return saleItem.item_code === campaignItem.item_code && saleItem.unit_code === campaignItem.unit_code;
}

function itemMatchesCampaignGroup(campaignGroup, saleItem) {
  return (
    (saleItem.group_main && saleItem.group_main === campaignGroup.group_main)
    || (saleItem.group_sub1 && saleItem.group_sub1 === campaignGroup.group_sub1)
    || (saleItem.group_sub2 && saleItem.group_sub2 === campaignGroup.group_sub2)
  );
}

function hasAnyConditionMatch(campaign, saleItems) {
  for (const condition of campaign.items) {
    if (saleItems.some((item) => itemMatchesCampaignItem(condition, item))) return true;
  }
  for (const condition of campaign.groups) {
    if (saleItems.some((item) => itemMatchesCampaignGroup(condition, item))) return true;
  }
  for (const condition of campaign.brands) {
    if (saleItems.some((item) => item.brand && item.brand === condition.code)) return true;
  }
  for (const condition of campaign.categories) {
    if (saleItems.some((item) => item.category && item.category === condition.code)) return true;
  }
  return false;
}

function sumMatchingSaleAmount(campaign, saleItems) {
  let sum = 0;
  for (const condition of campaign.items) {
    const found = saleItems.find((item) => itemMatchesCampaignItem(condition, item));
    if (found) sum += found.amount;
  }
  for (const condition of campaign.groups) {
    for (const item of saleItems) {
      if (itemMatchesCampaignGroup(condition, item)) sum += item.amount;
    }
  }
  for (const condition of campaign.brands) {
    for (const item of saleItems) {
      if (item.brand && item.brand === condition.code) sum += item.amount;
    }
  }
  for (const condition of campaign.categories) {
    for (const item of saleItems) {
      if (item.category && item.category === condition.code) sum += item.amount;
    }
  }
  return sum;
}

function campaignInDateRange(campaign, docDate, docTime) {
  const processAt = dateTime(docDate, docTime || '00:00', '00:00');
  const startAt = dateTime(campaign.date_begin || docDate, campaign.time_begin, '00:00');
  const endAt = dateTime(campaign.date_end || docDate, campaign.time_end, '23:59');
  return processAt >= startAt && processAt <= endAt;
}

function matchPosSlipCampaigns({ campaigns, saleItems, docDate, docTime }) {
  const matches = [];
  for (const campaign of campaigns || []) {
    const saleAmount = asNumber(campaign.sale_amount);
    if (saleAmount <= 0) continue;
    if (!campaignInDateRange(campaign, docDate, docTime)) continue;
    if (!hasAnyConditionMatch(campaign, saleItems)) continue;
    const matchAmount = sumMatchingSaleAmount(campaign, saleItems);
    if (matchAmount < saleAmount) continue;
    let qty = Math.trunc(matchAmount / saleAmount);
    if (campaign.bill_limit > 0 && qty > campaign.bill_limit) qty = Math.trunc(campaign.bill_limit);
    if (qty <= 0) continue;
    matches.push({
      campaign_code: campaign.campaign_code,
      campaign_name: campaign.campaign_name,
      display_wording: campaign.display_wording,
      promotion_text: campaign.display_wording,
      qty,
      match_amount: matchAmount,
      sale_amount: saleAmount,
    });
  }
  return matches;
}

async function processPosSlipCampaign(client, { docDate, docTime, items }) {
  const campaigns = await loadPosSlipCampaigns(client);
  if (!campaigns.length) return [];
  const metadata = await loadItemMetadata(client, items);
  const saleItems = normalizeCampaignSaleItems(items, metadata);
  return matchPosSlipCampaigns({ campaigns, saleItems, docDate, docTime });
}

module.exports = {
  loadItemMetadata,
  loadPosSlipCampaigns,
  matchPosSlipCampaigns,
  normalizeCampaignSaleItems,
  processPosSlipCampaign,
};
