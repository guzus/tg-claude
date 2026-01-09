import { Repository } from '../types';

export function buildRalphLoopPrompt(params: {
  request: string;
  completionPromise: string;
  maxIterations: number;
  repository?: Repository | null;
}): string {
  const { request, completionPromise, maxIterations, repository } = params;

  const repoContext = repository
    ? `Repository: ${repository.name} (branch: ${repository.branch || 'main'})\n\n`
    : '';

  const taskPrompt = `${repoContext}${request}

ITERATION TRACKING: At the START of each iteration, output: [RALPH_LOOP_ITERATION]

When COMPLETELY done and verified, output: <promise>${completionPromise}</promise>`;

  const escapedPrompt = taskPrompt.replace(/"/g, '\\"').replace(/\n/g, '\\n');

  return `/ralph-loop:ralph-loop "${escapedPrompt}" --max-iterations ${maxIterations} --completion-promise "${completionPromise}"`;
}
