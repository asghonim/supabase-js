import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)
const cliPath = path.resolve(dirname, 'cli.js')
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
  it('exits 0', () => {
    const { result } = runCli(['install'])
    expect(result.status).toBe(0)
  })
})
