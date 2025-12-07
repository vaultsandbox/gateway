#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const nycTempDir = path.join(projectRoot, '.nyc_output_merge');
const outputDir = path.join(projectRoot, 'coverage-merged');
const mergedFile = path.join(nycTempDir, 'merged-coverage.json');

const coverageSources = [
  {
    name: 'unit',
    path: path.join(projectRoot, 'coverage', 'coverage-final.json')
  },
  {
    name: 'e2e',
    path: path.join(projectRoot, 'coverage-e2e', 'coverage-final.json')
  }
];

function ensureDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

function runCommand(command) {
  execSync(command, {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env
  });
}

function copyCoverageFiles() {
  const available = coverageSources.filter(source => fs.existsSync(source.path));

  if (available.length === 0) {
    console.error('❌ No coverage JSON files found. Run "npm run test:cov:all" first.');
    console.error('   Expected files:');
    coverageSources.forEach(source => console.error(`   - ${source.path}`));
    process.exit(1);
  }

  available.forEach(source => {
    const destination = path.join(nycTempDir, `from-${source.name}.json`);
    fs.copyFileSync(source.path, destination);
    console.log(`• Copied ${source.name} coverage -> ${destination}`);
  });
}

function main() {
  ensureDir(nycTempDir);
  ensureDir(outputDir);

  copyCoverageFiles();

  console.log('\nMerging coverage JSON...');
  runCommand(`npx nyc merge "${nycTempDir}" "${mergedFile}"`);

  console.log('Generating reports...');
  runCommand(
    [
      'npx nyc report',
      `--temp-dir="${nycTempDir}"`,
      `--report-dir="${outputDir}"`,
      '--reporter=html',
      '--reporter=text-summary',
      '--reporter=lcov',
      '--reporter=json-summary'
    ].join(' ')
  );

  console.log(`\n✓ Combined coverage report available at ${path.join(outputDir, 'index.html')}`);
}

main();
