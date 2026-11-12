const nodemailer = require('nodemailer');

// Local testing only: send email to a local SMTP inbox such as Mailpit.
// Used only when BOTH are true:
//   1. NETLIFY_DEV is "true". The Netlify CLI sets this only while `netlify dev` runs;
//      the deployed site never has it.
//   2. LOCAL_SMTP_HOST and LOCAL_SMTP_PORT are set (in MNLKingPinLive\.env).
// Otherwise this returns null and the callers use Gmail or Resend exactly as before.
function getLocalSmtpSettings(env = process.env) {
    if (env.NETLIFY_DEV !== 'true' || !env.LOCAL_SMTP_HOST || !env.LOCAL_SMTP_PORT) return null;
    const port = Number(env.LOCAL_SMTP_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return {
        host: String(env.LOCAL_SMTP_HOST),
        port,
        from: env.LOCAL_SMTP_FROM || 'MNL KingPin (local test) <no-reply@kingpin.local>'
    };
}

// Sends one message to the local SMTP inbox. No login and no TLS: Mailpit accepts plain SMTP.
async function sendLocalEmail(settings, message) {
    const transporter = nodemailer.createTransport({
        host: settings.host,
        port: settings.port,
        secure: false,
        ignoreTLS: true
    });
    await transporter.sendMail({ from: settings.from, ...message });
}

module.exports = { getLocalSmtpSettings, sendLocalEmail };
