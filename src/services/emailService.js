const { Resend } = require('resend');
const env = require('../config/env');
const logger = require('../utils/logger');

const resend = new Resend(env.RESEND_API_KEY);

// ─────────────────────────────────────────────────────────────────────────────
// SHARED TEMPLATE WRAPPER
// ─────────────────────────────────────────────────────────────────────────────

function baseTemplate(title, content) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${title}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
               background: #f4f4f5; margin: 0; padding: 0; }
        .wrapper { max-width: 560px; margin: 40px auto; background: #fff;
                   border-radius: 12px; overflow: hidden;
                   box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
        .header  { background: #6366f1; padding: 32px; text-align: center; }
        .header h1 { color: #fff; margin: 0; font-size: 24px; letter-spacing: -0.5px; }
        .header p  { color: #c7d2fe; margin: 4px 0 0; font-size: 14px; }
        .body    { padding: 32px; color: #374151; line-height: 1.6; }
        .body h2 { margin-top: 0; color: #111827; }
        .btn     { display: inline-block; margin: 24px 0; padding: 14px 32px;
                   background: #6366f1; color: #fff; text-decoration: none;
                   border-radius: 8px; font-weight: 600; font-size: 15px; }
        .code    { display: inline-block; font-size: 32px; font-weight: 700;
                   letter-spacing: 8px; color: #6366f1; margin: 16px 0;
                   padding: 12px 24px; background: #eef2ff; border-radius: 8px; }
        .footer  { padding: 20px 32px; background: #f9fafb; border-top: 1px solid #e5e7eb;
                   font-size: 12px; color: #9ca3af; text-align: center; }
        .divider { height: 1px; background: #e5e7eb; margin: 24px 0; }
      </style>
    </head>
    <body>
      <div class="wrapper">
        <div class="header">
          <h1>CircleSave 💰</h1>
          <p>Digital ROSCA — saving together, growing together</p>
        </div>
        <div class="body">${content}</div>
        <div class="footer">
          © ${new Date().getFullYear()} CircleSave. This email was sent because you have an account with us.<br/>
          If you didn't request this, you can safely ignore it.
        </div>
      </div>
    </body>
    </html>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// SEND HELPER — wraps Resend, never throws (logs on failure)
// ─────────────────────────────────────────────────────────────────────────────

async function sendEmail({ to, subject, html }) {
  try {
    const result = await resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject,
      html,
    });
    logger.info('Email sent', { to, subject, id: result.id });
    return result;
  } catch (err) {
    logger.error('Email send failed', { to, subject, error: err.message });
    // Don't rethrow — email failure must never crash the API response
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL VERIFICATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send a verification email with a 6-digit OTP code.
 * We use a code rather than a magic link so it works easily in Postman/API demos.
 *
 * @param {string} to          - recipient email address
 * @param {string} username    - recipient display name
 * @param {string} code        - 6-digit verification code
 */
async function sendVerificationEmail(to, username, code) {
  const html = baseTemplate(
    'Verify your CircleSave account',
    `
      <h2>Welcome to CircleSave, ${username}! 👋</h2>
      <p>You're almost ready to start saving with your circle. Please verify your email address by entering the code below:</p>
      <div style="text-align:center;">
        <div class="code">${code}</div>
      </div>
      <p style="color:#6b7280; font-size:13px; text-align:center;">
        This code expires in <strong>15 minutes</strong>.
      </p>
      <div class="divider"></div>
      <p style="font-size:13px;">
        Or use this API call:<br/>
        <code>POST /api/v1/auth/verify-email</code><br/>
        Body: <code>{ "email": "${to}", "code": "${code}" }</code>
      </p>
    `
  );

  return sendEmail({
    to,
    subject: `${code} is your CircleSave verification code`,
    html,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PASSWORD RESET
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send a password reset email with a 6-digit OTP code.
 *
 * @param {string} to       - recipient email
 * @param {string} username - display name
 * @param {string} code     - 6-digit reset code
 */
async function sendPasswordResetEmail(to, username, code) {
  const html = baseTemplate(
    'Reset your CircleSave password',
    `
      <h2>Password reset request</h2>
      <p>Hi ${username}, we received a request to reset your CircleSave password.</p>
      <p>Use the code below to reset your password:</p>
      <div style="text-align:center;">
        <div class="code">${code}</div>
      </div>
      <p style="color:#6b7280; font-size:13px; text-align:center;">
        This code expires in <strong>15 minutes</strong>.
      </p>
      <div class="divider"></div>
      <p style="font-size:13px;">
        API call:<br/>
        <code>POST /api/v1/auth/reset-password</code><br/>
        Body: <code>{ "email": "${to}", "code": "${code}", "newPassword": "..." }</code>
      </p>
      <p style="color:#ef4444; font-size:13px;">
        If you didn't request this, your account is safe — just ignore this email.
      </p>
    `
  );

  return sendEmail({
    to,
    subject: 'Reset your CircleSave password',
    html,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// BUSINESS EVENT EMAILS  (3 required by assignment)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Event 1 — Payout released notification
 */
async function sendPayoutReleasedEmail(to, username, { amount, currency, circleName, round }) {
  const html = baseTemplate(
    'Your payout is ready! 🎉',
    `
      <h2>Great news, ${username}! 💸</h2>
      <p>Your payout from <strong>${circleName}</strong> has been released.</p>
      <table style="width:100%; border-collapse:collapse; margin:16px 0;">
        <tr style="background:#f3f4f6;">
          <td style="padding:10px; font-weight:600;">Amount</td>
          <td style="padding:10px; text-align:right; font-size:20px; font-weight:700; color:#6366f1;">
            ${amount.toFixed(2)} ${currency}
          </td>
        </tr>
        <tr>
          <td style="padding:10px; font-weight:600;">Circle</td>
          <td style="padding:10px; text-align:right;">${circleName}</td>
        </tr>
        <tr style="background:#f3f4f6;">
          <td style="padding:10px; font-weight:600;">Round</td>
          <td style="padding:10px; text-align:right;">#${round}</td>
        </tr>
      </table>
      <p>The funds are on their way to your registered account. 🎊</p>
    `
  );

  return sendEmail({ to, subject: `💸 Your ${amount.toFixed(2)} ${currency} payout from ${circleName} is ready!`, html });
}

/**
 * Event 2 — Payment received confirmation
 */
async function sendPaymentConfirmationEmail(to, username, { amount, currency, circleName, round, isPartial, remaining }) {
  const html = baseTemplate(
    'Payment confirmed',
    `
      <h2>Payment ${isPartial ? 'partially ' : ''}received ✓</h2>
      <p>Hi ${username}, we have recorded your payment for <strong>${circleName}</strong>.</p>
      <table style="width:100%; border-collapse:collapse; margin:16px 0;">
        <tr style="background:#f3f4f6;">
          <td style="padding:10px; font-weight:600;">Amount Paid</td>
          <td style="padding:10px; text-align:right; font-weight:700; color:#6366f1;">
            ${amount.toFixed(2)} ${currency}
          </td>
        </tr>
        <tr>
          <td style="padding:10px; font-weight:600;">Round</td>
          <td style="padding:10px; text-align:right;">#${round}</td>
        </tr>
        ${isPartial ? `
        <tr style="background:#fef3c7;">
          <td style="padding:10px; font-weight:600; color:#92400e;">Remaining Balance</td>
          <td style="padding:10px; text-align:right; font-weight:700; color:#92400e;">
            ${remaining.toFixed(2)} ${currency}
          </td>
        </tr>
        ` : ''}
      </table>
      ${isPartial
        ? '<p style="color:#b45309;">⚠️ Please complete your remaining balance before the payout date to avoid late fees.</p>'
        : '<p style="color:#059669;">✅ Your contribution for this round is complete!</p>'
      }
    `
  );

  return sendEmail({ to, subject: `Payment ${isPartial ? 'partial ' : ''}confirmation — ${circleName} Round #${round}`, html });
}

/**
 * Event 3 — Trust score changed alert
 */
async function sendTrustScoreUpdateEmail(to, username, { eventType, delta, scoreAfter, circleName }) {
  const isPositive = delta > 0;
  const emoji = isPositive ? '⬆️' : '⬇️';
  const color = isPositive ? '#059669' : '#dc2626';

  const eventLabels = {
    ON_TIME_PAYMENT: 'On-time payment',
    LATE_PAYMENT: 'Late payment',
    DEFAULT: 'Payment default',
    PARTIAL_PAYMENT: 'Partial payment',
    CIRCLE_COMPLETED: 'Circle completed',
    SWAP_GRANTED: 'Emergency swap granted',
    ORGANIZER_BONUS: 'Organizer bonus',
  };

  const html = baseTemplate(
    'Your trust score changed',
    `
      <h2>${emoji} Trust score update</h2>
      <p>Hi ${username}, your CircleSave trust score has been updated.</p>
      <div style="text-align:center; margin:24px 0;">
        <div style="font-size:48px; font-weight:700; color:${color};">${scoreAfter.toFixed(1)}</div>
        <div style="color:#6b7280; font-size:14px;">New trust score (out of 100)</div>
        <div style="margin-top:8px; font-size:18px; color:${color}; font-weight:600;">
          ${isPositive ? '+' : ''}${delta} points
        </div>
      </div>
      <table style="width:100%; border-collapse:collapse; margin:16px 0;">
        <tr style="background:#f3f4f6;">
          <td style="padding:10px; font-weight:600;">Reason</td>
          <td style="padding:10px; text-align:right;">${eventLabels[eventType] || eventType}</td>
        </tr>
        ${circleName ? `
        <tr>
          <td style="padding:10px; font-weight:600;">Circle</td>
          <td style="padding:10px; text-align:right;">${circleName}</td>
        </tr>
        ` : ''}
      </table>
      <p style="font-size:13px; color:#6b7280;">
        Your trust score affects your ability to join circles and the terms you receive. 
        Keep paying on time to maintain an excellent score!
      </p>
    `
  );

  return sendEmail({ to, subject: `${emoji} Your trust score is now ${scoreAfter.toFixed(1)} — CircleSave`, html });
}

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendPayoutReleasedEmail,
  sendPaymentConfirmationEmail,
  sendTrustScoreUpdateEmail,
};