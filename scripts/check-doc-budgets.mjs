import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(repositoryRoot, 'scripts/doc-budgets.json');
const failures = [];
let budgets = {};

try {
  budgets = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (error) {
  failures.push(`Invalid scripts/doc-budgets.json: ${error.message}`);
}

const results = [];
for (const path of Object.keys(budgets).sort()) {
  const limit = budgets[path];
  if (!Number.isInteger(limit) || limit <= 0) {
    failures.push(`${path} has invalid word budget: ${limit}`);
    continue;
  }

  const absolutePath = resolve(repositoryRoot, path);
  if (!existsSync(absolutePath)) {
    failures.push(`Budgeted document is missing: ${path}`);
    continue;
  }

  const content = readFileSync(absolutePath, 'utf8');
  const words = content.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];
  const count = words.length;
  results.push(`${path}: ${count}/${limit}`);
  if (count > limit) {
    failures.push(`${path} exceeds its word budget: ${count}/${limit}.`);
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Checked ${results.length} documentation budgets.`);
console.log(results.join('\n'));
