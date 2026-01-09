import { Repository } from '../types';

export function buildRalphLoopPrompt(params: {
  request: string;
  completionPromise: string;
  maxIterations: number;
  repository?: Repository | null;
}): string {
  const { request, completionPromise, maxIterations } = params;

  const escapedPrompt = request.replace(/"/g, '\\"').replace(/\n/g, '\\n');

  return `/ralph-loop:ralph-loop "${escapedPrompt}" --max-iterations ${maxIterations} --completion-promise "${completionPromise}"`;
}
