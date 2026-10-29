'use strict';

const crypto = require('node:crypto');
const { pool } = require('../config/database');
const {
  generateCode,
  hashCode
} = require('./emailVerificationCodes');
const {
  sendVerificationEmail
} = require('./verificationEmailService');

const PURPOSE = 'EMAIL_VERIFICATION';
const COOLDOWN_SECONDS = 60;

async function resendVerificationCode(userId) {
  const client = await pool.connect();
  let transactionOpen = false;
  let discardConnection = false;
  let clientReleased = false;

  try {
    await client.query('BEGIN');
    transactionOpen = true;

    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query(
      "SET LOCAL idle_in_transaction_session_timeout = '20s'"
    );

    const userResult = await client.query(
      `SELECT id, email, estado, creado_en
       FROM public.usuarios
       WHERE id = $1
       FOR UPDATE`,
      [userId]
    );

    const user = userResult.rows[0];

    if (!user || user.estado !== 'PENDING_VERIFICATION') {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return { success: false, reason: 'NOT_PENDING' };
    }

    const registeredAt = new Date(user.creado_en).getTime();

    if (
      !Number.isFinite(registeredAt) ||
      Date.now() - registeredAt >= 60 * 60 * 1000
    ) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return { success: false, reason: 'REGISTRATION_EXPIRED' };
    }

    const recent = await client.query(
      `SELECT created_at
       FROM public.user_verification_codes
       WHERE user_id = $1 AND purpose = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, PURPOSE]
    );

    if (recent.rows.length) {
      const elapsed = Date.now() -
        new Date(recent.rows[0].created_at).getTime();

      if (elapsed < COOLDOWN_SECONDS * 1000) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return { success: false, reason: 'COOLDOWN' };
      }
    }

    const code = generateCode();
    const codeHash = hashCode(userId, PURPOSE, code);

    await client.query(
      `UPDATE public.user_verification_codes
       SET consumed_at = NOW()
       WHERE user_id = $1
         AND purpose = $2
         AND consumed_at IS NULL`,
      [userId, PURPOSE]
    );

    await client.query(
      `INSERT INTO public.user_verification_codes
       (id, user_id, purpose, code_hash, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '10 minutes')`,
      [
        `evc-${crypto.randomUUID()}`,
        userId,
        PURPOSE,
        codeHash
      ]
    );

    await client.query('COMMIT');
    transactionOpen = false;

    client.release();
    clientReleased = true;

    let delivery;
    try {
      delivery = await sendVerificationEmail({
        email: user.email,
        code
      });
    } catch {
      return { success: false, reason: 'EMAIL_NOT_SENT' };
    }

    if (!delivery.success) {
      return { success: false, reason: 'EMAIL_NOT_SENT' };
    }

    return {
      success: true,
      code: 'VERIFICATION_EMAIL_RESENT'
    };

  } catch (error) {
    discardConnection = true;
    throw error;
  } finally {
    if (!clientReleased) {
      if (transactionOpen) {
        try {
          await client.query('ROLLBACK');
        } catch {
          discardConnection = true;
        }
      }

      client.release(discardConnection);
    }
  }
}

module.exports = { resendVerificationCode };
