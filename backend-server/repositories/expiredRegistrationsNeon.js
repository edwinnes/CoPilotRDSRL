'use strict';

/*
 * Limpieza conservadora de registros CLIENT vencidos.
 *
 * Requiere una transacción PostgreSQL ya iniciada.
 * El llamador debe hacer COMMIT o ROLLBACK.
 */

const { query } = require('../config/database');

const EXPIRATION_INTERVAL = '1 hour';

async function lockRegistrationEmail(client, email) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('Se requiere una conexión transaccional');
  }

  const normalized = String(email || '').trim().toLowerCase();

  if (!normalized) {
    throw new TypeError('Correo requerido');
  }

  /*
   * Serializa las operaciones que usen este mismo bloqueo.
   * Debe invocarse antes de consultar o crear el registro.
   */
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    ['copilotrd:registration:' + normalized]
  );
}

async function findExpiredPendingClient(client, email) {
  const result = await client.query(`
    SELECT id
    FROM public.usuarios
    WHERE lower(email) = lower($1)
      AND rol = 'CLIENT'
      AND estado = 'PENDING_VERIFICATION'
      AND creado_en <= NOW() - INTERVAL '${EXPIRATION_INTERVAL}'
      AND balance = 0
      AND km_bank_balance = 0
      AND viajes_totales = 0
    FOR UPDATE
  `, [email]);

  return result.rows[0] || null;
}

async function hasProtectedRelations(client, userId) {
  const references = await client.query(`
    SELECT
      con.conrelid::regclass AS table_name,
      att.attname AS column_name
    FROM pg_constraint con
    JOIN LATERAL unnest(con.conkey)
      WITH ORDINALITY AS cols(attnum, position)
      ON true
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid
     AND att.attnum = cols.attnum
    WHERE con.contype = 'f'
      AND con.confrelid = 'public.usuarios'::regclass
      AND (
          con.confdeltype <> 'c'
          OR con.conrelid IN (
            'public.user_sessions'::regclass,
            'public.user_levels'::regclass,
            'public.notificaciones'::regclass
          )
        )
      AND array_length(con.conkey, 1) = 1
    ORDER BY con.conrelid::regclass::text, con.conname
  `);

  for (const reference of references.rows) {
    const table = String(reference.table_name);
    const column = String(reference.column_name);

    if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(table) ||
        !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(column)) {
      throw new Error('Identificador de dependencia inesperado');
    }

    const condition = table === 'user_sessions' ||
      table === 'public.user_sessions'
      ? ' AND revocado_en IS NULL AND expira_en > NOW()'
      : '';

    const result = await client.query(
      `SELECT 1 FROM ${table} WHERE "${column}" = $1${condition} LIMIT 1`,
      [userId]
    );

    if (result.rowCount > 0) return true;
  }

  return false;
}

async function removeExpiredPendingClient(client, email) {
  // Debe ejecutarse dentro de la transacción del llamador.
  // Serializa las operaciones de registro que respetan este protocolo.
  await lockRegistrationEmail(client, email);

  const candidate = await findExpiredPendingClient(client, email);

  if (!candidate) {
    return { deleted: false, reason: 'NOT_EXPIRED_OR_NOT_PENDING' };
  }

  const protectedRelations = await hasProtectedRelations(
    client,
    candidate.id
  );

  if (protectedRelations) {
    return { deleted: false, reason: 'PROTECTED_RELATIONS' };
  }

  // Descartar únicamente sesiones vencidas o revocadas
  // de este registro pendiente, dentro de la transacción.
  await client.query(`
    DELETE FROM public.user_sessions
    WHERE usuario_id = $1
      AND (
        revocado_en IS NOT NULL
        OR expira_en <= NOW()
      )
  `, [candidate.id]);

  const result = await client.query(`
    DELETE FROM public.usuarios
    WHERE id = $1
      AND rol = 'CLIENT'
      AND estado = 'PENDING_VERIFICATION'
      AND creado_en <= NOW() - INTERVAL '${EXPIRATION_INTERVAL}'
      AND balance = 0
      AND km_bank_balance = 0
      AND viajes_totales = 0
    RETURNING id
  `, [candidate.id]);

  return {
    deleted: result.rowCount === 1,
    reason: result.rowCount === 1 ? 'EXPIRED_REMOVED' : 'NOT_REMOVED'
  };
}

async function findRegistrationStatus(client, email) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('Se requiere una conexión transaccional');
  }

  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) throw new TypeError('Correo requerido');

  const result = await client.query(`
    SELECT
      estado AS status,
      rol AS role,
      creado_en AS "registeredAt",
      NOW() >= creado_en + INTERVAL '1 hour' AS expired
    FROM public.usuarios
    WHERE lower(email) = $1
    LIMIT 1
  `, [normalized]);

  return result.rows[0] || null;
}

module.exports = {
  lockRegistrationEmail,
  removeExpiredPendingClient,
  findRegistrationStatus
};
