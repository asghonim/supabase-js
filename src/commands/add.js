const fs = require('node:fs')
const path = require('node:path')

function getPackageRoot() {
  return path.resolve(__dirname, '../..')
}

function getTemplatesRoot() {
  return path.join(getPackageRoot(), 'templates')
}

function loadManifest() {
  const manifestPath = path.join(getTemplatesRoot(), 'manifest.json')
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
}

function assertRelativeFilePath(filePath, fieldName) {
  const normalizedPath = path.normalize(filePath)

  if (path.isAbsolute(filePath) || normalizedPath === '..' || normalizedPath.startsWith(`..${path.sep}`)) {
    throw new Error(`Invalid ${fieldName} path: ${filePath}`)
  }

  return normalizedPath
}

function copyTemplate(templateName, targetDirectory = process.cwd()) {
  const manifest = loadManifest()
  const template = manifest[templateName]

  if (!template) {
    throw new Error(`Unknown template "${templateName}". Available templates: ${Object.keys(manifest).join(', ')}`)
  }

  const templatesRoot = getTemplatesRoot()
  const plannedCopies = template.files.map((file) => {
    const sourcePath = path.join(templatesRoot, assertRelativeFilePath(file.source, 'source'))
    const destinationPath = path.resolve(targetDirectory, assertRelativeFilePath(file.destination, 'destination'))

    if (!sourcePath.startsWith(templatesRoot + path.sep)) {
      throw new Error(`Template source escapes templates directory: ${file.source}`)
    }

    return {
      sourcePath,
      destinationPath,
      relativeDestination: path.relative(targetDirectory, destinationPath),
    }
  })

  for (const file of plannedCopies) {
    if (!fs.existsSync(file.sourcePath)) {
      throw new Error(`Template file is missing: ${path.relative(templatesRoot, file.sourcePath)}`)
    }

    if (fs.existsSync(file.destinationPath)) {
      throw new Error(`Refusing to overwrite existing file: ${file.relativeDestination}`)
    }
  }

  for (const file of plannedCopies) {
    fs.mkdirSync(path.dirname(file.destinationPath), { recursive: true })
    fs.copyFileSync(file.sourcePath, file.destinationPath)
  }

  return plannedCopies.map((file) => file.relativeDestination)
}

function addCommand(templateName, targetDirectory = process.cwd()) {
  const generatedFiles = copyTemplate(templateName, targetDirectory)

  process.stdout.write(`Added template "${templateName}" to ${targetDirectory}\n`)
  for (const file of generatedFiles) {
    process.stdout.write(`  - ${file}\n`)
  }

  return generatedFiles
}

module.exports = {
  addCommand,
  copyTemplate,
  loadManifest,
}
