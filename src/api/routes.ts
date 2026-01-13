import { Router, Request, Response } from 'express';
import { Repository, TaskStatus, StreamEvent, AIProvider, GLM_MODEL_MAPPINGS, OPENROUTER_MODEL_MAPPINGS, UserConfig } from '../types';
import { ClaudeExecutorInstance } from '../services/IClaudeExecutor';
import { RepositoryManager } from '../services/RepositoryManager';
import { UserConfigManager } from '../services/UserConfigManager';
import { AuditLogger } from '../services/AuditLogger';
import { gitService } from '../services/GitService';
import { logger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { parseSlashCommand } from './slashCommands';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

/**
 * Compute effective model names based on provider and user config
 */
function getEffectiveModels(provider: AIProvider, config: UserConfig): { haiku: string; sonnet: string; opus: string } {
  const ai = config.aiProvider;

  if (provider === 'glm') {
    return {
      haiku: ai?.haikuModel || GLM_MODEL_MAPPINGS.haiku,
      sonnet: ai?.sonnetModel || GLM_MODEL_MAPPINGS.sonnet,
      opus: ai?.opusModel || GLM_MODEL_MAPPINGS.opus,
    };
  }

  if (provider === 'openrouter') {
    return {
      haiku: ai?.haikuModel || OPENROUTER_MODEL_MAPPINGS.haiku,
      sonnet: ai?.sonnetModel || OPENROUTER_MODEL_MAPPINGS.sonnet,
      opus: ai?.opusModel || OPENROUTER_MODEL_MAPPINGS.opus,
    };
  }

  // Anthropic: show Claude Code's internal slot names
  return { haiku: 'haiku', sonnet: 'sonnet', opus: 'opus' };
}

async function buildFileTree(dirPath: string, relativePath: string = ''): Promise<FileNode[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const nodes: FileNode[] = [];

  // Sort: directories first, then files, both alphabetically
  const sorted = entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of sorted) {
    // Skip hidden files and common ignored directories
    if (entry.name.startsWith('.') ||
        entry.name === 'node_modules' ||
        entry.name === '__pycache__' ||
        entry.name === 'dist' ||
        entry.name === 'build' ||
        entry.name === '.git') {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);
    const nodeRelativePath = path.join(relativePath, entry.name);

    if (entry.isDirectory()) {
      const children = await buildFileTree(fullPath, nodeRelativePath);
      nodes.push({
        name: entry.name,
        path: nodeRelativePath,
        type: 'directory',
        children
      });
    } else {
      nodes.push({
        name: entry.name,
        path: nodeRelativePath,
        type: 'file'
      });
    }
  }

  return nodes;
}

