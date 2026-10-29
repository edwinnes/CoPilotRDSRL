'use strict';

const crypto = require('node:crypto');
const { pool } = require('../config/database');
const {
  CODE_TTL_MINUTES,
  MAX_ATTEMPTS,
  generateCode,
  hashCode,
  compareCode
} = require('../services/emailVerificationCodes');

const PURPOSE = 'EMAIL_VERIFICATION';
const RESEND_COOLDOWN_SECONDS = 60;

async function prepareVerificationCode(userId) {
  const client = await pool.connect();

  try {
    const userResult = await client.query(
      `SELECT id, email, estado, creado_en
       FROM public.usuarios
       WHERE id = $1`,
      [userId]
    );

    const user = userResult.rows[0];

    if (!user || user.estado !== 'PENDING_VERIFICATION') {
      return { success: false, reason: 'NOT_PENDING' };
    }

    const registeredAt = new Date(user.creado_en).getTime();
    if (!Number.isFinite(registeredAt) || Date.now() - registeredAt >= 60 * 60 * 1000) {
      return { success: false, reason: 'REGISTRATION_EXPIRED' };
    }

    const recent = await client.query(
      `SELECT id, created_at
       FROM public.user_verification_codes
       WHERE user_id = $1
         AND purpose = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, PURPOSE]
    );

    const latest = recent.rows[0] || null;

    if (latest) {
      const elapsed = Date.now() -
        new Date(latest.created_at).getTime();

      if (elapsed < RESEND_COOLDOWN_SECONDS * 1000) {
        return { success: false, reason: 'COOLDOWN' };
      }
    }

    return {
      success: true,
      userId,
      email: user.email,
      code: generateCode(),
      previousCodeId: latest?.id || null,
      expiresInMinutes: CODE_TTL_MINUTES
    };
  } finally {
    client.release();
  }
}

async function confirmVerificationCode(prepared) {
  if (
    !prepared ||
    prepared.success !== true ||
    typeof prepared.userId !== 'string' ||
    !/^\d{6}$/.test(String(prepared.code))
  ) {
    return { success: false, reason: 'INVALID_PREPARATION' };
  }

  const client = await pool.connect();
  let transactionOpen = false;

  try {
    await client.query('BEGIN');
    transactionOpen = true;

    const userResult = await client.query(
      `SELECT id, estado, creado_en
       FROM public.usuarios
       WHERE id = $1
       FOR UPDATE`,
      [prepared.userId]
    );

    const user = userResult.rows[0];

    if (!user || user.estado !== 'PENDING_VERIFICATION') {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return { success: false, reason: 'NOT_PENDING' };
    }

    const registeredAt = new Date(user.creado_en).getTime();
    if (!Number.isFinite(registeredAt) || Date.now() - registeredAt >= 60 * 60 * 1000) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return { success: false, reason: 'REGISTRATION_EXPIRED' };
    }

    const recent = await client.query(
      `SELECT id, created_at
       FROM public.user_verification_codes
       WHERE user_id = $1
         AND purpose = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [prepared.userId, PURPOSE]
    );

    const latest = recent.rows[0] || null;

    if ((latest?.id || null) !== prepared.previousCodeId) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return { success: false, reason: 'CODE_CHANGED' };
    }

    if (latest) {
      const elapsed = Date.now() -
        new Date(latest.created_at).getTime();

      if (elapsed < RESEND_COOLDOWN_SECONDS * 1000) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return { success: false, reason: 'COOLDOWN' };
      }
    }

    const id = `evc-${crypto.randomUUID()}`;
    const codeHash = hashCode(
      prepared.userId,
      PURPOSE,
      prepared.code
    );

    await client.query(
      `UPDATE public.user_verification_codes
       SET consumed_at = NOW()
       WHERE user_id = $1
         AND purpose = $2
         AND consumed_at IS NULL`,
      [prepared.userId, PURPOSE]
    );

    await client.query(
      `INSERT INTO public.user_verification_codes
       (id, user_id, purpose, code_hash, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '10 minutes')`,
      [id, prepared.userId, PURPOSE, codeHash]
    );

    await client.query('COMMIT');
    transactionOpen = false;

    return {
      success: true,
      code: 'VERIFICATION_CODE_CONFIRMED'
    };
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

