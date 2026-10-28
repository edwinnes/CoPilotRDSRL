'use strict';

const { Pool } = require('pg');

const rawConnectionString = process.env.DATABASE_URL || process.env.NEON_URL;
const connectionString = rawConnectionString
  ? (() => {
      const url = new URL(rawConnectionString);
      url.searchParams.set('sslmode', 'verify-full');
      return url.toString();
    })()
  : null;

if (!connectionString) {
  throw new Error('DATABASE_URL o NEON_URL no configurada');
}

const pool = new Pool({
  connectionString,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: {
    rejectUnauthorized: true
  }
});

pool.on('error', (error) => {
  console.error('[DATABASE] Error en conexión inactiva:', error.code || error.message);
});

async function query(text, params = []) {
  return pool.query(text, params);
}

async function healthCheck() {
  const result = await query('SELECT 1 AS ok');
  return result.rows[0]?.ok === 1;
}

module.exports = {
  pool,
  query,
  healthCheck
};
