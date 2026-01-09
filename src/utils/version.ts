import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export function getVersionHash(): string {
  let commitHash = 'unknown';
  try {
    const versionPaths = ['/app/dist/VERSION', path.join(__dirname, '../VERSION')];
    const versionFile = versionPaths.find(p => fs.existsSync(p));
    if (versionFile) {
      commitHash = fs.readFileSync(versionFile, 'utf-8').trim();
    } else {
      commitHash = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
    }
  } catch {
    // Ignore errors and fall back to "unknown"
  }

  return commitHash;
}
