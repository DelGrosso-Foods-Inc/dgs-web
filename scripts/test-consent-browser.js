const assert = require('assert')
const fs = require('fs')
const http = require('http')
const path = require('path')
const {chromium} = require('playwright-core')

const outputDirectory = path.resolve(__dirname, '../dist')
const policyUrl = 'https://www.iubenda.com/privacy-policy/35923895'
const analyticsHostPattern = /(?:googletagmanager\.com\/gtag|google-analytics\.com)/
const googleFontsHostPattern = /fonts\.(?:googleapis|gstatic)\.com/
const prohibitedBeforeChoicePattern = /(?:iubenda\.com|googletagmanager\.com|google-analytics\.com|youtube(?:-nocookie)?\.com|ytimg\.com)/

const contentTypes = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml'
}

const googleAnalyticsStub = `
(function() {
  window.dataLayer = window.dataLayer || [];
  var originalPush = window.dataLayer.push.bind(window.dataLayer);
  window.dataLayer.push = function(value) {
    var result = originalPush(value);
    if (!window['ga-disable-G-0T1NQBVXXP']) {
      fetch('https://www.google-analytics.com/g/collect?v=2&tid=G-0T1NQBVXXP', {
        mode: 'no-cors'
      });
    }
    return result;
  };
  if (window.dataLayer.length && !window['ga-disable-G-0T1NQBVXXP']) {
    fetch('https://www.google-analytics.com/g/collect?v=2&tid=G-0T1NQBVXXP', {
      mode: 'no-cors'
    });
  }
}());
`

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=',
  'base64'
)

const waitFor = async (predicate, message) => {
  const deadline = Date.now() + 3000

  while (Date.now() < deadline) {
    if (predicate()) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 25))
  }

  assert.fail(message)
}

const createServer = () => http.createServer((request, response) => {
  const requestPath = new URL(request.url, 'http://localhost').pathname
  const relativePath = requestPath.endsWith('/')
    ? requestPath.replace(/^\/+/, '') + 'index.html'
    : requestPath.replace(/^\/+/, '')
  const filePath = path.resolve(outputDirectory, relativePath)

  if (!filePath.startsWith(outputDirectory) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.writeHead(404)
    response.end('Not found')
    return
  }

  response.writeHead(200, {
    'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream'
  })
  fs.createReadStream(filePath).pipe(response)
})

const createPage = async (browser, baseUrl) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  const requests = []

  context.on('request', request => requests.push(request.url()))
  await context.route('**/*', async route => {
    const requestUrl = route.request().url()

    if (requestUrl.startsWith(baseUrl)) {
      await route.continue()
    } else if (requestUrl.includes('googletagmanager.com/gtag/js')) {
      await route.fulfill({contentType: 'application/javascript', body: googleAnalyticsStub})
    } else if (requestUrl.includes('google-analytics.com/g/collect')) {
      await route.fulfill({status: 204, body: ''})
    } else if (requestUrl.includes('youtube-nocookie.com/embed/')) {
      await route.fulfill({contentType: 'text/html', body: '<!doctype html><title>YouTube</title>'})
    } else if (requestUrl.includes('cdn.sanity.io/images/')) {
      await route.fulfill({contentType: 'image/png', body: onePixelPng})
    } else if (requestUrl.startsWith(policyUrl)) {
      await route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Privacy Policy</title>'})
    } else {
      await route.abort()
    }
  })

  return {context, page, requests}
}

const analyticsRequests = requests => requests.filter(url => analyticsHostPattern.test(url))

const colorChannel = value => {
  const normalized = value / 255
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4)
}

const relativeLuminance = color => {
  const channels = color.match(/\d+(?:\.\d+)?/g).slice(0, 3).map(Number)
  return (0.2126 * colorChannel(channels[0]))
    + (0.7152 * colorChannel(channels[1]))
    + (0.0722 * colorChannel(channels[2]))
}

const contrastRatio = (foreground, background) => {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background))
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

