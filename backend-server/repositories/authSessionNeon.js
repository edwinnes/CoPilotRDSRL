'use strict';

const crypto = require('node:crypto');
const { findById } = require('./usersNeon');
const {
  findActiveSession,
  createSession,
  revokeSession
} = require('./sessionsNeon');

const ISSUER = 'nosotrosrd-ui-studio';
const TOKEN_LIFETIME_SECONDS = 900;

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function getPrivateKey() {
  if (!process.env.AUTH_PRIVATE_KEY) {
    throw new Error('AUTH_PRIVATE_KEY no configurada');
  }

  return crypto.createPrivateKey(
    process.env.AUTH_PRIVATE_KEY.replace(/\\n/g, '\n')
  );
}

function getPublicKey() {
  if (!process.env.AUTH_PUBLIC_KEY) {
    throw new Error('AUTH_PUBLIC_KEY no configurada');
  }

  return crypto.createPublicKey(
    process.env.AUTH_PUBLIC_KEY.replace(/\\n/g, '\n')
  );
}

function createToken(userId, email, role, provider = 'JWT') {
  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: 'EdDSA',
    typ: 'JWT'
  };

  const payload = {
    sub: userId,
    email,
    role,
    provider,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + TOKEN_LIFETIME_SECONDS,
    iss: ISSUER
  };

  const input = `${encode(header)}.${encode(payload)}`;

  const signature = crypto.sign(
    null,
    Buffer.from(input),
    getPrivateKey()
  ).toString('base64url');

  return `${input}.${signature}`;
}

function verifyToken(token) {
  if (typeof token !== 'string') {
    return { valid: false, error: 'Token inválido' };
  }

  const clean = token.trim().replace(/^Bearer\s+/i, '');
  const parts = clean.split('.');

  if (parts.length !== 3) {
    return { valid: false, error: 'Formato JWT inválido' };
  }

  try {
    const header = JSON.parse(
      Buffer.from(parts[0], 'base64url').toString('utf8')
    );

    if (header.alg !== 'EdDSA' || header.typ !== 'JWT') {
      return { valid: false, error: 'Algoritmo no permitido' };
    }

    const signatureValid = crypto.verify(
      null,
      Buffer.from(`${parts[0]}.${parts[1]}`),
      getPublicKey(),
      Buffer.from(parts[2], 'base64url')
    );

    if (!signatureValid) {
      return { valid: false, error: 'Firma inválida' };
    }

    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8')
    );

    const now = Math.floor(Date.now() / 1000);

    if (
      payload.iss !== ISSUER ||
      typeof payload.sub !== 'string' ||
      !payload.sub ||
      !['CLIENT', 'DRIVER', 'ADMIN'].includes(payload.role) ||
      typeof payload.jti !== 'string' ||
      !Number.isSafeInteger(payload.iat) ||
      !Number.isSafeInteger(payload.exp) ||
      payload.iat > now + 60 ||
      payload.exp <= now ||
      payload.exp <= payload.iat ||
      payload.exp - payload.iat > TOKEN_LIFETIME_SECONDS
    ) {
      return { valid: false, error: 'Claims inválidos' };
    }

    return {
      valid: true,
      payload,
      userId: payload.sub,
      role: payload.role,
      provider: payload.provider
    };
  } catch {
    return { valid: false, error: 'Token inválido' };
  }
}

async function validateSession(token) {
  const verification = verifyToken(token);

  if (!verification.valid) {
    return verification;
  }

  const session = await findActiveSession(token);

  if (!session || session.userId !== verification.userId) {
    return { valid: false, error: 'Sesión inexistente o revocada' };
  }

  const user = await findById(verification.userId);

  if (
    !user ||
    user.role !== verification.role ||
    !['ACTIVO', 'PENDING_VERIFICATION'].includes(user.status)
  ) {
    return { valid: false, error: 'Usuario no autorizado' };
  }

  return {
    ...verification,
    session,
    user
  };
}

async function issueSession(user, provider = 'PASSWORD', client = null) {
  const token = createToken(
    user.id,
    user.email,
    user.role,
    provider
  );

  const verification = verifyToken(token);

  if (!verification.valid) {
    throw new Error('No se pudo validar el token emitido');
  }

  await createSession({
    userId: user.id,
    token,
    expiresAt: new Date(verification.payload.exp * 1000)
  }, client);

  return token;
}

module.exports = {
  createToken,
  verifyToken,
  validateSession,
  issueSession,
  revokeSession
};
