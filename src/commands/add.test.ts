import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { addCommand, copyTemplate } from './add.js'

const tempDirectories: string[] = []

function createTempDirectory() {
  const directory = mkdtempSync(path.join(tmpdir(), 'supabase-js-cli-'))
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
  it('adds every file for the accounts template', () => {
    const cwd = createTempDirectory()
    copyTemplate('accounts', cwd)
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

    expect(() => copyTemplate('accounts', cwd)).toThrow(/^Refusing to overwrite existing file/)
    expect(readFileSync(path.join(cwd, 'supabase/migrations/20260000000003_accounts.sql'), 'utf8')).toBe('// existing file\n')
  })

  it('overwrites existing files when overwrite option is set', () => {
    const cwd = createTempDirectory()
    const dir = path.join(cwd, 'supabase/migrations')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, '20260000000003_accounts.sql'), '// existing file\n')

    copyTemplate('accounts', cwd, { overwrite: true })
    expect(readFileSync(path.join(cwd, 'supabase/migrations/20260000000003_accounts.sql'), 'utf8')).not.toBe('// existing file\n')
  })
})

describe('addCommand', () => {
  it('copies files when there are no conflicts', async () => {
    const cwd = createTempDirectory()
    const files = await addCommand('accounts', cwd, { confirm: async () => { throw new Error('should not prompt') } })
    expect(files.length).toBeGreaterThan(0)
    expect(readFileSync(path.join(cwd, 'supabase/migrations/20260000000003_accounts.sql'), 'utf8')).toContain('Account owners can view their own avatars')
  })

  it('prompts and overwrites when user confirms', async () => {
    const cwd = createTempDirectory()
    const dir = path.join(cwd, 'supabase/migrations')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, '20260000000003_accounts.sql'), '// existing file\n')

    const files = await addCommand('accounts', cwd, { confirm: async () => true })
    expect(files.length).toBeGreaterThan(0)
    expect(readFileSync(path.join(cwd, 'supabase/migrations/20260000000003_accounts.sql'), 'utf8')).not.toBe('// existing file\n')
  })

  it('aborts without overwriting when user declines', async () => {
    const cwd = createTempDirectory()
    const dir = path.join(cwd, 'supabase/migrations')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, '20260000000003_accounts.sql'), '// existing file\n')

    const files = await addCommand('accounts', cwd, { confirm: async () => false })
    expect(files).toEqual([])
    expect(readFileSync(path.join(cwd, 'supabase/migrations/20260000000003_accounts.sql'), 'utf8')).toBe('// existing file\n')
  })
})