const run = async () => {
  if (!fs.existsSync(path.join(outputDirectory, 'index.html'))) {
    throw new Error('Missing dist output. Run npm run production before this test.')
  }

  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const browser = await chromium.launch({channel: 'chrome', headless: true})

  try {
    const untouched = await createPage(browser, baseUrl)
    await untouched.page.goto(`${baseUrl}/`)
    await untouched.page.getByRole('button', {name: 'Allow analytics'}).waitFor()
    await untouched.page.getByRole('button', {name: 'Reject analytics'}).waitFor()
    await untouched.page.getByRole('button', {name: 'Manage preferences'}).waitFor()
    await untouched.page.getByText('Analytics stays off unless you allow it.').waitFor()
    const consentModal = untouched.page.getByRole('dialog')
    assert((await consentModal.getAttribute('class')).includes('cm--bar'))
    const allowBox = await untouched.page.getByRole('button', {name: 'Allow analytics'}).boundingBox()
    const rejectBox = await untouched.page.getByRole('button', {name: 'Reject analytics'}).boundingBox()
    assert(Math.abs(allowBox.width - rejectBox.width) < 1)
    for (const buttonName of ['Allow analytics', 'Reject analytics', 'Manage preferences']) {
      const buttonColors = await untouched.page.getByRole('button', {name: buttonName}).evaluate(element => {
        const style = window.getComputedStyle(element)
        return {background: style.backgroundColor, foreground: style.color}
      })
      assert(
        contrastRatio(buttonColors.foreground, buttonColors.background) >= 4.5,
        `${buttonName} does not meet WCAG AA text contrast`
      )
    }
    const modalTextColors = await consentModal.evaluate(element => {
      const background = window.getComputedStyle(element).backgroundColor
      const foreground = window.getComputedStyle(element.querySelector('.cm__desc')).color
      return {background, foreground}
    })
    assert(
      contrastRatio(modalTextColors.foreground, modalTextColors.background) >= 4.5,
      'Consent description does not meet WCAG AA text contrast'
    )
    const policyLinkColors = await consentModal.getByRole('link', {name: 'Privacy Policy'})
      .evaluate(element => {
        const background = window.getComputedStyle(element.closest('.cm__footer')).backgroundColor
        const foreground = window.getComputedStyle(element).color
        return {background, foreground}
      })
    assert(
      contrastRatio(policyLinkColors.foreground, policyLinkColors.background) >= 4.5,
      'Privacy Policy link does not meet WCAG AA text contrast'
    )
    assert.strictEqual(
      await untouched.page.getByRole('link', {name: 'Privacy Policy'}).first().getAttribute('href'),
      policyUrl
    )
    assert.deepStrictEqual(
      untouched.requests.filter(url => prohibitedBeforeChoicePattern.test(url)),
      []
    )
    await Promise.all([
      untouched.page.waitForURL(`${baseUrl}/history/`),
      untouched.page.getByRole('link', {name: 'History'}).first().click()
    ])
    await untouched.page.getByRole('button', {name: 'Allow analytics'}).waitFor()
    await untouched.page.goto(`${baseUrl}/`)
    await untouched.page.getByRole('button', {name: 'Manage preferences'}).click()
    const necessaryToggle = untouched.page.getByRole('checkbox', {name: 'Essential'})
    assert.strictEqual(await necessaryToggle.isChecked(), true)
    assert.strictEqual(await necessaryToggle.isDisabled(), true)
    assert.strictEqual(
      await untouched.page.getByRole('checkbox', {name: 'Analytics'}).isChecked(),
      false
    )
    await untouched.page.getByRole('button', {name: 'Close privacy settings'}).click()
    await untouched.page.getByRole('button', {name: 'Allow analytics'}).waitFor()
    const policyPagePromise = untouched.context.waitForEvent('page')
    await untouched.page.getByRole('link', {name: 'Privacy Policy'}).first().click()
    const policyPage = await policyPagePromise
    await policyPage.waitForURL(policyUrl)
    assert(untouched.requests.includes(policyUrl))
    await policyPage.close()
    await untouched.context.close()

    const rejected = await createPage(browser, baseUrl)
    await rejected.page.goto(`${baseUrl}/`)
    await rejected.page.getByRole('button', {name: 'Reject analytics'}).click()
    await rejected.page.getByRole('dialog').waitFor({state: 'detached'})
    assert.strictEqual(analyticsRequests(rejected.requests).length, 0)
    const rejectedConsentCookie = (await rejected.context.cookies())
      .find(cookie => cookie.name === 'dgs_cookie_consent')
    assert(rejectedConsentCookie)
    const retentionDays = (rejectedConsentCookie.expires - (Date.now() / 1000)) / 86400
    assert(retentionDays > 179 && retentionDays <= 180)
    await rejected.page.reload()
    assert.strictEqual(
      await rejected.page.getByRole('button', {name: 'Reject analytics'}).count(),
      0
    )
    await rejected.page.goto(`${baseUrl}/history/`)
    assert.strictEqual(analyticsRequests(rejected.requests).length, 0)
    const rejectedTab = await rejected.context.newPage()
    await rejectedTab.goto(`${baseUrl}/employment/`)
    assert.strictEqual(analyticsRequests(rejected.requests).length, 0)
    assert.strictEqual(
      await rejectedTab.getByRole('button', {name: 'Reject analytics'}).count(),
      0
    )
    await rejected.context.close()

    const accepted = await createPage(browser, baseUrl)
    await accepted.page.goto(`${baseUrl}/`)
    const acceptedUrl = accepted.page.url()
    let navigationsAfterAcceptance = 0
    accepted.page.on('framenavigated', frame => {
      if (frame === accepted.page.mainFrame()) {
        navigationsAfterAcceptance += 1
      }
    })
    await accepted.page.getByRole('button', {name: 'Allow analytics'}).click()
    await waitFor(
      () => analyticsRequests(accepted.requests).length >= 2,
      'GA library and collection requests did not start after acceptance'
    )
    assert.deepStrictEqual(
      await accepted.page.evaluate(() => window.dataLayer
        .filter(entry => entry[0] === 'consent')
        .map(entry => [entry[0], entry[1], entry[2]])),
      [
        ['consent', 'default', {
          analytics_storage: 'denied',
          ad_storage: 'denied',
          ad_user_data: 'denied',
          ad_personalization: 'denied'
        }],
        ['consent', 'update', {
          analytics_storage: 'granted',
          ad_storage: 'denied',
          ad_user_data: 'denied',
          ad_personalization: 'denied'
        }]
      ]
    )
    assert.strictEqual(accepted.page.url(), acceptedUrl)
    assert.strictEqual(navigationsAfterAcceptance, 0)

    const analyticsRequestCount = analyticsRequests(accepted.requests).length
    await accepted.page.reload()
    await waitFor(
      () => analyticsRequests(accepted.requests).length > analyticsRequestCount,
      'Stored acceptance did not restore Analytics on revisit'
    )
    assert.strictEqual(
      await accepted.page.getByRole('button', {name: 'Allow analytics'}).count(),
      0
    )

    for (const route of ['/history/', '/employment/']) {
      const requestCountBeforeNavigation = analyticsRequests(accepted.requests).length
      await accepted.page.goto(`${baseUrl}${route}`)
      await waitFor(
        () => analyticsRequests(accepted.requests).length > requestCountBeforeNavigation,
        `Stored acceptance did not restore Analytics on ${route}`
      )
      assert.strictEqual(
        await accepted.page.getByRole('button', {name: 'Allow analytics'}).count(),
        0
      )
    }

    const acceptedTabRequestCount = analyticsRequests(accepted.requests).length
    const acceptedTab = await accepted.context.newPage()
    await acceptedTab.goto(`${baseUrl}/`)
    await waitFor(
      () => analyticsRequests(accepted.requests).length > acceptedTabRequestCount,
      'Stored acceptance did not restore Analytics in a second tab'
    )
    const acceptedConsentCookie = (await accepted.context.cookies())
      .find(cookie => cookie.name === 'dgs_cookie_consent')
    assert(acceptedConsentCookie)

    await accepted.context.addCookies([
      {name: '_ga', value: 'test', url: baseUrl},
      {name: '_ga_G_0T1NQBVXXP', value: 'test', url: baseUrl}
    ])
    await accepted.page.getByRole('button', {name: 'Privacy Settings'}).click()
    const analyticsToggle = accepted.page.getByRole('checkbox', {name: 'Analytics'})
    assert.strictEqual(await analyticsToggle.isChecked(), true)
    await analyticsToggle.click()
    const countAtWithdrawal = analyticsRequests(accepted.requests).length
    await Promise.all([
      accepted.page.waitForNavigation({waitUntil: 'domcontentloaded'}),
      accepted.page.getByRole('button', {name: 'Save preferences'}).click()
    ])
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.strictEqual(analyticsRequests(accepted.requests).length, countAtWithdrawal)
    assert.deepStrictEqual(
      (await accepted.context.cookies()).filter(cookie => cookie.name === '_ga' || cookie.name.indexOf('_ga_') === 0),
      []
    )
    await accepted.context.close()

    const corrupted = await createPage(browser, baseUrl)
    await corrupted.context.addCookies([
      {name: 'dgs_cookie_consent', value: 'not-a-valid-preference', url: baseUrl}
    ])
    await corrupted.page.goto(`${baseUrl}/`)
    await corrupted.page.getByRole('button', {name: 'Allow analytics'}).waitFor()
    assert.strictEqual(analyticsRequests(corrupted.requests).length, 0)
    await corrupted.context.close()

    const expired = await createPage(browser, baseUrl)
    const expiredPreference = JSON.parse(decodeURIComponent(rejectedConsentCookie.value))
    expiredPreference.expirationTime = Date.now() - 1000
    await expired.context.addCookies([{
      name: 'dgs_cookie_consent',
      value: encodeURIComponent(JSON.stringify(expiredPreference)),
      url: baseUrl,
      expires: Math.floor(Date.now() / 1000) - 60
    }])
    await expired.page.goto(`${baseUrl}/`)
    await expired.page.getByRole('button', {name: 'Allow analytics'}).waitFor()
    assert.strictEqual(analyticsRequests(expired.requests).length, 0)
    await expired.context.close()

    const unknown = await createPage(browser, baseUrl)
    const unknownPreference = JSON.parse(decodeURIComponent(acceptedConsentCookie.value))
    unknownPreference.categories.push('unknown')
    unknownPreference.services.unknown = []
    await unknown.context.addCookies([{
      name: 'dgs_cookie_consent',
      value: encodeURIComponent(JSON.stringify(unknownPreference)),
      url: baseUrl
    }])
    await unknown.page.goto(`${baseUrl}/`)
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.strictEqual(analyticsRequests(unknown.requests).length, 0)
    await unknown.context.close()

    const oldRevision = await createPage(browser, baseUrl)
    const oldRevisionPreference = JSON.parse(decodeURIComponent(acceptedConsentCookie.value))
    oldRevisionPreference.revision = 0
    await oldRevision.context.addCookies([{
      name: 'dgs_cookie_consent',
      value: encodeURIComponent(JSON.stringify(oldRevisionPreference)),
      url: baseUrl
    }])
    await oldRevision.page.goto(`${baseUrl}/`)
    await oldRevision.page.getByRole('button', {name: 'Allow analytics'}).waitFor()
    assert.strictEqual(analyticsRequests(oldRevision.requests).length, 0)
    await oldRevision.context.close()

    const missingServices = await createPage(browser, baseUrl)
    const missingServicesPreference = JSON.parse(decodeURIComponent(acceptedConsentCookie.value))
    delete missingServicesPreference.services
    await missingServices.context.addCookies([{
      name: 'dgs_cookie_consent',
      value: encodeURIComponent(JSON.stringify(missingServicesPreference)),
      url: baseUrl
    }])
    await missingServices.page.goto(`${baseUrl}/`)
    await missingServices.page.getByRole('button', {name: 'Allow analytics'}).waitFor()
    assert.strictEqual(analyticsRequests(missingServices.requests).length, 0)
    await missingServices.context.close()

    const malformedTimestamps = await createPage(browser, baseUrl)
    const malformedTimestampsPreference = JSON.parse(decodeURIComponent(acceptedConsentCookie.value))
    malformedTimestampsPreference.consentTimestamp = 'not-a-date'
    malformedTimestampsPreference.lastConsentTimestamp = 'also-not-a-date'
    await malformedTimestamps.context.addCookies([{
      name: 'dgs_cookie_consent',
      value: encodeURIComponent(JSON.stringify(malformedTimestampsPreference)),
      url: baseUrl
    }])
    await malformedTimestamps.page.goto(`${baseUrl}/`)
    await malformedTimestamps.page.getByRole('button', {name: 'Allow analytics'}).waitFor()
    assert.strictEqual(analyticsRequests(malformedTimestamps.requests).length, 0)
    await malformedTimestamps.context.close()

    const nonIsoTimestamp = await createPage(browser, baseUrl)
    const nonIsoTimestampPreference = JSON.parse(decodeURIComponent(acceptedConsentCookie.value))
    nonIsoTimestampPreference.consentTimestamp = 'July 1, 2026'
    await nonIsoTimestamp.context.addCookies([{
      name: 'dgs_cookie_consent',
      value: encodeURIComponent(JSON.stringify(nonIsoTimestampPreference)),
      url: baseUrl
    }])
    await nonIsoTimestamp.page.goto(`${baseUrl}/`)
    await nonIsoTimestamp.page.getByRole('button', {name: 'Allow analytics'}).waitFor()
    assert.strictEqual(analyticsRequests(nonIsoTimestamp.requests).length, 0)
    await nonIsoTimestamp.context.close()

    const failed = await createPage(browser, baseUrl)
    await failed.context.route('**/vendor/cookieconsent/cookieconsent.umd.js', route => route.abort())
    await failed.page.goto(`${baseUrl}/`)
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.strictEqual(analyticsRequests(failed.requests).length, 0)
    await failed.context.close()

    const content = await createPage(browser, baseUrl)
    await content.page.goto(`${baseUrl}/employment/`)
    const loadVideoButton = content.page.getByRole('button', {name: 'Load video'}).first()
    await loadVideoButton.waitFor()
    await loadVideoButton.scrollIntoViewIfNeeded()
    assert.strictEqual(
      content.requests.filter(url => /youtube|ytimg/.test(url)).length,
      0
    )
    await waitFor(
      () => content.requests.some(url => url.includes('/images/video-placeholder.svg')),
      'Local video placeholder asset did not load'
    )
    assert(content.requests.some(url => url.includes('cdn.sanity.io/images/')))
    await loadVideoButton.click()
    await waitFor(
      () => content.requests.some(url => url.includes('youtube-nocookie.com/embed/')),
      'Selected YouTube embed did not load after explicit interaction'
    )
    assert.strictEqual(
      content.requests.filter(url => url.includes('youtube-nocookie.com/embed/')).length,
      1
    )
    const youtubeRequestsAfterClick = content.requests.filter(url => /youtube|ytimg/.test(url)).length
    await content.page.reload()
    await content.page.getByRole('button', {name: 'Load video'}).waitFor()
    assert.strictEqual(
      content.requests.filter(url => /youtube|ytimg/.test(url)).length,
      youtubeRequestsAfterClick
    )
    assert.strictEqual(content.requests.filter(url => googleFontsHostPattern.test(url)).length, 0)
    await content.page.goto(`${baseUrl}/contact/`)
    const contactForm = content.page.locator('form[action="/.netlify/functions/contact"]')
    await contactForm.getByLabel('First Name *').fill('Test')
    await contactForm.getByLabel('Last Name *').fill('Visitor')
    await contactForm.getByLabel('Email *').fill('visitor@example.com')
    await contactForm.getByLabel('Message / Feedback / Question *').fill('Consent-independent form test.')
    const formRequestPromise = content.page.waitForRequest(request => (
      request.method() === 'POST'
      && request.url() === `${baseUrl}/.netlify/functions/contact`
    ))
    await contactForm.getByRole('button', {name: 'Submit'}).click()
    const formRequest = await formRequestPromise
    assert.strictEqual(new URL(formRequest.url()).origin, baseUrl)
    assert.strictEqual(analyticsRequests(content.requests).length, 0)
    await content.context.close()
  } finally {
    await browser.close()
    await new Promise(resolve => server.close(resolve))
  }

  console.log('Consent browser acceptance test passed.')
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
