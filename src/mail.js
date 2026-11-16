// Optional email. With no SMTP settings the app works fully and simply never
// sends mail. nodemailer is only loaded when SMTP is configured.

export function createMailer(smtp, { log = console } = {}) {
  if (!smtp) return { enabled: false, async send() { return false; } };
  let transport;
  return {
    enabled: true,
    async send({ to, subject, text }) {
      try {
        if (!transport) {
          const { default: nodemailer } = await import('nodemailer');
          transport = nodemailer.createTransport({
            host: smtp.host, port: smtp.port, secure: smtp.secure,
            auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
            requireTLS: !smtp.secure,
          });
        }
        await transport.sendMail({ from: smtp.from, to, subject: subject.replace(/[\r\n]+/g, ' '), text });
        return true;
      } catch (e) {
        log.error(`mail: send failed (${e.code || e.name})`);
        return false;
      }
    },
  };
}

// For tests.
export function memoryMailer() {
  const sent = [];
  return { enabled: true, sent, async send(m) { sent.push(m); return true; } };
}
