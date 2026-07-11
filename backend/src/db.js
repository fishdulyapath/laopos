require('dotenv').config();
const { Pool, types } = require('pg');

// ป้องกัน pg driver แปลง date/timestamp เป็น JS Date object
// (ซึ่งทำให้เกิด timezone shift เมื่อ serialize เป็น JSON)
// ให้ return เป็น string ตรงๆ แทน — frontend แปลงเองตาม YYYY-MM-DD หรือ HH:MM
types.setTypeParser(1082, (val) => val);          // date
types.setTypeParser(1114, (val) => val);          // timestamp without time zone
types.setTypeParser(1184, (val) => val);          // timestamp with time zone

function normalizeDbHost(value) {
  const host = (value || 'localhost').trim();
  try {
    return new URL(host).hostname || host;
  } catch {
    return host;
  }
}

const dbConfig = {
  host: normalizeDbHost(process.env.DB_HOST),
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
};

const pool = new Pool({ ...dbConfig, database: process.env.DB_NAME || 'demo' });
const poolImages = new Pool({ ...dbConfig, database: process.env.DB_IMAGES_NAME || 'demo_images' });

pool.on('connect', (client) => {
  client.query('SET enable_seqscan = false').catch(() => {});
  client.query("SET TIME ZONE 'Asia/Bangkok'").catch(() => {});
});
pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});

poolImages.on('connect', (client) => {
  client.query('SET enable_seqscan = false').catch(() => {});
});
poolImages.on('error', (err) => {
  console.error('PostgreSQL poolImages error:', err.message);
});

async function query(sql, params) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function queryImages(sql, params) {
  const client = await poolImages.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

module.exports = { pool, poolImages, query, queryImages, withTransaction };
