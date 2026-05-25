#!/usr/bin/env node

const { Command } = require('commander')
const { addCommand, loadManifest } = require('../src/commands/add.js')

const program = new Command()
const manifest = loadManifest()
const availableTemplates = Object.entries(manifest)
  .map(([name, definition]) => `  - ${name}: ${definition.description}`)
  .join('\n')

program
  .name('@asghonim/supabase-js')
  .description('CLI for adding source templates')
  .addHelpText('after', `\nAvailable templates:\n${availableTemplates}\n`)

program
  .command('add')
  .argument('<name>', 'template name')
  .action((name) => {
    try {
      addCommand(name)
    } catch (error) {
      program.error(error instanceof Error ? error.message : 'Unexpected error while adding template.', {
        exitCode: 1,
      })
    }
  })

program.parse(process.argv)
