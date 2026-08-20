const fs = require('fs')
const path = require('path')

const outputDirectory = path.resolve(__dirname, '../dist')
const policyUrl = 'https://www.iubenda.com/privacy-policy/35923895'
const noticeAtCollectionUrl = 'https://www.iubenda.com/privacy-policy/35923895/cookie-policy?an=no&amp;s_ck=false&amp;newmarkup=yes'
const usPrivacyRightsUrl = 'https://www.iubenda.com/privacy-policy/35923895/legal?an=no&amp;s_ck=false&amp;newmarkup=yes#privacy_rights_under_us_state_laws'
const iubendaGppUrl = 'https://cdn.iubenda.com/cs/gpp/stub.js'
const iubendaControlsUrl = 'https://cdn.iubenda.com/cs/iubenda_cs.js'
const requiredAssets = [
  'vendor/cookieconsent/cookieconsent.css',
  'vendor/cookieconsent/cookieconsent.umd.js',
  'vendor/iframemanager/iframemanager.css',
  'vendor/iframemanager/iframemanager.js',
  'js/consent.js',
  'images/video-placeholder.svg'
]
const requiredRouteFragments = requiredAssets
  .filter(relativePath => relativePath !== 'images/video-placeholder.svg')
  .map(relativePath => `/${relativePath}`)
  .concat([
  'data-cc="show-preferencesModal"',
  'Analytics Preferences',
  'class="footer__us-privacy-controls"',
  'class="iubenda-cs-uspr-link"',
  'class="iubenda-cs-preferences-link"',
  policyUrl,
  noticeAtCollectionUrl,
  usPrivacyRightsUrl,
  iubendaGppUrl,
  iubendaControlsUrl,
  'googleConsentMode: false',
  'uetConsentMode: false',
  "usprPurposes: 's,sh,adv'",
  "privacyPolicyNoticeAtCollectionUrl: 'https://www.iubenda.com/privacy-policy/35923895/cookie-policy?an=no&s_ck=false&newmarkup=yes'",
  'type="text/plain"',
  'data-category="analytics"',
  'data-src="https://www.googletagmanager.com/gtag/js?id=G-0T1NQBVXXP"'
  ])

const findHtmlFiles = directory => fs.readdirSync(directory, {withFileTypes: true})
  .reduce((files, entry) => {
    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      return files.concat(findHtmlFiles(entryPath))
    }

    return entry.name.endsWith('.html') ? files.concat(entryPath) : files
  }, [])

if (!fs.existsSync(outputDirectory)) {
  throw new Error('Missing dist output. Run npm run production before this audit.')
}

const htmlFiles = findHtmlFiles(outputDirectory)

if (!htmlFiles.length) {
  throw new Error('No generated HTML files found in dist.')
}

const failures = requiredAssets.reduce((results, relativePath) => {
  const assetPath = path.join(outputDirectory, relativePath)
  if (!fs.existsSync(assetPath) || fs.statSync(assetPath).size === 0) {
    results.push(`Missing local consent asset: ${relativePath}`)
  }
  return results
}, [])

htmlFiles.forEach(filePath => {
  const html = fs.readFileSync(filePath, 'utf8')
  const relativePath = path.relative(outputDirectory, filePath)

  requiredRouteFragments.forEach(fragment => {
    if (!html.includes(fragment)) {
      failures.push(`${relativePath}: missing required consent fragment ${fragment}`)
    }
  })

  if (/cs\.iubenda\.com\/(?:sync|autoblocking)\/|embeds\.iubenda\.com\/widgets\//i.test(html)) {
    failures.push(`${relativePath}: Iubenda consent blocking or Consent Mode sync remains`)
  }

  if (/_iub_cs_activate|data-iub-purposes/i.test(html)) {
    failures.push(`${relativePath}: Iubenda still controls a blocked website service`)
  }

  if (/googleConsentMode\s*:\s*(?:true|['"]template['"])|uetConsentMode\s*:\s*true/i.test(html)) {
    failures.push(`${relativePath}: Iubenda consent signals are not explicitly disabled`)
  }

  if (/<script(?![^>]*type=["']text\/plain["'])[^>]+(?:src|data-src)=["'][^"']*(?:googletagmanager\.com|google-analytics\.com)/i.test(html)) {
    failures.push(`${relativePath}: Google Analytics is immediately executable`)
  }

  Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))
    .forEach(([, attributes, body]) => {
      const containsAnalyticsInitializer = /\bgtag\s*\(|\bdataLayer\b/.test(body)
      const isBlockedAnalytics = /type=["']text\/plain["']/.test(attributes)
        && /data-category=["']analytics["']/.test(attributes)

      if (containsAnalyticsInitializer && !isBlockedAnalytics) {
        failures.push(`${relativePath}: Google Analytics initializer is immediately executable`)
      }

      if (containsAnalyticsInitializer && isBlockedAnalytics) {
        const consentDefaultIndex = body.indexOf("gtag('consent', 'default'")
        const consentUpdateIndex = body.indexOf("gtag('consent', 'update'")
        const analyticsConfigIndex = body.indexOf("gtag('config'")
        const hasDeniedConsentDefaults = [
          "'analytics_storage': 'denied'",
          "'ad_storage': 'denied'",
          "'ad_user_data': 'denied'",
          "'ad_personalization': 'denied'"
        ].every(fragment => body.includes(fragment))
        const hasGrantedAnalyticsUpdate = /gtag\('consent', 'update', \{[\s\S]*?'analytics_storage': 'granted'/.test(body)

        if (!hasDeniedConsentDefaults
          || !hasGrantedAnalyticsUpdate
          || consentDefaultIndex === -1
          || consentUpdateIndex < consentDefaultIndex
          || analyticsConfigIndex < consentUpdateIndex) {
          failures.push(`${relativePath}: Google Analytics is missing ordered measurement-only Consent Mode`)
        }
      }
    })

  if (/<iframe[^>]+(?:youtube|ytimg)/i.test(html)) {
    failures.push(`${relativePath}: eager YouTube iframe remains`)
  }

  if (/(?:i[0-9]?\.ytimg\.com|img\.youtube\.com)/i.test(html)) {
    failures.push(`${relativePath}: remote YouTube thumbnail remains`)
  }
})

if (!htmlFiles.some(filePath => {
  const html = fs.readFileSync(filePath, 'utf8')
  return html.includes('data-service="youtube"')
    && html.includes('data-thumbnail="/images/video-placeholder.svg"')
    && !html.includes('<iframe')
})) {
  failures.push('No generated route contains a local, click-to-load YouTube placeholder')
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log(`Local consent audit passed for ${htmlFiles.length} HTML files.`)
}
