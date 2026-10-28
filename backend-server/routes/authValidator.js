/**
 * =====================================================================
 * COPILOTRD® / NOSOTROS RD - MÓDULO OFICIAL DE VALIDACIÓN DE AUTENTICACIÓN
 * =====================================================================
 * Provee validación estricta de correo electrónico (RFC 5322), contraseñas,
 * nombres, hashing seguro con crypto.scrypt y validación de cédula dominicana (JCE).
 * =====================================================================
 */

const crypto = require('crypto');

// Regex estricto RFC 5322 para correos electrónicos
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

// Regex para cédula dominicana: 000-0000000-0
const CEDULA_REGEX = /^\d{3}-\d{7}-\d{1}$/;

// Regex para teléfono dominicano (+1 809/829/849 o 10 dígitos)
const DOMINICAN_PHONE_REGEX = /^(?:\+?1[-.\s]?)?(?:809|829|849)[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}$/;

/**
 * Valida y normaliza un correo electrónico de forma estricta.
 * @param {string} email
 * @returns {{ valid: boolean, normalized?: string, error?: string }}
 */
function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'El correo electrónico es requerido.' };
  }

  const normalized = email.trim().toLowerCase();

  // 1. Longitud máxima estándar RFC 5321 (254 caracteres)
  if (normalized.length === 0) {
    return { valid: false, error: 'El correo electrónico no puede estar vacío.' };
  }

  if (normalized.length > 254) {
    return { valid: false, error: 'El correo electrónico excede la longitud máxima permitida (254 caracteres).' };
  }

  // 2. Comprobar que contiene exactamente un símbolo '@' válido
  const parts = normalized.split('@');
  if (parts.length !== 2) {
    return { valid: false, error: 'El correo electrónico debe contener un formato válido con un solo símbolo "@".' };
  }

  const [localPart, domainPart] = parts;

  // 3. Validar parte local (máximo 64 caracteres)
  if (!localPart || localPart.length === 0 || localPart.length > 64) {
    return { valid: false, error: 'La sección de usuario del correo es inválida (máximo 64 caracteres).' };
  }

  // 4. Validar parte de dominio (mínimo 3 caracteres, con punto y TLD de al menos 2 caracteres)
  if (!domainPart || domainPart.length < 3 || domainPart.length > 253) {
    return { valid: false, error: 'El dominio del correo electrónico es inválido.' };
  }

  // No permitir puntos consecutivos
  if (normalized.includes('..')) {
    return { valid: false, error: 'El correo electrónico no puede contener puntos consecutivos.' };
  }

  // 5. Validar TLD (extensión de dominio final de al menos 2 caracteres alfabéticos)
  const domainSegments = domainPart.split('.');
  if (domainSegments.length < 2) {
    return { valid: false, error: 'El dominio del correo debe incluir una extensión válida (ej: .com, .do, .org).' };
  }

  const tld = domainSegments[domainSegments.length - 1];
  if (!tld || tld.length < 2 || !/^[a-z]+$/.test(tld)) {
    return { valid: false, error: 'La extensión de dominio del correo electrónico no es válida.' };
  }

  // 6. Prueba final con expresión regular RFC 5322
  if (!EMAIL_REGEX.test(normalized)) {
    return { valid: false, error: 'El formato del correo electrónico no cumple con los estándares RFC válidos.' };
  }

  return { valid: true, normalized };
}

/**
 * Valida la fortaleza mínima de la contraseña.
 * @param {string} password
 * @returns {{ valid: boolean, error?: string }}
 */
function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'La contraseña es requerida.' };
  }

  if (password.length < 6) {
    return { valid: false, error: 'La contraseña debe tener al menos 6 caracteres.' };
  }

  if (password.length > 128) {
    return { valid: false, error: 'La contraseña no puede exceder los 128 caracteres.' };
  }

  return { valid: true };
}

/**
 * Valida el nombre completo del usuario.
 * @param {string} fullName
 * @returns {{ valid: boolean, normalized?: string, error?: string }}
 */
