const assert = require('assert')
const {chromium} = require('playwright-core')

const baseUrl = process.env.CONSENT_TEST_URL
  || 'https://feat-iubenda-integration--dgs-web.netlify.app'
const routes = ['/history/', '/employment/']

const readAnalyticsState = page => page.evaluate(() => {
  const scripts = Array.from(document.querySelectorAll(
    'script._iub_cs_activate[data-iub-purposes~="4"]'
  ))
  const preference = window._iub
    && window._iub.cs
    && window._iub.cs.api
    && window._iub.cs.api.getPreferences()

  return {
    path: window.location.pathname,
    types: scripts.map(script => script.type || 'text/javascript'),
    activated: scripts.every(script => (
      script.classList.contains('_iub_cs_activate-activated')
    )),
    bannerVisible: Boolean(document.querySelector('#iubenda-cs-banner')),
    purpose4Allowed: Boolean(
      preference
      && preference.purposes
      && preference.purposes['4'] === true
    ),
    storageKeys: Object.keys(localStorage).sort()
  }
})

const waitForAnalytics = async page => {
  const startedAt = Date.now()
  await page.waitForFunction(() => {
    const scripts = Array.from(document.querySelectorAll(
      'script._iub_cs_activate[data-iub-purposes~="4"]'
    ))

    return scripts.length === 2 && scripts.every(script => (
      script.type !== 'text/plain'
      && script.classList.contains('_iub_cs_activate-activated')
    ))
  }, null, {timeout: 10000})
  return Date.now() - startedAt
}

const run = async () => {
  const browser = await chromium.launch({channel: 'chrome', headless: true})
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    await page.goto(`${baseUrl}/`, {waitUntil: 'domcontentloaded'})
    await page.locator('.iubenda-cs-accept-btn').click({timeout: 10000})
    const homepageActivationMs = await waitForAnalytics(page)
    const homepageState = await readAnalyticsState(page)
    console.log(JSON.stringify({
      ...homepageState,
      activationMs: homepageActivationMs
    }))
    assert.strictEqual(homepageState.bannerVisible, false)
    assert.strictEqual(homepageState.purpose4Allowed, true)

    for (const route of routes) {
      await Promise.all([
        page.waitForURL(`${baseUrl}${route}`),
        page.locator(`a[href$="${route}"]`).first().click()
      ])
      let failure
      let activationMs

      try {
        activationMs = await waitForAnalytics(page)
      } catch (error) {
        failure = error
      }

      const state = await readAnalyticsState(page)
      console.log(JSON.stringify({...state, activationMs}))
      assert.ifError(failure)
      assert.strictEqual(state.bannerVisible, false)
      assert.strictEqual(state.purpose4Allowed, true)
    }

    console.log('Live consent restoration test passed.')
  } finally {
    await context.close()
    await browser.close()
  }
}

run().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
