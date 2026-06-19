// @ts-check

const fs = require('node:fs')
const path = require('node:path')

function getPackageRoot() {
  return path.resolve(__dirname, '../..')
}

function getMigrationsRoot() {
  return path.join(getPackageRoot(), 'supabase', 'migrations')
}

function planInstallCopies(targetDirectory) {
  const migrationsRoot = getMigrationsRoot()
  const targetRoot = path.resolve(targetDirectory)

  const files = fs.readdirSync(migrationsRoot).filter((f) => f.endsWith('.sql'))

  return files.map((file) => {
    const sourcePath = path.join(migrationsRoot, file)
    const destinationPath = path.join(targetRoot, 'supabase', 'migrations', file)

    return {
      sourcePath,
      destinationPath,
      relativeDestination: path.join('supabase', 'migrations', file),
    }
  })
}

function installCommand(targetDirectory = process.cwd()) {
  const plannedCopies = planInstallCopies(targetDirectory)

  for (const file of plannedCopies) {
    const dirname = path.dirname(file.destinationPath)
    fs.mkdirSync(dirname, { recursive: true })
    fs.copyFileSync(file.sourcePath, file.destinationPath)
  }

  process.stdout.write(`Installed ${plannedCopies.length} migration(s) to ${targetDirectory}\n`)
  for (const file of plannedCopies) {
    process.stdout.write(`  - ${file.relativeDestination}\n`)
  }

  return plannedCopies.map((file) => file.relativeDestination)
}

module.exports = {
  installCommand,
  planInstallCopies,
}
