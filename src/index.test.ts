import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const cliPath = path.resolve(__dirname, '../bin/cli.js')
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

describe('supabase-js CLI', () => {
  it('adds every file for the accounts template', () => {
    const { cwd, result } = runCli(['add', 'accounts'])

    expect(result.status).toBe(0)
    expect(readFileSync(path.join(cwd, 'accounts.ts'), 'utf8')).toContain('createAccountLookup')
    expect(readFileSync(path.join(cwd, 'accounts.types.ts'), 'utf8')).toContain('export interface Account')
  })

  it('fails for an unknown template', () => {
    const { result } = runCli(['add', 'missing-template'])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Unknown template')
  })

  it('refuses to overwrite an existing generated file', () => {
    const cwd = createTempDirectory()
    writeFileSync(path.join(cwd, 'accounts.ts'), '// existing file\n')

    const { result } = runCli(['add', 'accounts'], cwd)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Refusing to overwrite existing file: accounts.ts')
    expect(readFileSync(path.join(cwd, 'accounts.ts'), 'utf8')).toBe('// existing file\n')
  })
})
