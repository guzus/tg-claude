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

  const taskPrompt = `${repoContext}${request}`;

  const escapedPrompt = taskPrompt.replace(/"/g, '\\"').replace(/\n/g, '\\n');

  return `/ralph-loop:ralph-loop "${escapedPrompt}" --max-iterations ${maxIterations} --completion-promise "${completionPromise}"`;
}
