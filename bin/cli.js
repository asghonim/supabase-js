#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

function getPackageRoot() {
  return path.resolve(__dirname, '..')
}

function getTemplatesRoot() {
  return path.join(getPackageRoot(), 'templates')
}

function loadManifest() {
  const manifestPath = path.join(getTemplatesRoot(), 'manifest.json')
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
}

function formatTemplateList(manifest) {
  return Object.entries(manifest)
    .map(([name, definition]) => `  - ${name}: ${definition.description}`)
    .join('\n')
}

function printHelp(manifest, stream = process.stdout) {
  const availableTemplates = formatTemplateList(manifest)

  stream.write(`Usage: supabase-js <command> [options]\n\nCommands:\n  add <template>    Copy a source template into the current directory\n\nAvailable templates:\n${availableTemplates}\n`)
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  return 1
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
    throw new Error(`Unknown template \"${templateName}\". Available templates: ${Object.keys(manifest).join(', ')}`)
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

function run(argv = process.argv.slice(2)) {
  const manifest = loadManifest()
  const [command, templateName] = argv

  if (!command || command === '--help' || command === '-h') {
    printHelp(manifest)
    return 0
  }

  if (command !== 'add') {
    return fail(`Unknown command \"${command}\".`)
  }

  if (!templateName) {
    return fail('Template name is required. Usage: supabase-js add <template>')
  }

  try {
    const generatedFiles = copyTemplate(templateName)
    process.stdout.write(`Added template \"${templateName}\" to ${process.cwd()}\n`)
    for (const file of generatedFiles) {
      process.stdout.write(`  - ${file}\n`)
    }
    return 0
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Unexpected error while adding template.')
  }
}

if (require.main === module) {
  process.exitCode = run()
}

module.exports = {
  copyTemplate,
  loadManifest,
  run,
}
