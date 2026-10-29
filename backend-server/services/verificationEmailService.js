'use strict';

const { Resend } = require('resend');

const TEST_EMAIL = 'nosotrosrdoficial@gmail.com';
const TEST_FROM = 'CoPilotRD <onboarding@resend.dev>';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

async function sendVerificationEmail({ email, code }) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY no configurada');
  }

  if (!/^\d{6}$/.test(String(code))) {
    throw new Error('Código de verificación inválido');
  }

  if (String(email).trim().toLowerCase() !== TEST_EMAIL) {
    return {
      success: false,
      reason: 'TEST_RECIPIENT_ONLY'
    };
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const safeCode = escapeHtml(code);

  const { data, error } = await resend.emails.send({
    from: TEST_FROM,
    to: [TEST_EMAIL],
    subject: 'CoPilotRD® | Verifica tu correo electrónico',
    html: `
      <div style="background:#f2f6fc;padding:36px 16px;font-family:Arial,sans-serif">
        <div style="max-width:540px;margin:auto;background:#fff;border-radius:18px;overflow:hidden">
          <div style="background:#082b68;padding:30px;text-align:center">
            <div style="font-size:34px;font-weight:bold;color:white">
              CoPilot<span style="color:#5aa8ff">RD®</span>
            </div>
          </div>
          <div style="padding:36px 30px;color:#17345c">
            <h2 style="margin-top:0">¡Bienvenido a CoPilotRD!</h2>
            <p>Gracias por registrarte en nuestra plataforma.</p>
            <p>Utiliza este código para verificar tu correo electrónico:</p>
            <div style="background:#edf5ff;border-radius:12px;padding:22px;text-align:center;
                        font-size:36px;letter-spacing:9px;font-weight:bold;color:#0864d9">
              ${safeCode}
            </div>
            <p style="font-size:14px;color:#596b83">
              Este código vence en <strong>10 minutos</strong>.
              No lo compartas con nadie.
            </p>
            <p>Si no solicitaste esta verificación, puedes ignorar este mensaje.</p>
            <p style="margin-top:32px">
              Cordialmente,<br>
              <strong>Equipo CoPilotRD®</strong>
            </p>
          </div>
        </div>
      </div>
    `
  }, {
    signal: AbortSignal.timeout(10000)
  });

  if (error) {
    return {
      success: false,
      reason: 'EMAIL_PROVIDER_ERROR',
      providerError: error.name || 'UNKNOWN'
    };
  }

  return {
    success: true,
    messageId: data?.id || null
  };
}

module.exports = { sendVerificationEmail };
