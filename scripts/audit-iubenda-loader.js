const fs = require('fs')
const path = require('path')

const outputDirectory = path.resolve(__dirname, '../dist')
const iubendaWidget = '<script type="text/javascript" src="https://embeds.iubenda.com/widgets/3e0ad386-3e15-432b-8094-4bca497cbf75.js"></script>'
const requiredFragments = [
  iubendaWidget,
  'class="_iub_cs_activate"',
  'type="text/plain"',
  'data-iub-purposes="4"',
  'https://www.googletagmanager.com/gtag/js?id=G-0T1NQBVXXP',
  "gtag('config', 'G-0T1NQBVXXP')"
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

  if (!contentAfterHead.startsWith(iubendaWidget)) {
    results.push(`${relativePath}: Iubenda widget is not first after <head>`)
  }

  requiredFragments.forEach(fragment => {
    if (!html.includes(fragment)) {
      results.push(`${relativePath}: missing required consent fragment ${fragment}`)
    }
  })

  if (/<script(?![^>]*type=["']text\/plain["'])[^>]+src=["'][^"']*(?:googletagmanager\.com\/gtag|google-analytics\.com)/i.test(html)) {
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
