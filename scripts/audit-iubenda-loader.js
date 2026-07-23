const fs = require('fs')
const path = require('path')

const outputDirectory = path.resolve(__dirname, '../dist')
const iubendaLoader = '<script type="text/javascript" src="https://embeds.iubenda.com/widgets/3e0ad386-3e15-432b-8094-4bca497cbf75.js"></script>'

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
  const headStart = html.indexOf('<head>')

  if (headStart === -1) {
    return results.concat(`${path.relative(outputDirectory, filePath)}: missing <head>`)
  }

  const contentAfterHead = html.slice(headStart + '<head>'.length).trimStart()

  if (!contentAfterHead.startsWith(iubendaLoader)) {
    return results.concat(`${path.relative(outputDirectory, filePath)}: Iubenda loader is not first after <head>`)
  }

  return results
}, [])

if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log(`Iubenda loader audit passed for ${htmlFiles.length} HTML files.`)
}
