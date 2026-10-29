// Cloudflare Turnstile checks that a person, not a bot, sends a form.
// Without TURNSTILE_SITE_KEY the build uses Cloudflare's test key, which
// always passes.
module.exports = {
  siteKey: process.env.TURNSTILE_SITE_KEY || '1x00000000000000000000AA'
}
