'use strict';

const crypto = require('node:crypto');
const { pool } = require('../config/database');

function lockKeyForUser(userId) {
  const digest = crypto
    .createHash('sha256')
    .update(`copilotrd:email-verification:${userId}`)
    .digest();

  return digest.readBigInt64BE(0).toString();
}

async function withEmailVerificationLock(userId, operation) {
  if (!userId || typeof operation !== 'function') {
    throw new TypeError('Usuario u operación inválidos');
  }

  const client = await pool.connect();
  let transactionOpen = false;

  try {
    await client.query('BEGIN');
    transactionOpen = true;

    await client.query(
      "SET LOCAL lock_timeout = '5s'"
    );

    await client.query(
      "SET LOCAL statement_timeout = '15s'"
    );

    await client.query(
      "SET LOCAL idle_in_transaction_session_timeout = '20s'"
    );

    await client.query(
      'SELECT pg_advisory_xact_lock($1::bigint)',
      [lockKeyForUser(userId)]
    );

    const result = await operation(client);

    await client.query('COMMIT');
    transactionOpen = false;

    return result;
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch {}
    }

    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  lockKeyForUser,
  withEmailVerificationLock
};
