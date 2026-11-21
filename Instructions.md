# AssistaBot

## Local setup

1. Install Node.js 24 or newer.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env` and add credentials for the integrations you use.
4. Optionally create local `config/*.json` files to override the safe defaults in `config/*.example.json`.
5. Start the bot with `npm start` (or use `npm run start:all` to start all services).

The config loader reads a local `config/<name>.json` when present, otherwise uses
`config/<name>.example.json` when available, and then applies environment values.
Put account, server, guild, and channel-specific settings in the ignored local files or
environment variables, not in the example files.
Credentials and environment-managed IDs belong only in `.env`; the config loader injects
them at runtime, so they are not duplicated as placeholders in the JSON configs.
YouTube and Kick settings are environment-only, so they do not need separate JSON files.
Personal branding lives in the ignored `config/branding.json`; copy
`config/branding.example.json` and change its values for a new installation. Set
`boosterImage` to a local path under `assets/` or to an HTTPS image URL. Local assets
are ignored by Git as well. Optional local donation audio is set with `donationSound`
and stored under the ignored `sounds/` directory.
Set `ASSISTABOT_TIMEZONE` to your IANA time zone (for example, `UTC`) and
put affiliate tags in `AMAZON_AFFILIATE_TAG` or `WALMART_AFFILIATE_TAG`.
Set `ASSISTABOT_ALERT_PUBLIC_URL` in `.env` to the externally reachable alert-server
URL when using public callbacks or the status page.
The internal alert-server address and listening port are configured with
`ASSISTABOT_LOCALHOST_ALERT_URL` and `ASSISTABOT_ALERT_PORT`; update both if you change the
local port.

The built-in command directory is published at
<https://leashadav.github.io/AssistaBot/commands/>. GitHub Actions publishes it from
`docs/` on pushes to `main` or `master`; enable GitHub Pages with the GitHub Actions
source in the repository settings if it is not already enabled. Custom commands still
vary by server and are not included in the static page.

Runtime state and guild/user data are stored under `data/` and are intentionally not
tracked by Git. Back up that directory separately if you need to preserve it.

## Before publishing or sharing

- Never commit `.env`, real credentials, webhook URLs, or account-specific config.
- `.gitignore` does not stop tracking files already committed. Untrack local config and
  runtime files before publishing, and rotate credentials if they were ever pushed.
- Rotate any credentials that have already been exposed in a public commit; deleting a
  secret from the latest version does not remove it from Git history.
- Keep example files generic and use empty values or placeholders instead of real IDs.
