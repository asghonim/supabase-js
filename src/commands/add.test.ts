import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { addCommand, copyTemplate, loadManifest } from './add.js'

const tempDirectories: string[] = []

function createTempDirectory() {
  const directory = mkdtempSync(path.join(tmpdir(), `supabase-js-cli-${new Date().getTime().toString()}`))
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

describe('add command', () => {
  it('adds every file for the supabase template', () => {
    const cwd = createTempDirectory()
    copyTemplate('supabase', cwd)
    expect(readFileSync(path.join(cwd, 'supabase/migrations/20260000000003_accounts.sql'), 'utf8')).toContain('Account owners can view their own avatars')
  })

  it('fails for an unknown template', () => {
    const cwd = createTempDirectory()
    expect(() => copyTemplate('missing-template', cwd)).toThrow('Unknown template')
  })

  it('refuses to overwrite an existing generated file', () => {
    const cwd = createTempDirectory()
    const dir = path.join(cwd, 'supabase/migrations')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, '20260000000003_accounts.sql'), '// existing file\n')

    expect(() => copyTemplate('supabase', cwd)).toThrow(/^Refusing to overwrite existing file/)
    expect(readFileSync(path.join(cwd, 'supabase/migrations/20260000000003_accounts.sql'), 'utf8')).toBe('// existing file\n')
  })

  it('overwrites existing files when overwrite option is set', () => {
    const cwd = createTempDirectory()
    const dir = path.join(cwd, 'supabase/migrations')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, '20260000000003_accounts.sql'), '// existing file\n')

    copyTemplate('supabase', cwd, { overwrite: true })
    expect(readFileSync(path.join(cwd, 'supabase/migrations/20260000000003_accounts.sql'), 'utf8')).not.toBe('// existing file\n')
  })
})

describe('loadManifest', () => {
  it('returns an object with known template keys', () => {
    const manifest = loadManifest()
    expect(typeof manifest).toBe('object')
    expect(manifest).toHaveProperty('supabase')
  })

  it('supabase template has a non-empty files array', () => {
    const manifest = loadManifest()
    expect(Array.isArray(manifest.supabase.files)).toBe(true)
    expect(manifest.supabase.files.length).toBeGreaterThan(0)
  })
})

describe('addCommand — stdout output', () => {
  it('writes each generated file to stdout on success', async () => {
    const cwd = createTempDirectory()
    const lines: string[] = []
    const origWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk: unknown) => { lines.push(String(chunk)); return true }

    try {
      await addCommand('supabase', cwd, { confirm: async () => { throw new Error('should not prompt') } })
    } finally {
      process.stdout.write = origWrite
    }

    const output = lines.join('')
    expect(output).toContain('Added template')
    expect(output).toContain('supabase')
    expect(output).toMatch(/- /)
  })

  it('writes conflict list and abort message when user declines', async () => {
    const cwd = createTempDirectory()
    const dir = path.join(cwd, 'supabase/migrations')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, '20260000000003_accounts.sql'), '// existing\n')

    const lines: string[] = []
    const origWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk: unknown) => { lines.push(String(chunk)); return true }

    try {
      await addCommand('supabase', cwd, { confirm: async () => false })
    } finally {
      process.stdout.write = origWrite
    }

    const output = lines.join('')
    expect(output).toContain('already exist')
    expect(output).toContain('Aborted')
  })
})

describe('addCommand', () => {
  it('copies files when there are no conflicts', async () => {
    const cwd = createTempDirectory()
    const files = await addCommand('supabase', cwd, { confirm: async () => { throw new Error('should not prompt') } })
    expect(files.length).toBeGreaterThan(0)
    expect(readFileSync(path.join(cwd, 'supabase/migrations/20260000000003_accounts.sql'), 'utf8')).toContain('Account owners can view their own avatars')
  })

  it('prompts and overwrites when user confirms', async () => {
    const cwd = createTempDirectory()
    const dir = path.join(cwd, 'supabase/migrations')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, '20260000000003_accounts.sql'), '// existing file\n')

    const files = await addCommand('supabase', cwd, { confirm: async () => true })
    expect(files.length).toBeGreaterThan(0)
    expect(readFileSync(path.join(cwd, 'supabase/migrations/20260000000003_accounts.sql'), 'utf8')).not.toBe('// existing file\n')
  })

  it('aborts without overwriting when user declines', async () => {
    const cwd = createTempDirectory()
    const dir = path.join(cwd, 'supabase/migrations')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, '20260000000003_accounts.sql'), '// existing file\n')

    const files = await addCommand('supabase', cwd, { confirm: async () => false })
    expect(files).toEqual([])
    expect(readFileSync(path.join(cwd, 'supabase/migrations/20260000000003_accounts.sql'), 'utf8')).toBe('// existing file\n')
  })
})
