const assert = require('assert')
const {chromium} = require('playwright-core')

const baseUrl = process.env.CONSENT_TEST_URL
  || 'https://feat-local-prior-consent--dgs-web.netlify.app'
const routes = ['/history/', '/employment/']
const analyticsHostPattern = /(?:googletagmanager\.com\/gtag|google-analytics\.com)/
const iubendaControlsPattern = /cdn\.iubenda\.com\/cs\/iubenda_cs\.js/
const prohibitedBeforeChoicePattern = /(?:googletagmanager\.com|google-analytics\.com|youtube(?:-nocookie)?\.com|ytimg\.com)/

const waitFor = async (predicate, message) => {
  const deadline = Date.now() + 10000

  while (Date.now() < deadline) {
    if (predicate()) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }

  assert.fail(message)
}

const run = async () => {
  const browser = await chromium.launch({channel: 'chrome', headless: true})
  const context = await browser.newContext()
  const page = await context.newPage()
  const requests = []

  context.on('request', request => requests.push(request.url()))

  try {
    await page.goto(`${baseUrl}/`, {waitUntil: 'domcontentloaded'})
    await page.getByRole('button', {name: 'Allow analytics'}).waitFor()
    await waitFor(
      () => requests.some(url => iubendaControlsPattern.test(url)),
      'Iubenda US privacy controls did not load'
    )
    assert.deepStrictEqual(
      requests.filter(url => prohibitedBeforeChoicePattern.test(url)),
      []
    )
    assert.strictEqual(
      await page.evaluate(() => Array.from(document.scripts).some(script =>
        script.textContent.includes('googleConsentMode: false')
        && script.textContent.includes('uetConsentMode: false')
      )),
      true
    )

    await page.getByRole('button', {name: 'Allow analytics'}).click()
    await waitFor(
      () => requests.some(url => analyticsHostPattern.test(url)),
      'Analytics did not start after acceptance'
    )

    for (const route of routes) {
      const requestCount = requests.filter(url => analyticsHostPattern.test(url)).length
      await page.goto(`${baseUrl}${route}`, {waitUntil: 'domcontentloaded'})
      await waitFor(
        () => requests.filter(url => analyticsHostPattern.test(url)).length > requestCount,
        `Stored acceptance did not restore Analytics on ${route}`
      )
      assert.strictEqual(
        await page.getByRole('button', {name: 'Allow analytics'}).count(),
        0
      )
    }

    const requestCount = requests.filter(url => analyticsHostPattern.test(url)).length
    const secondTab = await context.newPage()
    await secondTab.goto(`${baseUrl}/`, {waitUntil: 'domcontentloaded'})
    await waitFor(
      () => requests.filter(url => analyticsHostPattern.test(url)).length > requestCount,
      'Stored acceptance did not restore Analytics in a second tab'
    )

    console.log('Live local-consent restoration test passed.')
  } finally {
    await context.close()
    await browser.close()
  }
}

run().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
