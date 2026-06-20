#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const { Command } = require('commander')
const { installCommand } = require('../src/commands/install.js')

const program = new Command()

program
  .name('@asghonim/supabase-js')
  .description('Template for Supabase JS projects')

  program
  .command('install')
  .description('Copy all migration SQL files without checking the manifest')
  .option('-d, --dir <directory>', 'target directory', process.cwd())
  .action((options) => {
    try {
      installCommand(options.dir)
    } catch (error) {
      program.error(error instanceof Error ? error.message : 'Unexpected error while installing migrations.', {
        exitCode: 1,
      })
    }
  })

program.parse(process.argv)
