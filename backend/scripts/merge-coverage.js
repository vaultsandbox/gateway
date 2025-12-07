#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const libCoverage = require('istanbul-lib-coverage');
const libReport = require('istanbul-lib-report');
const reports = require('istanbul-reports');

const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.join(projectRoot, 'coverage-merged');

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

function main() {
  ensureDir(outputDir);

  const coverageMap = libCoverage.createCoverageMap({});

  const available = coverageSources.filter(source => fs.existsSync(source.path));

  if (available.length === 0) {
    console.error('❌ No coverage JSON files found. Run "npm run test:cov:all" first.');
    console.error('   Expected files:');
    coverageSources.forEach(source => console.error(`   - ${source.path}`));
    process.exit(1);
  }

  available.forEach(source => {
    const coverage = JSON.parse(fs.readFileSync(source.path, 'utf8'));
    coverageMap.merge(coverage);
    console.log(`• Merged ${source.name} coverage from ${source.path}`);
  });

  const context = libReport.createContext({
    dir: outputDir,
    coverageMap
  });

  console.log('\nGenerating reports...');

  ['html', 'text-summary', 'lcov', 'json-summary'].forEach(reporter => {
    reports.create(reporter).execute(context);
  });

  console.log(`\n✓ Combined coverage report available at ${path.join(outputDir, 'index.html')}`);
}

main();
