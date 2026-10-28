'use strict';

const crypto = require('node:crypto');
const { query } = require('../config/database');

const PUBLIC_FIELDS = `
  id,
  nombre_completo AS "fullName",
  email,
  telefono AS phone,
  cedula AS "documentId",
  rol AS role,
  estado AS status,
  kyc_estado AS "kycStatus",
  creado_en AS "registeredAt"
`;

async function createClient({
  fullName,
  email,
  passwordHash,
  phone = null,
  documentId = null
}, client = null) {
  const db = client || { query };
  const id = `cli-${crypto.randomUUID()}`;

  const result = await db.query(`
    INSERT INTO public.usuarios (
      id,
      nombre_completo,
      email,
      password_hash,
      telefono,
      cedula,
      rol,
      estado
    )
    VALUES ($1, $2, $3, $4, $5, $6,
            'CLIENT', 'PENDING_VERIFICATION')
    RETURNING ${PUBLIC_FIELDS}
  `, [
    id,
    fullName,
    email,
    passwordHash,
    phone,
    documentId
  ]);

  return result.rows[0];
}

async function findByIdentifier(identifier) {
  const value = String(identifier || '').trim();

  if (!value) return null;

  const result = await query(`
    SELECT
      ${PUBLIC_FIELDS},
      password_hash AS "passwordHash"
    FROM public.usuarios
    WHERE lower(email) = lower($1)
       OR telefono = $1
    LIMIT 1
  `, [value]);

  return result.rows[0] || null;
}

async function findById(id) {
  const result = await query(`
    SELECT ${PUBLIC_FIELDS}
    FROM public.usuarios
    WHERE id = $1
    LIMIT 1
  `, [id]);

  return result.rows[0] || null;
}

module.exports = {
  createClient,
  findByIdentifier,
  findById
};