function validateFullName(fullName) {
  if (!fullName || typeof fullName !== 'string') {
    return { valid: false, error: 'El nombre completo es requerido.' };
  }

  const normalized = fullName.trim();

  if (normalized.length < 2) {
    return { valid: false, error: 'El nombre completo debe tener al menos 2 caracteres.' };
  }

  if (normalized.length > 100) {
    return { valid: false, error: 'El nombre completo no puede exceder los 100 caracteres.' };
  }

  return { valid: true, normalized };
}

/**
 * Valida el formato de Cédula de Identidad y Electoral Dominicana (JCE)
 * con verificación opcional de algoritmo de Luhn (módulo 10).
 * @param {string} cedula
 * @returns {{ valid: boolean, normalized?: string, error?: string, luhnPassed?: boolean }}
 */
function validateDominicanCedula(cedula) {
  if (!cedula || typeof cedula !== 'string') {
    return { valid: false, error: 'La cédula es requerida cuando se proporciona.' };
  }

  const clean = cedula.trim();

  if (!CEDULA_REGEX.test(clean)) {
    return { valid: false, error: 'El formato de cédula dominicana debe ser 000-0000000-0.' };
  }

  // Validación de algoritmo de Luhn dominicano (Módulo 10)
  const digits = clean.replace(/-/g, '');
  if (digits.length !== 11) {
    return { valid: false, error: 'La cédula dominicana debe contener exactamente 11 dígitos numéricos.' };
  }

  const multipliers = [1, 2, 1, 2, 1, 2, 1, 2, 1, 2];
  let sum = 0;

  for (let i = 0; i < 10; i++) {
    let prod = parseInt(digits.charAt(i), 10) * multipliers[i];
    if (prod >= 10) {
      prod = Math.floor(prod / 10) + (prod % 10);
    }
    sum += prod;
  }

  const checkDigit = (10 - (sum % 10)) % 10;
  const luhnPassed = checkDigit === parseInt(digits.charAt(10), 10);

  return { valid: true, normalized: clean, luhnPassed };
}

/**
 * Valida y normaliza un número de teléfono dominicano.
 * @param {string} phone
 * @returns {{ valid: boolean, normalized?: string, error?: string }}
 */
function validateDominicanPhone(phone) {
  if (!phone || typeof phone !== 'string') {
    return { valid: false, error: 'El teléfono es requerido cuando se proporciona.' };
  }

  const clean = phone.trim();
  const digitsOnly = clean.replace(/[^0-9]/g, '');

  // Acepta 10 dígitos (809XXXXXXX) o 11 dígitos (1809XXXXXXX)
  if (digitsOnly.length === 10 && ['809', '829', '849'].includes(digitsOnly.substring(0, 3))) {
    const formatted = `+1 ${digitsOnly.substring(0, 3)}-${digitsOnly.substring(3, 6)}-${digitsOnly.substring(6)}`;
    return { valid: true, normalized: formatted };
  }

  if (digitsOnly.length === 11 && digitsOnly.startsWith('1') && ['809', '829', '849'].includes(digitsOnly.substring(1, 4))) {
    const formatted = `+1 ${digitsOnly.substring(1, 4)}-${digitsOnly.substring(4, 7)}-${digitsOnly.substring(7)}`;
    return { valid: true, normalized: formatted };
  }

  if (DOMINICAN_PHONE_REGEX.test(clean)) {
    return { valid: true, normalized: clean };
  }

  return { valid: false, error: 'El teléfono debe ser un número dominicano válido con código 809, 829 o 849.' };
}

/**
 * Genera un hash criptográfico seguro utilizando crypto.scrypt (estándar OWASP).
 * @param {string} password
 * @returns {string} Hash en formato "salt:derivedKeyHex"
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

/**
 * Verifica una contraseña contra su hash almacenado con protección contra Timing Attacks.
 * @param {string} password
 * @param {string} storedHash
 * @returns {boolean}
 */
function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== 'string' || !storedHash.includes(':')) {
    return false;
  }

  try {
    const [salt, key] = storedHash.split(':');
    const keyBuffer = Buffer.from(key, 'hex');
    const derivedKey = crypto.scryptSync(password, salt, 64);
    return crypto.timingSafeEqual(keyBuffer, derivedKey);
  } catch {
    return false;
  }
}

module.exports = {
  validateEmail,
  validatePassword,
  validateFullName,
  validateDominicanCedula,
  validateDominicanPhone,
  hashPassword,
  verifyPassword,
};
