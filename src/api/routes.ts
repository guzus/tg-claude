import { Router, Request, Response } from 'express';
import { IClaudeExecutor, Repository, UserConfig } from '../types';
import { RepositoryManager } from '../services/RepositoryManager';
import { UserConfigManager } from '../services/UserConfigManager';
import { AuditLogger } from '../services/AuditLogger';
import { logger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';

export function createApiRoutes(
  executor: IClaudeExecutor,
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

  // Get all tasks
  router.get('/tasks', (req: Request, res: Response) => {
    try {
      const userId = req.query.userId ? parseInt(req.query.userId as string, 10) : undefined;
      const tasks = executor.getActiveTasks();

      const filteredTasks = userId
        ? tasks.filter(t => t.userId === userId)
        : tasks;

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
      const task = executor.getTaskOutput(taskId);

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
      const { prompt, workingDir, userId } = req.body;

      if (!prompt || !workingDir || !userId) {
        return res.status(400).json({ error: 'Missing required fields: prompt, workingDir, userId' });
      }

      const userConfig = userConfigManager.getConfig(userId);
      const taskId = await executor.startTask(prompt, workingDir, userId, userId, {
        aiProvider: userConfig?.aiProvider
      });

      res.json({ id: taskId, status: 'started' });
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
      const { userId, name, gitUrl, branch, type } = req.body;

      if (!userId) {
        return res.status(400).json({ error: 'Missing userId' });
      }

      let repo: Repository;

      if (type === 'clone' && gitUrl) {
        repo = await repositoryManager.cloneRepository(userId, gitUrl, name, branch);
      } else if (name) {
        repo = await repositoryManager.createRepository(userId, name);
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

  // ============ CONFIG ============

  // Get user config
  router.get('/config', (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.query.userId as string, 10);

      if (!userId) {
        return res.status(400).json({ error: 'Missing userId query parameter' });
      }

      const config = userConfigManager.getConfig(userId);

      if (!config) {
        return res.json({ userId });
      }

      res.json(config);
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

      const config = userConfigManager.getConfig(userId) || {
        userId,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const updatedConfig: UserConfig = {
        ...config,
        ...updates,
        updatedAt: new Date()
      };

      await userConfigManager.saveConfig(updatedConfig);
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
