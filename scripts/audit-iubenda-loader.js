const fs = require('fs')
const path = require('path')

const outputDirectory = path.resolve(__dirname, '../dist')
const iubendaConfigurationStart = '<script type="text/javascript">\nvar _iub = _iub || [];'
const requiredFragments = [
  '"siteId":4606514',
  '"cookiePolicyId":35923895',
  '_iub.csConfiguration.countryDetection = true',
  'delete _iub.csConfiguration.usprApplies',
  '_iub.csConfiguration.showBannerForUS = true',
  '_iub.csConfiguration.perPurposeConsent = true',
  '_iub.csConfiguration.purposes = "1,4"',
  '_iub.csConfiguration.preferenceCookie = {expireAfter: 365}',
  '_iub.csConfiguration.banner.content = "We use Google Analytics to understand how visitors use this site and improve it. Analytics loads only if you allow it. Necessary site features work either way."',
  '_iub.csConfiguration.banner.acceptButtonCaption = "Allow analytics"',
  '_iub.csConfiguration.banner.rejectButtonCaption = "No thanks"',
  '_iub.csConfiguration.banner.customizeButtonCaption = "Privacy choices"',
  "purposes && purposes['4'] === true",
  "script.setAttribute('data-iub-purposes', '4')",
  'https://cs.iubenda.com/autoblocking/4606514.js',
  '//cdn.iubenda.com/cs/gpp/stub.js',
  '//cdn.iubenda.com/cs/iubenda_cs.js'
]

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

const failures = htmlFiles.reduce((results, filePath) => {
  const html = fs.readFileSync(filePath, 'utf8')
  const relativePath = path.relative(outputDirectory, filePath)
  const headStart = html.indexOf('<head>')

  if (headStart === -1) {
    return results.concat(`${relativePath}: missing <head>`)
  }

  const contentAfterHead = html.slice(headStart + '<head>'.length).trimStart()

  if (!contentAfterHead.startsWith(iubendaConfigurationStart)) {
    results.push(`${relativePath}: Iubenda configuration is not first after <head>`)
  }

  requiredFragments.forEach(fragment => {
    if (!html.includes(fragment)) {
      results.push(`${relativePath}: missing required consent fragment ${fragment}`)
    }
  })

  if (/<script[^>]+src=["'][^"']*(?:googletagmanager\.com\/gtag|google-analytics\.com)/i.test(html)) {
    results.push(`${relativePath}: Google Analytics loads before consent`)
  }

  if (/fonts\.(?:googleapis|gstatic)\.com/i.test(html)) {
    results.push(`${relativePath}: Google Fonts is still loaded from Google`)
  }

  if (/youtube\.com\/embed\//i.test(html)) {
    results.push(`${relativePath}: standard YouTube embed domain is still present`)
  }

  return results
}, [])

if (!htmlFiles.some(filePath =>
  fs.readFileSync(filePath, 'utf8').includes('youtube-nocookie.com/embed/')
)) {
  failures.push('No generated route contains a YouTube privacy-enhanced embed')
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log(`Consent and third-party audit passed for ${htmlFiles.length} HTML files.`)
}
