'use strict';

const express = require('express');
const { query } = require('../config/database');

const router = express.Router();

router.get(['/api/v1/sdui/auth', '/api/v1/sdui/neon/auth'], async (req, res) => {
  const role = String(req.query.role || 'CLIENT').toUpperCase();

  if (role !== 'CLIENT') {
    return res.status(400).json({
      success: false,
      code: 'INVALID_ROLE',
      error: 'Rol no admitido'
    });
  }

  try {
    const result = await query(
      `SELECT version, schema_json
       FROM public.sdui_screens
       WHERE screen_key = $1
         AND role = $2
         AND is_active = TRUE
       ORDER BY version DESC
       LIMIT 1`,
      ['AUTH', role]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        code: 'SDUI_NOT_ACTIVE',
        error: 'No existe un esquema SDUI activo'
      });
    }

    return res.status(200).json({
      success: true,
      version: result.rows[0].version,
      schema: result.rows[0].schema_json
    });
  } catch (error) {
    console.error('[SDUI NEON]', error.code || error.message);

    return res.status(503).json({
      success: false,
      code: 'SDUI_DATABASE_ERROR',
      error: 'Servicio SDUI temporalmente no disponible'
    });
  }
});

module.exports = router;
