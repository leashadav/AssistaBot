require('./configLoader');

const portValue = process.env.ASSISTABOT_ALERT_PORT;
const port = Number(portValue);

if (portValue === undefined || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('ASSISTABOT_ALERT_PORT must be an integer between 1 and 65535.');
}

const baseUrlValue = process.env.ASSISTABOT_LOCALHOST_ALERT_URL;
let parsedBaseUrl;
try {
  parsedBaseUrl = new URL(baseUrlValue);
} catch {
  throw new Error('ASSISTABOT_LOCALHOST_ALERT_URL must be an absolute HTTP or HTTPS URL.');
}

if (!['http:', 'https:'].includes(parsedBaseUrl.protocol) || parsedBaseUrl.username || parsedBaseUrl.password) {
  throw new Error('ASSISTABOT_LOCALHOST_ALERT_URL must be an absolute HTTP or HTTPS URL without credentials.');
}

const baseUrl = baseUrlValue.replace(/\/+$/, '');

module.exports = Object.freeze({ port, baseUrl });
