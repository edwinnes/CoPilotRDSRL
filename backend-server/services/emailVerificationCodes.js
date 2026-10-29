'use strict';

const crypto = require('node:crypto');

const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

function getPepper() {
  const pepper = process.env.OTP_PEPPER;

  if (!pepper || !/^[a-f0-9]{64}$/i.test(pepper)) {
    throw new Error('OTP_PEPPER no está configurado correctamente');
  }

  return pepper;
}

function generateCode() {
  return crypto.randomInt(0, 1000000)
    .toString()
    .padStart(6, '0');
}

function hashCode(userId, purpose, code) {
  if (!/^\d{6}$/.test(String(code))) {
    throw new Error('Formato de código inválido');
  }

  return crypto
    .createHmac('sha256', getPepper())
    .update(JSON.stringify([userId, purpose, String(code)]))
    .digest('hex');
}

function compareCode(userId, purpose, code, storedHash) {
  if (!/^\d{6}$/.test(String(code))) return false;
  if (!/^[a-f0-9]{64}$/i.test(String(storedHash))) return false;

  const expected = Buffer.from(
    hashCode(userId, purpose, code),
    'hex'
  );

  const actual = Buffer.from(storedHash, 'hex');

  return crypto.timingSafeEqual(expected, actual);
}

module.exports = {
  CODE_TTL_MINUTES,
  MAX_ATTEMPTS,
  generateCode,
  hashCode,
  compareCode,
};
