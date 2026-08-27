import { JSON_SCHEMA, load } from 'js-yaml';

const fullCommitShaPattern = /^[a-f0-9]{40}$/iu;
const immutableDockerReferencePattern =
  /^docker:\/\/[^@\s]+@sha256:[a-f0-9]{64}$/iu;

export function validateWorkflowActionPins(content, path) {
  let workflow;
  try {
    workflow = load(content, { schema: JSON_SCHEMA });
  } catch (error) {
    const location =
      Number.isInteger(error?.mark?.line) &&
      Number.isInteger(error?.mark?.column)
        ? ` at line ${error.mark.line + 1}, column ${error.mark.column + 1}`
        : '';
    return [`Invalid YAML in ${path}${location}.`];
  }

  const actionReferences = [];
  const failures = collectActionReferences(workflow, actionReferences, path);
  for (const rawReference of actionReferences) {
    if (typeof rawReference !== 'string' || rawReference.trim() === '') {
      failures.push(`${path} contains an invalid action reference in uses.`);
      continue;
    }

    const reference = rawReference.trim();
    if (reference.startsWith('./')) {
      continue;
    }
    if (reference.startsWith('docker://')) {
      if (!immutableDockerReferencePattern.test(reference)) {
        failures.push(
          `${path} must pin Docker step actions to an immutable SHA-256 digest.`,
        );
      }
      continue;
    }

    const match = /^([^@\s/]+\/[^@\s]+)@([^@\s]+)$/u.exec(reference);
    if (!match) {
      failures.push(
        `${path} contains an invalid third-party action reference.`,
      );
      continue;
    }

    const [, action, revision] = match;
    if (!fullCommitShaPattern.test(revision)) {
      failures.push(`${path} must pin ${action} to a full commit SHA.`);
    }
  }

  return failures;
}

function collectActionReferences(workflow, output, path) {
  const failures = [];
  if (
    workflow === null ||
    typeof workflow !== 'object' ||
    Array.isArray(workflow)
  ) {
    return [`${path} must contain a workflow mapping.`];
  }

  const jobs = workflow?.jobs;
  if (jobs === null || typeof jobs !== 'object' || Array.isArray(jobs)) {
    return [`${path} must define jobs as a mapping.`];
  }
  if (Object.keys(jobs).length === 0) {
    return [`${path} must define at least one job.`];
  }

  for (const job of Object.values(jobs)) {
    if (job === null || typeof job !== 'object' || Array.isArray(job)) {
      failures.push(`${path} contains an invalid job definition.`);
      continue;
    }

    if (Object.hasOwn(job, 'uses')) {
      output.push(job.uses);
    }
    if (!Object.hasOwn(job, 'steps')) {
      if (!Object.hasOwn(job, 'uses')) {
        failures.push(`${path} contains a job without steps or uses.`);
      }
      continue;
    }
    if (!Array.isArray(job.steps)) {
      failures.push(`${path} contains a job whose steps are not a sequence.`);
      continue;
    }
    for (const step of job.steps) {
      if (step !== null && typeof step === 'object' && !Array.isArray(step)) {
        if (Object.hasOwn(step, 'uses')) {
          output.push(step.uses);
        }
      } else {
        failures.push(`${path} contains an invalid step definition.`);
      }
    }
  }

  return failures;
}
