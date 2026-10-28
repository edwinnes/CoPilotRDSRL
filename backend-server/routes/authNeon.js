'use strict';

const express = require('express');
const router = express.Router();

const {
  validateEmail,
  validatePassword,
  validateFullName,
  validateDominicanCedula,
  validateDominicanPhone,
  hashPassword,
  verifyPassword
} = require('./authValidator');

const { pool } = require('../config/database');

const {
  createClient,
  findByIdentifier
} = require('../repositories/usersNeon');

const {
  createToken,
  verifyToken,
  validateSession,
  issueSession,
  revokeSession
} = require('../repositories/authSessionNeon');

const { query } = require('../config/database');

const USERS_FIELDS = `
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

function errorResponse(res, status, code, message) {
  return res.status(status).json({
    success: false,
    code,
    error: message
  });
}

function extractToken(req) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : '';
}

function handleServerError(res, error) {
  if (error.code === '23505') {
    return errorResponse(
      res, 409, 'USER_ALREADY_EXISTS',
      'Ya existe una cuenta con alguno de los datos proporcionados.'
    );
  }

  console.error('[AUTH_NEON]', {
    code: error.code || 'INTERNAL_ERROR'
  });

  return errorResponse(
    res, 500, 'AUTH_INTERNAL_ERROR',
    'No se pudo completar la operación.'
  );
}

// Google OIDC permanece deshabilitado hasta verificar ID tokens reales.
router.all('/api/v1/auth/google', (req, res) => {
  return errorResponse(
    res, 501, 'GOOGLE_OIDC_NOT_CONFIGURED',
    'Google OIDC todavía no está configurado.'
  );
});

router.post('/api/v1/auth/register', async (req, res) => {
  const body = req.body || {};

  const rawEmail = body.email;
  const rawFullName = body.fullName || body.name;
  const password = body.password;
  const requestedRole = String(body.role || 'CLIENT').toUpperCase();

  if (requestedRole !== 'CLIENT') {
    return errorResponse(
      res, 403, 'ROLE_NOT_ALLOWED',
      'El registro público solamente permite cuentas CLIENT.'
    );
  }

  if (!rawEmail || !rawFullName || !password) {
    return errorResponse(
      res, 400, 'MISSING_FIELDS',
      'Se requieren email, fullName y password.'
    );
  }

  const emailValidation = validateEmail(rawEmail);
  if (!emailValidation.valid) {
    return errorResponse(
      res, 400, 'EMAIL_INVALID_FORMAT',
      emailValidation.error
    );
  }

  const nameValidation = validateFullName(rawFullName);
  if (!nameValidation.valid) {
    return errorResponse(
      res, 400, 'INVALID_NAME',
      nameValidation.error
    );
  }

  const passwordValidation = validatePassword(password);
  if (!passwordValidation.valid) {
    return errorResponse(
      res, 400, 'WEAK_PASSWORD',
      passwordValidation.error
    );
  }

  let phone = null;
  let documentId = null;

  if (body.phone) {
    const result = validateDominicanPhone(body.phone);
    if (!result.valid) {
      return errorResponse(
        res, 400, 'INVALID_PHONE',
        result.error
      );
    }
    phone = result.normalized;
  }

  if (body.documentId || body.cedula) {
    const result = validateDominicanCedula(
      body.documentId || body.cedula
    );

    if (!result.valid) {
      return errorResponse(
        res, 400, 'INVALID_DOCUMENT_ID',
        result.error
      );
    }

    documentId = result.normalized;
  }

  let client;

  try {
    const passwordHash = hashPassword(password);

    client = await pool.connect();
    await client.query('BEGIN');

    const user = await createClient({
      fullName: nameValidation.normalized,
      email: emailValidation.normalized,
      passwordHash,
      phone,
      documentId
    }, client);

    const token = await issueSession(user, 'REGISTER', client);

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      code: 'REGISTRATION_SUCCESS',
      token,
      user,
      message: 'Usuario registrado exitosamente en CoPilotRD.'
    });

  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {}
    }
    return handleServerError(res, error);
  } finally {
    if (client) client.release();
  }
});

router.get('/api/v1/auth/login', (req, res) => {
  return res.json({
    success: true,
    endpoint: '/api/v1/auth/login',
    methods: ['POST'],
    supportedAuthTypes: ['EMAIL_PASSWORD', 'PHONE_PASSWORD'],
    requiredFields: ['email', 'password']
  });
});

router.post('/api/v1/auth/login', async (req, res) => {
  const body = req.body || {};
  const identifier = body.email || body.identifier || body.phone;
  const password = body.password;

  if (typeof identifier !== 'string' ||
      typeof password !== 'string' ||
      !identifier.trim() || !password) {
    return errorResponse(
      res, 400, 'MISSING_FIELDS',
      'Se requieren identificador y contraseña.'
    );
  }

  const role = String(body.role || 'CLIENT').toUpperCase();

  if (role !== 'CLIENT') {
    return errorResponse(
      res, 403, 'ROLE_NOT_ALLOWED',
      'Esta ruta de autenticación corresponde a CLIENT.'
    );
  }

  let normalizedIdentifier = identifier.trim();

  if (normalizedIdentifier.includes('@')) {
    const result = validateEmail(normalizedIdentifier);
    if (!result.valid) {
      return errorResponse(
        res, 400, 'EMAIL_INVALID_FORMAT',
        result.error
      );
    }
    normalizedIdentifier = result.normalized;
  } else {
    const result = validateDominicanPhone(normalizedIdentifier);
    if (!result.valid) {
      return errorResponse(
        res, 400, 'INVALID_PHONE',
        result.error
      );
    }
    normalizedIdentifier = result.normalized;
  }

  try {
    const user = await findByIdentifier(normalizedIdentifier);

    const invalidCredentials = () => errorResponse(
      res, 401, 'INVALID_CREDENTIALS',
      'Credenciales inválidas.'
    );

    if (!user || !user.passwordHash) {
      return invalidCredentials();
    }

    if (!verifyPassword(password, user.passwordHash)) {
      return invalidCredentials();
    }

    if (user.role !== 'CLIENT' ||
        !['ACTIVO', 'PENDING_VERIFICATION'].includes(user.status)) {
      return errorResponse(
        res, 403, 'ACCOUNT_NOT_ALLOWED',
        'La cuenta no está habilitada para iniciar sesión.'
      );
    }

    const token = await issueSession(user, 'PASSWORD');

    const { passwordHash, ...safeUser } = user;

    return res.json({
      success: true,
      code: 'LOGIN_SUCCESS',
      token,
      user: safeUser,
      message: 'Sesión iniciada correctamente en CoPilotRD.'
    });

  } catch (error) {
    return handleServerError(res, error);
  }
});

async function requireAuth(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return errorResponse(
      res, 401, 'MISSING_TOKEN',
      'Se requiere Authorization: Bearer.'
    );
  }

  try {
    const result = await validateSession(token);

    if (!result.valid) {
      return errorResponse(
        res, 401, 'INVALID_SESSION',
        'La sesión es inválida, expiró o fue revocada.'
      );
    }

    req.user = result.user;
    req.userId = result.user.id;
    req.userRole = result.user.role;
    req.authPayload = result.payload;
    req.authToken = token;

    return next();
  } catch (error) {
    return handleServerError(res, error);
  }
}

async function validateTokenHandler(req, res) {
  const token = extractToken(req);

  if (!token) {
    return errorResponse(
      res, 401, 'MISSING_TOKEN',
      'Token no proporcionado.'
    );
  }

  try {
    const result = await validateSession(token);

    if (!result.valid) {
      return errorResponse(
        res, 401, 'INVALID_SESSION',
        'Token inválido o sesión revocada.'
      );
    }

    return res.json({
      success: true,
      valid: true,
      decoded: result.payload,
      user: result.user,
      expiresAt: new Date(result.payload.exp * 1000).toISOString(),
      checkedAt: new Date().toISOString()
    });
  } catch (error) {
    return handleServerError(res, error);
  }
}

router.get('/api/v1/auth/validate-token', validateTokenHandler);
router.post('/api/v1/auth/validate-token', validateTokenHandler);

function meHandler(req, res) {
  return res.json({
    success: true,
    user: req.user,
    session: {
      userId: req.userId,
      role: req.userRole,
      tokenIssuedAt: new Date(
        req.authPayload.iat * 1000
      ).toISOString(),
      tokenExpiresAt: new Date(
        req.authPayload.exp * 1000
      ).toISOString()
    }
  });
}

router.get('/api/v1/auth/me', requireAuth, meHandler);
router.get('/auth/me', requireAuth, meHandler);

router.post('/api/v1/auth/logout', requireAuth, async (req, res) => {
  try {
    await revokeSession(req.authToken);
    return res.json({
      success: true,
      code: 'LOGOUT_SUCCESS'
    });
  } catch (error) {
    return handleServerError(res, error);
  }
});

router.get(
  '/api/v1/auth/audit/anomalous-accounts',
  requireAuth,
  async (req, res) => {
    if (req.userRole !== 'ADMIN') {
      return errorResponse(
        res, 403, 'FORBIDDEN',
        'Se requieren permisos administrativos.'
      );
    }

    try {
      const result = await query(`
        SELECT ${USERS_FIELDS}
        FROM public.usuarios
        WHERE email IS NULL
           OR email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
        ORDER BY creado_en DESC
        LIMIT 100
      `);

      return res.json({
        success: true,
        anomalousCount: result.rows.length,
        anomalousAccounts: result.rows
      });
    } catch (error) {
      return handleServerError(res, error);
    }
  }
);

module.exports = router;
module.exports.verifyToken = verifyToken;
module.exports.requireAuth = requireAuth;
module.exports.createToken = createToken;
