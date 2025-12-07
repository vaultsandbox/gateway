#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const summaryFile = path.join(__dirname, '../coverage-merged/coverage-summary.json');
const thresholds = {
  statements: 90,
  branches: 80,
  functions: 90,
  lines: 90
};

// Allow override via command line: node check-coverage.js 85
const minThreshold = process.argv[2] ? parseInt(process.argv[2], 10) : null;
if (minThreshold) {
  Object.keys(thresholds).forEach(key => {
    thresholds[key] = minThreshold;
  });
}

if (!fs.existsSync(summaryFile)) {
  console.error(`❌ Coverage summary not found at: ${summaryFile}`);
  console.error('Run "npm run test:cov:all" first to generate coverage report.');
  process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
const total = summary.total;

console.log('\n=== Coverage Threshold Check ===');
console.log(`Minimum thresholds: ${JSON.stringify(thresholds)}`);
console.log();

let failed = false;
const checks = ['statements', 'branches', 'functions', 'lines'];

checks.forEach(metric => {
  const actual = total[metric].pct;
  const required = thresholds[metric];
  const status = actual >= required ? '✓' : '✗';
  const icon = actual >= required ? '✓' : '❌';

  console.log(`${icon} ${metric.padEnd(12)}: ${actual.toFixed(2)}% (required: ${required}%)`);

  if (actual < required) {
    failed = true;
  }
});

console.log();

if (failed) {
  console.error('❌ Coverage check FAILED - some metrics below threshold');
  process.exit(1);
} else {
  console.log('✓ Coverage check PASSED - all metrics meet thresholds');
  process.exit(0);
}
