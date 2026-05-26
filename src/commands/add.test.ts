import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { copyTemplate } from './add.js'

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
    expect(readFileSync(path.join(cwd, 'supabase/migrations/20260521101353_accounts.sql'), 'utf8')).toContain('Account owners can view their own avatars')
  })

  it('fails for an unknown template', () => {
    const cwd = createTempDirectory()
    expect(() => copyTemplate('missing-template', cwd)).toThrow('Unknown template')
  })

  it('refuses to overwrite an existing generated file', () => {
    const cwd = createTempDirectory()
    const dir = path.join(cwd, 'supabase/migrations')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, '20260521101353_accounts.sql'), '// existing file\n')

    expect(() => copyTemplate('accounts', cwd)).toThrow('Refusing to overwrite existing file: supabase/migrations/20260521101353_accounts.sql')
    expect(readFileSync(path.join(cwd, 'supabase/migrations/20260521101353_accounts.sql'), 'utf8')).toBe('// existing file\n')
  })
})
