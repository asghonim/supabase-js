// @ts-check

const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')

function getPackageRoot() {
  return path.resolve(__dirname, '../..')
}

function getTemplatesRoot() {
  return path.join(getPackageRoot(), '.')
}

function loadManifest() {
  const manifestPath = path.join(getPackageRoot(), 'manifest.json')
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
}

function assertRelativeFilePath(filePath, fieldName) {
  const normalizedPath = path.normalize(filePath)

  if (path.isAbsolute(filePath) || normalizedPath === '..' || normalizedPath.startsWith(`..${path.sep}`)) {
    throw new Error(`Invalid ${fieldName} path: ${filePath}`)
  }

  return normalizedPath
}

function isPathWithin(basePath, candidatePath) {
  const relativePath = normalizeForComparison(path.relative(basePath, candidatePath))
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath))
}

function normalizeForComparison(value) {
  return process.platform === 'win32' ? value.toLowerCase() : value
}

function planCopies(templateName, targetDirectory) {
  const manifest = loadManifest()
  const template = manifest[templateName]

  if (!template) {
    throw new Error(`Unknown template "${templateName}". Available templates: ${Object.keys(manifest).join(', ')}`)
  }

  const templatesRoot = getTemplatesRoot()
  const targetRoot = path.resolve(targetDirectory)

  return template.files.map((file) => {
    const sourcePath = path.join(templatesRoot, assertRelativeFilePath(file.source, 'source'))
    const destinationPath = path.resolve(targetDirectory, assertRelativeFilePath(file.destination, 'destination'))

    if (!isPathWithin(targetRoot, destinationPath)) {
      throw new Error(`Template destination escapes target directory: ${file.destination}`)
    }

    return {
      sourcePath,
      destinationPath,
      relativeDestination: path.relative(targetDirectory, destinationPath),
    }
  })
}

function copyTemplate(templateName, targetDirectory = process.cwd(), { overwrite = false } = {}) {
  const templatesRoot = getTemplatesRoot()
  const templatesRootRealPath = normalizeForComparison(fs.realpathSync(templatesRoot))
  const plannedCopies = planCopies(templateName, targetDirectory)

  for (const file of plannedCopies) {
    if (!fs.existsSync(file.sourcePath)) {
      throw new Error(`Template file is missing: ${path.relative(templatesRoot, file.sourcePath)}`)
    }

    const sourceRealPath = normalizeForComparison(fs.realpathSync(file.sourcePath))
    if (!isPathWithin(templatesRootRealPath, sourceRealPath)) {
      throw new Error(`Template source escapes templates directory: ${path.relative(templatesRoot, file.sourcePath)}`)
    }

    if (!overwrite && fs.existsSync(file.destinationPath)) {
      throw new Error(`Refusing to overwrite existing file: ${file.relativeDestination}`)
    }
  }

  for (const file of plannedCopies) {
    const dirname = path.dirname(file.destinationPath)
    fs.mkdirSync(dirname, { recursive: true })
    fs.copyFileSync(file.sourcePath, file.destinationPath)
  }

  return plannedCopies.map((file) => file.relativeDestination)
}

function promptConfirmation(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(`${message} (y/N) `, (answer) => {
      rl.close()
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes')
    })
  })
}

async function addCommand(templateName, targetDirectory = process.cwd(), { confirm = promptConfirmation } = {}) {
  const plannedCopies = planCopies(templateName, targetDirectory)
  const conflicts = plannedCopies.filter((file) => fs.existsSync(file.destinationPath))

  if (conflicts.length > 0) {
    process.stdout.write(`The following files already exist:\n`)
    for (const file of conflicts) {
      process.stdout.write(`  - ${file.relativeDestination}\n`)
    }
    const confirmed = await confirm('Overwrite these files?')
    if (!confirmed) {
      process.stdout.write('Aborted.\n')
      return []
    }
  }

  const generatedFiles = copyTemplate(templateName, targetDirectory, { overwrite: true })

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
