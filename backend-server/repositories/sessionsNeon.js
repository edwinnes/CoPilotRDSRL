'use strict';

const crypto = require('node:crypto');
const { query } = require('../config/database');

function hashToken(token) {
  if (typeof token !== 'string' || !token) {
    throw new TypeError('Token inválido');
  }

  return crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');
}

async function createSession({
  userId,
  token,
  expiresAt,
  device = {}
}, client = null) {
  const db = client || { query };
  const id = crypto.randomUUID();

  const result = await db.query(`
    INSERT INTO public.user_sessions (
      id,
      usuario_id,
      token_hash,
      dispositivo,
      expira_en
    )
    VALUES ($1, $2, $3, $4::jsonb, $5)
    RETURNING id, usuario_id, expira_en
  `, [
    id,
    userId,
    hashToken(token),
    JSON.stringify(device),
    expiresAt
  ]);

  return result.rows[0];
}

async function findActiveSession(token) {
  const result = await query(`
    SELECT
      id,
      usuario_id AS "userId",
      expira_en AS "expiresAt"
    FROM public.user_sessions
    WHERE token_hash = $1
      AND revocado_en IS NULL
      AND expira_en > NOW()
    LIMIT 1
  `, [hashToken(token)]);

  return result.rows[0] || null;
}

async function revokeSession(token) {
  const result = await query(`
    UPDATE public.user_sessions
    SET revocado_en = NOW()
    WHERE token_hash = $1
      AND revocado_en IS NULL
    RETURNING id
  `, [hashToken(token)]);

  return result.rowCount > 0;
}

module.exports = {
  hashToken,
  createSession,
  findActiveSession,
  revokeSession
};
