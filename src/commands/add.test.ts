import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)
const cliPath = path.resolve(dirname, '../../bin/cli.js')
const tempDirectories: string[] = []

function createTempDirectory() {
  const directory = mkdtempSync(path.join(tmpdir(), 'supabase-js-cli-'))
  tempDirectories.push(directory)
  return directory
}

function runCli(args: string[], cwd = createTempDirectory()) {
  return {
    cwd,
    result: spawnSync(process.execPath, [cliPath, ...args], {
      cwd,
      encoding: 'utf8',
    }),
  }
}

afterEach(() => {
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})

describe('supabase-js add', () => {
  it('adds every file for the accounts template', () => {
    const { cwd, result } = runCli(['add', 'accounts'])

    expect(result.status).toBe(0)
    expect(readFileSync(path.join(cwd, 'supabase/migrations/20260521101353_accounts.sql'), 'utf8')).toContain('Account owners can view their own avatars')
  })

  it('fails for an unknown template', () => {
    const { result } = runCli(['add', 'missing-template'])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Unknown template')
  })

  it('refuses to overwrite an existing generated file', () => {
    const cwd = createTempDirectory()
    const dirname = path.join(cwd, 'supabase/migrations')
    mkdirSync(dirname, { recursive: true });
    writeFileSync(path.join(dirname, '20260521101353_accounts.sql'), '// existing file\n', {
    })

    const { result } = runCli(['add', 'accounts'], cwd)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Refusing to overwrite existing file: supabase/migrations/20260521101353_accounts.sql')
    expect(readFileSync(path.join(cwd, 'supabase/migrations/20260521101353_accounts.sql'), 'utf8')).toBe('// existing file\n')
  })
})
