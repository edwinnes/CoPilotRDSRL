'use strict';

const { rateLimit } = require('express-rate-limit');

const commonOptions = {
  windowMs: 15 * 60 * 1000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    error: 'Demasiadas solicitudes. Inténtalo más tarde.'
  }
};

const verifyEmailLimiter = rateLimit({
  ...commonOptions,
  limit: 10
});

const resendVerificationLimiter = rateLimit({
  ...commonOptions,
  limit: 5
});

const loginLimiter = rateLimit({
  ...commonOptions,
  limit: 10
});

const registerLimiter = rateLimit({
  ...commonOptions,
  limit: 5
});

module.exports = {
  verifyEmailLimiter,
  resendVerificationLimiter,
  loginLimiter,
  registerLimiter
};
