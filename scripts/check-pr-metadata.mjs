const allowedTypes = new Set([
  'feat',
  'fix',
  'docs',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
]);

function parseArguments(argumentsList) {
  const values = {};
  for (let index = 0; index < argumentsList.length; index += 2) {
    const key = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`Invalid argument sequence near ${key ?? '<end>'}.`);
    }
    values[key.slice(2)] = value;
  }
  return values;
}

let argumentsByName;
try {
  argumentsByName = parseArguments(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const title = argumentsByName.title ?? process.env.PR_TITLE ?? '';
const body = argumentsByName.body ?? process.env.PR_BODY ?? '';
const branch = argumentsByName.branch ?? process.env.PR_BRANCH ?? '';
const author = argumentsByName.author ?? process.env.PR_AUTHOR ?? '';
const failures = [];
const titleMatch = title.match(
  /^(feat|fix|docs|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9._/-]+\))?(!)?: .+/u,
);

if (!titleMatch || !allowedTypes.has(titleMatch[1])) {
  failures.push(`Invalid Conventional Commit pull request title: ${title}`);
}

const botAuthor = new Set([
  'app/dependabot',
  'dependabot[bot]',
  'github-actions[bot]',
]).has(author);
const botBranch =
  /^dependabot\/(?:npm|npm_and_yarn|github_actions)\//u.test(branch) ||
  /^release-please--/u.test(branch);

if (botAuthor !== botBranch) {
  failures.push(
    `Bot author and bot branch do not match: ${author} on ${branch}`,
  );
}

if (!botBranch) {
  const branchMatch = branch.match(
    /^(feat|fix|docs|refactor|perf|test|build|ci|chore|revert)\/(?:\d+-)?[a-z0-9]+(?:-[a-z0-9]+)*$/u,
  );
  if (!branchMatch) {
    failures.push(`Invalid task branch name: ${branch}`);
  } else if (titleMatch && branchMatch[1] !== titleMatch[1]) {
    failures.push(
      `Branch type ${branchMatch[1]} does not match pull request type ${titleMatch[1]}.`,
    );
  }

  const bodyWithoutComments = body.replace(/<!--[\s\S]*?-->/gu, '').trim();
  if (bodyWithoutComments.length === 0) {
    failures.push(
      'Pull request body must describe the change and verification.',
    );
  }

  if (titleMatch && ['feat', 'fix'].includes(titleMatch[1])) {
    const closesIssue =
      /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b\s*:?[ \t]+#\d+/iu.test(
        bodyWithoutComments,
      );
    const issueException = /^Issue exception:\s+.{20,}$/imu.test(
      bodyWithoutComments,
    );
    if (!closesIssue && !issueException) {
      failures.push(
        'feat and fix pull requests must close an issue or include a documented Issue exception.',
      );
    }
  }

  const breakingChange =
    Boolean(titleMatch?.[3]) ||
    /^BREAKING CHANGE:/imu.test(bodyWithoutComments);
  if (breakingChange) {
    const migrationSection = bodyWithoutComments.match(
      /## Migration and breaking changes\s+([\s\S]*?)(?=\n## |\nBREAKING CHANGE:|$)/iu,
    )?.[1];
    const migration = migrationSection?.trim();
    if (!migration || /^(?:none\.?|n\/a\.?)$/iu.test(migration)) {
      failures.push(
        'Breaking pull requests must complete ## Migration and breaking changes.',
      );
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Pull request metadata is valid for ${branch}.`);
