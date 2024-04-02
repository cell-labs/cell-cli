#!/usr/bin/env node
const { program } = require('commander');
const fs = require('fs').promises;
const { deploy } = require('./deploy');

program
  .command('deploy <path>')
  .description('Deploy a binary file')
  .action(async (path) => {
    try {
      const fileContent = await fs.readFile(path);
      const fileContentHex = fileContent.toString('hex');
      const hexString = '0x' + fileContentHex;
      await deploy(hexString);
    } catch (error) {
      console.error(`Error reading file: ${error.message}`);
    }
  });

program.parse(process.argv);