async function createVerificationCode(userId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

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
      return { success: false, code: 'NOT_PENDING' };
    }

    const registeredAt = new Date(user.creado_en).getTime();
    if (!Number.isFinite(registeredAt) || Date.now() - registeredAt >= 60 * 60 * 1000) {
      await client.query('ROLLBACK');
      return { success: false, code: 'REGISTRATION_EXPIRED' };
    }

    const recent = await client.query(
      `SELECT created_at
       FROM public.user_verification_codes
       WHERE user_id = $1
         AND purpose = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, PURPOSE]
    );

    if (recent.rows.length) {
      const elapsed = Date.now() -
        new Date(recent.rows[0].created_at).getTime();

      if (elapsed < RESEND_COOLDOWN_SECONDS * 1000) {
        await client.query('ROLLBACK');
        return { success: false, code: 'COOLDOWN' };
      }
    }

    const code = generateCode();
    const id = `evc-${crypto.randomUUID()}`;
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
       VALUES (
         $1, $2, $3, $4,
         NOW() + INTERVAL '10 minutes'
       )`,
      [id, userId, PURPOSE, codeHash]
    );

    await client.query('COMMIT');

    return {
      success: true,
      code,
      email: user.email,
      expiresInMinutes: CODE_TTL_MINUTES
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function verifyEmailCode(userId, submittedCode) {
  if (!/^\d{6}$/.test(String(submittedCode))) {
    return { success: false, code: 'INVALID_CODE' };
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      `SELECT id, estado, creado_en
       FROM public.usuarios
       WHERE id = $1
       FOR UPDATE`,
      [userId]
    );

    if (
      !userResult.rows.length ||
      userResult.rows[0].estado !== 'PENDING_VERIFICATION'
    ) {
      await client.query('ROLLBACK');
      return { success: false, code: 'NOT_PENDING' };
    }

    const registeredAt = new Date(
      userResult.rows[0].creado_en
    ).getTime();

    if (
      !Number.isFinite(registeredAt) ||
      Date.now() - registeredAt >= 60 * 60 * 1000
    ) {
      await client.query('ROLLBACK');
      return { success: false, code: 'REGISTRATION_EXPIRED' };
    }

    const result = await client.query(
      `SELECT id, code_hash, expires_at, attempts
       FROM public.user_verification_codes
       WHERE user_id = $1
         AND purpose = $2
         AND consumed_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [userId, PURPOSE]
    );

    const record = result.rows[0];

    if (!record) {
      await client.query('ROLLBACK');
      return { success: false, code: 'CODE_NOT_FOUND' };
    }

    if (new Date(record.expires_at).getTime() <= Date.now()) {
      await client.query('ROLLBACK');
      return { success: false, code: 'CODE_EXPIRED' };
    }

    if (record.attempts >= MAX_ATTEMPTS) {
      await client.query('ROLLBACK');
      return { success: false, code: 'MAX_ATTEMPTS' };
    }

    const valid = compareCode(
      userId,
      PURPOSE,
      submittedCode,
      record.code_hash
    );

    if (!valid) {
      await client.query(
        `UPDATE public.user_verification_codes
         SET attempts = attempts + 1
         WHERE id = $1`,
        [record.id]
      );

      await client.query('COMMIT');

      return { success: false, code: 'INVALID_CODE' };
    }

    await client.query(
      `UPDATE public.usuarios
       SET estado = 'ACTIVO'
       WHERE id = $1
         AND estado = 'PENDING_VERIFICATION'`,
      [userId]
    );

    await client.query(
      `UPDATE public.user_verification_codes
       SET consumed_at = NOW()
       WHERE id = $1`,
      [record.id]
    );

    await client.query('COMMIT');

    return { success: true, code: 'EMAIL_VERIFIED' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}


async function createInitialVerificationCode(userId, client) {
  if (!client || typeof client.query !== 'function') {
    throw new Error('Se requiere una transacción PostgreSQL activa');
  }

  const code = generateCode();
  const id = `evc-${crypto.randomUUID()}`;
  const codeHash = hashCode(userId, PURPOSE, code);

  await client.query(
    `INSERT INTO public.user_verification_codes
     (id, user_id, purpose, code_hash, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '10 minutes')`,
    [id, userId, PURPOSE, codeHash]
  );

  return {
    code,
    expiresInMinutes: CODE_TTL_MINUTES
  };
}

module.exports = {
  prepareVerificationCode,
  confirmVerificationCode,
  createVerificationCode,
  createInitialVerificationCode,
  verifyEmailCode
};
