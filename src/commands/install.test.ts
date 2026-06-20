import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installCommand, planInstallCopies } from './install.js'

const tempDirectories: string[] = []

function createTempDirectory() {
  const directory = mkdtempSync(path.join(tmpdir(), `supabase-install-${Date.now()}`))
  tempDirectories.push(directory)
  return directory
}

afterEach(() => {
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})

describe('planInstallCopies', () => {
  it('returns an entry for every .sql file in the migrations directory', () => {
    const copies = planInstallCopies('/tmp/irrelevant')
    expect(copies.length).toBe(11)
  })

  it('each entry has sourcePath, destinationPath, and relativeDestination', () => {
    const copies = planInstallCopies('/tmp/irrelevant')
    for (const copy of copies) {
      expect(copy.sourcePath).toMatch(/\.sql$/)
      expect(copy.destinationPath).toMatch(/\.sql$/)
      expect(copy.relativeDestination).toMatch(/^supabase[/\\]migrations[/\\]/)
    }
  })

  it('destinations are rooted at the given target directory', () => {
    const target = '/some/target/dir'
    const copies = planInstallCopies(target)
    for (const copy of copies) {
      expect(copy.destinationPath.startsWith(target)).toBe(true)
    }
  })
})

describe('installCommand', () => {
  it('copies all migration files to the target directory', () => {
    const cwd = createTempDirectory()
    installCommand(cwd)

    const migrationsDir = path.join(cwd, 'supabase', 'migrations')
    expect(existsSync(path.join(migrationsDir, '20260000000001_uuid.sql'))).toBe(true)
    expect(existsSync(path.join(migrationsDir, '20260000000003_rbac.sql'))).toBe(true)
    expect(existsSync(path.join(migrationsDir, '20260000000011_contents.sql'))).toBe(true)
  })

  it('creates the destination directory when it does not exist', () => {
    const cwd = createTempDirectory()
    expect(existsSync(path.join(cwd, 'supabase', 'migrations'))).toBe(false)

    installCommand(cwd)

    expect(existsSync(path.join(cwd, 'supabase', 'migrations'))).toBe(true)
  })

  it('copies the correct file contents', () => {
    const cwd = createTempDirectory()
    installCommand(cwd)

    const contents = readFileSync(path.join(cwd, 'supabase', 'migrations', '20260000000001_uuid.sql'), 'utf8')
    expect(contents).toContain('uuid-ossp')
  })

  it('overwrites existing files without prompting', () => {
    const cwd = createTempDirectory()
    const migrationsDir = path.join(cwd, 'supabase', 'migrations')
    mkdirSync(migrationsDir, { recursive: true })
    writeFileSync(path.join(migrationsDir, '20260000000001_uuid.sql'), '-- placeholder\n')

    installCommand(cwd)

    const contents = readFileSync(path.join(migrationsDir, '20260000000001_uuid.sql'), 'utf8')
    expect(contents).not.toBe('-- placeholder\n')
    expect(contents).toContain('uuid-ossp')
  })

  it('returns the list of relative destination paths', () => {
    const cwd = createTempDirectory()
    const files = installCommand(cwd)

    expect(files.length).toBe(11)
    expect(files.every((f) => f.startsWith(path.join('supabase', 'migrations')))).toBe(true)
  })

  it('writes each installed file to stdout', () => {
    const cwd = createTempDirectory()
    const lines: string[] = []
    const origWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk: unknown) => { lines.push(String(chunk)); return true }

    try {
      installCommand(cwd)
    } finally {
      process.stdout.write = origWrite
    }

    const output = lines.join('')
    expect(output).toContain('Installed')
    expect(output).toContain('20260000000001_uuid.sql')
    expect(output).toContain('20260000000011_contents.sql')
  })
})