export function createApiRoutes(
  executor: ClaudeExecutorInstance,
  repositoryManager: RepositoryManager,
  userConfigManager: UserConfigManager,
  auditLogger: AuditLogger
): Router {
  const router = Router();

  // Enable CORS for frontend
  router.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
  });

  // Parse JSON bodies
  router.use((req, res, next) => {
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // ============ TASKS ============

  // Get all tasks (including completed)
  router.get('/tasks', (req: Request, res: Response) => {
    try {
      const userId = req.query.userId ? parseInt(req.query.userId as string, 10) : undefined;
      const tasks = executor.getAllTasks();

      const filteredTasks = userId
        ? tasks.filter(t => t.userId === userId)
        : tasks;

      // Sort by start time descending (newest first)
      filteredTasks.sort((a: { startTime: Date }, b: { startTime: Date }) =>
        new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
      );

      res.json(filteredTasks);
    } catch (error) {
      logger.error('API: Failed to get tasks', { error: getErrorMessage(error) });
      res.status(500).json({ error: 'Failed to get tasks' });
    }
  });

  // Get single task
  router.get('/tasks/:taskId', (req: Request, res: Response) => {
    try {
      const { taskId } = req.params;
      const task = executor.getTask(taskId);

      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }

      res.json(task);
    } catch (error) {
      logger.error('API: Failed to get task', { error: getErrorMessage(error) });
      res.status(500).json({ error: 'Failed to get task' });
    }
  });

  // Create new task
  router.post('/tasks', async (req: Request, res: Response) => {
    try {
      const { prompt, workingDir, userId, resumeSessionId, newSession, images } = req.body;

      if (!prompt || !workingDir || !userId) {
        return res.status(400).json({ error: 'Missing required fields: prompt, workingDir, userId' });
      }

      const userConfig = await userConfigManager.getConfig(userId);

      // Parse slash commands
      const parsedCommand = parseSlashCommand(prompt);
      const effectivePrompt = parsedCommand?.prompt || prompt;
      const extraOptions = parsedCommand?.options || {};

      if (parsedCommand) {
        logger.info('Parsed slash command', {
          command: parsedCommand.command,
          prompt: parsedCommand.prompt,
          options: parsedCommand.options
        });
      }

      const task = executor.startTask(userId, userId, effectivePrompt, {
        workingDir,
        aiProvider: userConfig.aiProvider,
        resumeSessionId,
        newSession,
        images,
        ...extraOptions
      });

      res.json({ id: task.id, status: 'started', sessionId: task.sessionId });
    } catch (error) {
      logger.error('API: Failed to create task', { error: getErrorMessage(error) });
      res.status(500).json({ error: 'Failed to create task' });
    }
  });

  // Cancel task
  router.delete('/tasks/:taskId', async (req: Request, res: Response) => {
    try {
      const { taskId } = req.params;
      const cancelled = await executor.cancelTask(taskId);

      if (!cancelled) {
        return res.status(404).json({ error: 'Task not found or already completed' });
      }

      res.json({ success: true });
    } catch (error) {
      logger.error('API: Failed to cancel task', { error: getErrorMessage(error) });
      res.status(500).json({ error: 'Failed to cancel task' });
    }
  });

  // Stream task events via SSE
  router.get('/tasks/:taskId/stream', (req: Request, res: Response) => {
    const { taskId } = req.params;
    const task = executor.getTask(taskId);

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    // Send events to client
    const sendEvent = (event: StreamEvent | Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // Send current task state
    sendEvent({
      type: 'init',
      task: {
        id: task.id,
        status: task.status,
        prompt: task.prompt,
        startTime: task.startTime,
        endTime: task.endTime,
        actions: task.actions || [],
        events: task.events || [],
        currentAction: task.currentAction,
        costUsd: task.costUsd
      }
    });

    // If task is already completed, send complete event and close
    if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.FAILED ||
        task.status === TaskStatus.CANCELLED || task.status === TaskStatus.TIMEOUT) {
      const completedEvent = task.events?.find(e => e.type === 'completed');
      if (completedEvent) {
        sendEvent(completedEvent);
      }
      sendEvent({ type: 'stream_end' });
      res.end();
      return;
    }

    // Listen for stream events
    const handleStreamEvent = (eventTaskId: string, event: StreamEvent) => {
      if (eventTaskId === taskId) {
        sendEvent(event);

        // End stream when task completes
        if (event.type === 'completed') {
          sendEvent({ type: 'stream_end' });
          cleanup();
        }
      }
    };

    // Listen for task completion/error
    const handleTaskComplete = (completedTaskId: string) => {
      if (completedTaskId === taskId) {
        sendEvent({ type: 'stream_end' });
        cleanup();
      }
    };

    const handleTaskError = (errorTaskId: string) => {
      if (errorTaskId === taskId) {
        sendEvent({ type: 'stream_end' });
        cleanup();
      }
    };

    const cleanup = () => {
      executor.off('streamEvent', handleStreamEvent);
      executor.off('taskComplete', handleTaskComplete);
      executor.off('taskError', handleTaskError);
      res.end();
    };

    executor.on('streamEvent', handleStreamEvent);
    executor.on('taskComplete', handleTaskComplete);
    executor.on('taskError', handleTaskError);

    // Clean up on client disconnect
    req.on('close', cleanup);
  });

  // ============ REPOSITORIES ============

  // Get repositories for user
  router.get('/repositories', async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.query.userId as string, 10);

      if (!userId) {
        return res.status(400).json({ error: 'Missing userId query parameter' });
      }

      const repos = await repositoryManager.listRepositories(userId);
      res.json(repos);
    } catch (error) {
      logger.error('API: Failed to get repositories', { error: getErrorMessage(error) });
      res.status(500).json({ error: 'Failed to get repositories' });
    }
  });

  // Create/clone repository
  router.post('/repositories', async (req: Request, res: Response) => {
    try {
      const { userId, name, gitUrl, branch, type, createGithub, isPrivate } = req.body;

      if (!userId) {
        return res.status(400).json({ error: 'Missing userId' });
      }

      let repo: Repository;

      if (type === 'clone' && gitUrl) {
        repo = await repositoryManager.cloneRepository(userId, gitUrl, name, branch);
      } else if (name) {
        repo = await repositoryManager.createRepository(userId, name);

        // If createGithub flag is set, create a GitHub repository
        if (createGithub) {
          try {
            // Get user config for git settings
            const userConfig = await userConfigManager.getConfig(userId);
            const gitUserName = userConfig.git?.userName || 'tg-claude';
            const gitUserEmail = userConfig.git?.userEmail || 'claude-code@remote.machine';

            // Configure git user
            await execAsync(`git config user.name "${gitUserName}"`, { cwd: repo.path, timeout: 5000 });
            await execAsync(`git config user.email "${gitUserEmail}"`, { cwd: repo.path, timeout: 5000 });

            // Create initial commit if needed
            await execAsync('git add . || true', { cwd: repo.path, timeout: 5000 });
            await execAsync('git commit -m "Initial commit" --allow-empty', { cwd: repo.path, timeout: 5000 });

            // Create GitHub repository
            const result = await gitService.createGitHubRepository(repo.path, isPrivate === true);

            if (result === 'success') {
              // Refresh repository info to get the new gitUrl
              repo = await repositoryManager.refreshRepository(userId, repo.id);
              logger.info('Created GitHub repository', { repoId: repo.id, name: repo.name });
            } else if (result === 'already_exists') {
              logger.warn('GitHub repository already exists', { name: repo.name });
            } else {
              logger.error('Failed to create GitHub repository', { name: repo.name });
            }
          } catch (ghError) {
            // Don't fail the whole operation if GitHub creation fails
            logger.error('GitHub repository creation error', { error: getErrorMessage(ghError) });
          }
        }
      } else {
        return res.status(400).json({ error: 'Missing name or gitUrl' });
      }

      res.json(repo);
    } catch (error) {
      logger.error('API: Failed to create repository', { error: getErrorMessage(error) });
      res.status(500).json({ error: 'Failed to create repository' });
    }
  });

  // Switch repository
  router.post('/repositories/:repoId/switch', async (req: Request, res: Response) => {
    try {
      const { repoId } = req.params;
      const { userId } = req.body;

      if (!userId) {
        return res.status(400).json({ error: 'Missing userId' });
      }

      await repositoryManager.switchRepository(userId, repoId);
      res.json({ success: true });
    } catch (error) {
      logger.error('API: Failed to switch repository', { error: getErrorMessage(error) });
      res.status(500).json({ error: 'Failed to switch repository' });
    }
  });

  // Get file content (text)
  router.get('/repositories/:repoId/file', async (req: Request, res: Response) => {
    try {
      const { repoId } = req.params;
      const userId = parseInt(req.query.userId as string, 10);
      const filePath = req.query.path as string;

      if (!userId) {
        return res.status(400).json({ error: 'Missing userId query parameter' });
      }

      if (!filePath) {
        return res.status(400).json({ error: 'Missing path query parameter' });
      }

      const repos = await repositoryManager.listRepositories(userId);
      const repo = repos.find(r => r.id === repoId);

      if (!repo) {
        return res.status(404).json({ error: 'Repository not found' });
      }

      const fullPath = path.join(repo.path, filePath);

      // Security check: ensure path is within repo
      if (!fullPath.startsWith(repo.path)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const content = await fs.readFile(fullPath, 'utf-8');
      res.json({ content, path: filePath });
    } catch (error) {
      logger.error('API: Failed to get file content', { error: getErrorMessage(error) });
      res.status(500).json({ error: 'Failed to get file content' });
    }
  });

  // Get raw file (binary support for images, PDFs, etc.)
  router.get('/repositories/:repoId/file/raw', async (req: Request, res: Response) => {
    try {
      const { repoId } = req.params;
      const userId = parseInt(req.query.userId as string, 10);
      const filePath = req.query.path as string;

      if (!userId) {
        return res.status(400).json({ error: 'Missing userId query parameter' });
      }

      if (!filePath) {
        return res.status(400).json({ error: 'Missing path query parameter' });
      }

      const repos = await repositoryManager.listRepositories(userId);
      const repo = repos.find(r => r.id === repoId);

      if (!repo) {
        return res.status(404).json({ error: 'Repository not found' });
      }

      const fullPath = path.join(repo.path, filePath);

      // Security check: ensure path is within repo
      const normalizedRepoPath = path.normalize(repo.path);
      const normalizedFullPath = path.normalize(fullPath);
      if (!normalizedFullPath.startsWith(normalizedRepoPath)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Determine content type from extension
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.pdf': 'application/pdf',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
      };

      const contentType = mimeTypes[ext] || 'application/octet-stream';
      const fileBuffer = await fs.readFile(fullPath);

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', fileBuffer.length);
      res.send(fileBuffer);
    } catch (error) {
      logger.error('API: Failed to get raw file', { error: getErrorMessage(error) });
      res.status(500).json({ error: 'Failed to get file' });
    }
  });

  // Save file content
  router.put('/repositories/:repoId/file', async (req: Request, res: Response) => {
    try {
      const { repoId } = req.params;
      const { userId, path: filePath, content } = req.body;

      if (!userId) {
        return res.status(400).json({ error: 'Missing userId' });
      }

      if (!filePath) {
        return res.status(400).json({ error: 'Missing path' });
      }

      if (content === undefined) {
        return res.status(400).json({ error: 'Missing content' });
      }

      const repos = await repositoryManager.listRepositories(userId);
      const repo = repos.find(r => r.id === repoId);

      if (!repo) {
        return res.status(404).json({ error: 'Repository not found' });
      }

      const fullPath = path.join(repo.path, filePath);

      // Security check: ensure path is within repo
      const normalizedRepoPath = path.normalize(repo.path);
      const normalizedFullPath = path.normalize(fullPath);
      if (!normalizedFullPath.startsWith(normalizedRepoPath)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Ensure directory exists
      await fs.mkdir(path.dirname(fullPath), { recursive: true });

      // Write file
      await fs.writeFile(fullPath, content, 'utf-8');

      logger.info('API: File saved', { repoId, filePath, userId });
      res.json({ success: true, path: filePath });
    } catch (error) {
      logger.error('API: Failed to save file content', { error: getErrorMessage(error) });
      res.status(500).json({ error: 'Failed to save file content' });
    }
  });

  // Get file tree for repository
  router.get('/repositories/:repoId/files', async (req: Request, res: Response) => {
    try {
      const { repoId } = req.params;
      const userId = parseInt(req.query.userId as string, 10);

      if (!userId) {
        return res.status(400).json({ error: 'Missing userId query parameter' });
      }

      const repos = await repositoryManager.listRepositories(userId);
      const repo = repos.find(r => r.id === repoId);

      if (!repo) {
        return res.status(404).json({ error: 'Repository not found' });
      }

      const tree = await buildFileTree(repo.path);
      res.json(tree);
    } catch (error) {
      logger.error('API: Failed to get file tree', { error: getErrorMessage(error) });
      res.status(500).json({ error: 'Failed to get file tree' });
    }
  });

  // ============ GIT HISTORY ============

  // Get git commits for repository
  router.get('/repositories/:repoId/commits', async (req: Request, res: Response) => {
    try {
      const { repoId } = req.params;
      const userId = parseInt(req.query.userId as string, 10);
      const limit = parseInt(req.query.limit as string, 10) || 50;

      if (!userId) {
        return res.status(400).json({ error: 'Missing userId query parameter' });
      }

      const repos = await repositoryManager.listRepositories(userId);
      const repo = repos.find(r => r.id === repoId);

      if (!repo) {
        return res.status(404).json({ error: 'Repository not found' });
      }

      // Get commits with git log
      const { stdout } = await execAsync(
        `git log --oneline -n ${limit} --format="%H|%h|%s|%an|%ae|%aI|%D"`,
        { cwd: repo.path, timeout: 10000 }
      );

      const commits = stdout.trim().split('\n').filter(Boolean).map(line => {
        const [sha, shortSha, subject, authorName, authorEmail, date, refs] = line.split('|');
        return {
          sha,
          shortSha,
          subject,
          author: { name: authorName, email: authorEmail },
          date,
          refs: refs ? refs.split(', ').filter(Boolean) : []
        };
      });

      res.json(commits);
    } catch (error) {
      logger.error('API: Failed to get commits', { error: getErrorMessage(error) });
      res.status(500).json({ error: 'Failed to get commits' });
    }
  });

  // Get diff for a specific commit
  router.get('/repositories/:repoId/commits/:sha/diff', async (req: Request, res: Response) => {
    try {
      const { repoId, sha } = req.params;
      const userId = parseInt(req.query.userId as string, 10);

      if (!userId) {
        return res.status(400).json({ error: 'Missing userId query parameter' });
      }

      const repos = await repositoryManager.listRepositories(userId);
      const repo = repos.find(r => r.id === repoId);

      if (!repo) {
        return res.status(404).json({ error: 'Repository not found' });
      }

      // Sanitize sha to prevent command injection
      if (!/^[a-f0-9]+$/i.test(sha)) {
        return res.status(400).json({ error: 'Invalid commit SHA' });
      }

      // Get diff for the commit (comparing with parent)
      const { stdout: diff } = await execAsync(
        `git show ${sha} --format="" --stat --patch`,
        { cwd: repo.path, timeout: 30000, maxBuffer: 10 * 1024 * 1024 }
      );

      // Get commit details
      const { stdout: details } = await execAsync(
        `git show ${sha} --format="%H|%h|%s|%b|%an|%ae|%aI" -s`,
        { cwd: repo.path, timeout: 5000 }
      );

      const [fullSha, shortSha, subject, body, authorName, authorEmail, date] = details.trim().split('|');

      res.json({
        sha: fullSha,
        shortSha,
        subject,
        body: body || '',
        author: { name: authorName, email: authorEmail },
        date,
        diff
      });
    } catch (error) {
      logger.error('API: Failed to get commit diff', { error: getErrorMessage(error) });
      res.status(500).json({ error: 'Failed to get commit diff' });
    }
  });

  // ============ CONFIG ============

  // Get user config
  router.get('/config', async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.query.userId as string, 10);

      if (!userId) {
        return res.status(400).json({ error: 'Missing userId query parameter' });
      }

      const config = await userConfigManager.getConfig(userId);
      const provider: AIProvider = config.aiProvider?.provider || 'anthropic';
      const effectiveModels = getEffectiveModels(provider, config);

      res.json({
        ...config,
        effectiveModels,
      });
    } catch (error) {
      logger.error('API: Failed to get config', { error: getErrorMessage(error) });
      res.status(500).json({ error: 'Failed to get config' });
    }
  });

  // Update user config
  router.put('/config', async (req: Request, res: Response) => {
    try {
      const { userId, ...updates } = req.body;

      if (!userId) {
        return res.status(400).json({ error: 'Missing userId' });
      }

      const updatedConfig = await userConfigManager.updateConfig(userId, updates);
      res.json(updatedConfig);
    } catch (error) {
      logger.error('API: Failed to update config', { error: getErrorMessage(error) });
      res.status(500).json({ error: 'Failed to update config' });
    }
  });

  // ============ STATS ============

  // Get metrics
  router.get('/stats', (_req: Request, res: Response) => {
    try {
      const stats = auditLogger.getStats();
      const activeTasks = executor.getTaskCount();

      res.json({
        commands: stats,
        activeTasks,
        uptime: process.uptime()
      });
    } catch (error) {
      logger.error('API: Failed to get stats', { error: getErrorMessage(error) });
      res.status(500).json({ error: 'Failed to get stats' });
    }
  });

  return router;
}
