const assert = require('assert')
const fs = require('fs')
const http = require('http')
const path = require('path')
const {chromium} = require('playwright-core')

const outputDirectory = path.resolve(__dirname, '../dist')
const analyticsHostPattern = /(?:googletagmanager\.com\/gtag|google-analytics\.com)/
const googleFontsHostPattern = /fonts\.(?:googleapis|gstatic)\.com/

const contentTypes = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml'
}

const iubendaStub = `
(function() {
  function deleteAnalyticsCookies() {
    document.cookie.split(';').forEach(function(cookie) {
      var name = cookie.split('=')[0].trim();
      if (name === '_ga' || name.indexOf('_ga_') === 0) {
        document.cookie = name + '=; Max-Age=0; Path=/; SameSite=Lax';
      }
    });
  }

  function activateMeasurement() {
    localStorage.setItem('dgs-iubenda-test-preference', 'accepted');
    window['ga-disable-G-0T1NQBVXXP'] = false;
    document.querySelectorAll('script._iub_cs_activate[type="text/plain"][data-iub-purposes="4"]')
      .forEach(function(blockedScript) {
        var script = document.createElement('script');
        if (blockedScript.src) {
          script.src = blockedScript.src;
          script.async = false;
        } else {
          script.text = blockedScript.textContent;
        }
        blockedScript.replaceWith(script);
      });
  }

  function rejectMeasurement() {
    localStorage.setItem('dgs-iubenda-test-preference', 'rejected');
    window['ga-disable-G-0T1NQBVXXP'] = true;
    deleteAnalyticsCookies();
  }

  function addButton(label, onClick) {
    var button = document.createElement('button');
    button.textContent = label;
    button.addEventListener('click', onClick);
    document.body.appendChild(button);
  }

  function initialize() {
    var mode = new URL(window.location.href).searchParams.get('cmp');
    var storedPreference = localStorage.getItem('dgs-iubenda-test-preference');

    if (mode === 'unknown') {
      return;
    }

    addButton('Privacy choices', function() {
      rejectMeasurement();
    });

    if (storedPreference === 'accepted') {
      activateMeasurement();
      return;
    }

    addButton('Accept', activateMeasurement);
    addButton('Reject', rejectMeasurement);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }
}());
`

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

  page.on('request', request => requests.push(request.url()))
  await page.route('**/*', async route => {
    const requestUrl = route.request().url()

    if (requestUrl.startsWith(baseUrl)) {
      await route.continue()
    } else if (requestUrl.includes('embeds.iubenda.com/widgets/3e0ad386-3e15-432b-8094-4bca497cbf75.js')) {
      await route.fulfill({contentType: 'application/javascript', body: iubendaStub})
    } else if (/iubenda\.com/.test(requestUrl)) {
      await route.fulfill({contentType: 'application/javascript', body: ''})
    } else if (requestUrl.includes('googletagmanager.com/gtag/js')) {
      await route.fulfill({contentType: 'application/javascript', body: googleAnalyticsStub})
    } else if (requestUrl.includes('google-analytics.com/g/collect')) {
      await route.fulfill({status: 204, body: ''})
    } else if (requestUrl.includes('youtube-nocookie.com/embed/')) {
      await route.fulfill({contentType: 'text/html', body: '<!doctype html><title>YouTube</title>'})
    } else if (requestUrl.includes('cdn.sanity.io/images/')) {
      await route.fulfill({contentType: 'image/png', body: onePixelPng})
    } else {
      await route.abort()
    }
  })

  return {context, page, requests}
}

const analyticsRequests = requests => requests.filter(url => analyticsHostPattern.test(url))

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
    await untouched.page.getByRole('button', {name: 'Accept'}).waitFor()
    assert.strictEqual(analyticsRequests(untouched.requests).length, 0)
    await untouched.context.close()

    const rejected = await createPage(browser, baseUrl)
    await rejected.page.goto(`${baseUrl}/`)
    await rejected.page.getByRole('button', {name: 'Reject'}).click()
    assert.strictEqual(analyticsRequests(rejected.requests).length, 0)
    await rejected.context.close()

    const accepted = await createPage(browser, baseUrl)
    await accepted.page.goto(`${baseUrl}/`)
    const acceptedUrl = accepted.page.url()
    await accepted.page.getByRole('button', {name: 'Accept'}).click()
    await waitFor(
      () => analyticsRequests(accepted.requests).length >= 2,
      'GA library and collection requests did not start after acceptance'
    )
    assert.strictEqual(accepted.page.url(), acceptedUrl)

    const analyticsRequestCount = analyticsRequests(accepted.requests).length
    await accepted.page.reload()
    await waitFor(
      () => analyticsRequests(accepted.requests).length > analyticsRequestCount,
      'Stored acceptance did not restore Analytics on revisit'
    )
    assert.strictEqual(
      await accepted.page.getByRole('button', {name: 'Accept'}).count(),
      0
    )

    await accepted.context.addCookies([
      {name: '_ga', value: 'test', url: baseUrl},
      {name: '_ga_G_0T1NQBVXXP', value: 'test', url: baseUrl}
    ])
    await accepted.page.getByRole('button', {name: 'Privacy choices'}).click()
    const countAtWithdrawal = analyticsRequests(accepted.requests).length
    await accepted.page.evaluate(() => window.gtag('event', 'after_withdrawal'))
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.strictEqual(analyticsRequests(accepted.requests).length, countAtWithdrawal)
    assert.deepStrictEqual(
      (await accepted.context.cookies()).filter(cookie => cookie.name === '_ga' || cookie.name.indexOf('_ga_') === 0),
      []
    )
    await accepted.context.close()

    const failed = await createPage(browser, baseUrl)
    await failed.page.route('**/embeds.iubenda.com/widgets/3e0ad386-3e15-432b-8094-4bca497cbf75.js', route => route.abort())
    await failed.page.goto(`${baseUrl}/`)
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.strictEqual(analyticsRequests(failed.requests).length, 0)
    await failed.context.close()

    const unknown = await createPage(browser, baseUrl)
    await unknown.page.goto(`${baseUrl}/?cmp=unknown`)
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.strictEqual(analyticsRequests(unknown.requests).length, 0)
    await unknown.context.close()

    const content = await createPage(browser, baseUrl)
    await content.page.goto(`${baseUrl}/employment/`)
    await waitFor(
      () => content.requests.some(url => url.includes('youtube-nocookie.com/embed/')),
      'YouTube privacy-enhanced embed did not load'
    )
    assert(content.requests.some(url => url.includes('cdn.sanity.io/images/')))
    assert.strictEqual(content.requests.filter(url => googleFontsHostPattern.test(url)).length, 0)
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
