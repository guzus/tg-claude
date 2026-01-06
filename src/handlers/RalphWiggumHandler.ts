import TelegramBot, { Message } from 'node-telegram-bot-api';
import { BaseHandler } from './BaseHandler';
import { ClaudeExecutor } from '../services/ClaudeExecutor';
import { RateLimiter } from '../services/RateLimiter';
import { AuditLogger } from '../services/AuditLogger';
import { RepositoryManager } from '../services/RepositoryManager';
import { logger } from '../utils/logger';

// Ralph Wiggum quotes from The Simpsons
const RALPH_QUOTES = [
  "Me fail English? That's unpossible!",
  "I'm learnding!",
  "Hi, Super Nintendo Chalmers!",
  "The doctor said I wouldn't have so many nose bleeds if I kept my finger outta there.",
  "I bent my Wookiee.",
  "My cat's breath smells like cat food.",
  "I choo-choo-choose you!",
  "When I grow up, I want to be a principal or a caterpillar.",
  "I'm Idaho!",
  "That's where I saw the leprechaun. He tells me to burn things.",
  "Go banana!",
  "Mrs. Krabappel and Principal Skinner were in the closet making babies and I saw one of the babies and the baby looked at me.",
  "I sleep in a drawer!",
  "My daddy's gonna put you in jail!",
  "Even my boogers are spicy!",
  "I'm a unitard!",
  "Principal Skinner, I got car sick in your office.",
  "What's a battle?",
  "I found a moon rock in my nose!",
  "This tastes like Grandma!",
  "My parents won't let me use scissors.",
  "I dress myself!",
  "Slow down, Bart! My legs don't know how to be as long as yours!",
  "I heard your dad went into a restaurant and ate everything in the restaurant and they had to close the restaurant.",
  "Your epidermis is showing!",
  "Um, Miss Hoover? There's a dog in the vent.",
  "And when the strategy hits the air, the bats will blow up, and the robots will punch each other!",
  "I'm special!",
  "My face is on fire!",
  "I'm Sofa King!",
  "My sandbox had a dead cat in it once.",
  "Bushes are nice 'cause they don't have prickers. Unless they do. This one did. Ouch!",
  "That's my swingset! I have to go now!",
  "Somebody was mean to me once, too. I'm still sad.",
  "I like men now!",
  "When I grow up, I wanna be a Mommy!"
];

// Ralph's wisdom for coding situations
const RALPH_CODING_WISDOM: Record<string, string[]> = {
  error: [
    "The red squiggles are like angry caterpillars!",
    "My computer made the sad face!",
    "I pressed all the buttons and now it's doing a dance!",
    "The screen said 'error' and I said 'errorback'!",
    "That's not a bug, that's a feature caterpillar!"
  ],
  success: [
    "It worked! Now I'm a computer programmer like my daddy's tax guy!",
    "The green checkmark is my friend!",
    "I made the computer happy! Now it won't tell Santa.",
    "My code is learnding!",
    "I'm a coding superhero! My power is pressing buttons!"
  ],
  confused: [
    "The numbers are letters and the letters are confused!",
    "My brain is full of spaghetti code!",
    "I think the computer is playing hide and seek with my variables!",
    "The function went that way... or maybe this way!",
    "Semicolons are like little tadpoles waiting to grow into colons!"
  ]
};

/**
 * Ralph Wiggum Plugin - Adds fun quotes and personality to the bot
 */
export class RalphWiggumHandler extends BaseHandler {
  constructor(
    bot: TelegramBot,
    executor: ClaudeExecutor,
    rateLimiter: RateLimiter,
    auditLogger: AuditLogger,
    repositoryManager: RepositoryManager
  ) {
    super(bot, executor, rateLimiter, auditLogger, repositoryManager);
  }

  /**
   * /ralph command - Get a random Ralph Wiggum quote
   */
  async handleRalph(msg: Message, match: RegExpExecArray | null): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    const args = match?.[1]?.trim().toLowerCase() || '';

    this.auditLogger.logCommand({ userId, command: 'ralph', success: true });

    try {
      if (args === 'help') {
        await this.showRalphHelp(chatId);
        return;
      }

      if (args === 'wisdom' || args === 'code') {
        await this.sendCodingWisdom(chatId);
        return;
      }

      if (args === 'error') {
        await this.sendCodingWisdom(chatId, 'error');
        return;
      }

      if (args === 'success' || args === 'yay') {
        await this.sendCodingWisdom(chatId, 'success');
        return;
      }

      // Default: random quote
      const quote = this.getRandomQuote();
      await this.bot.sendMessage(chatId, `🧒 *Ralph says:*\n\n"${quote}"`, {
        parse_mode: 'Markdown'
      });

      logger.info('Ralph quote sent', { userId, quote: quote.substring(0, 30) });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.bot.sendMessage(chatId, `😵 Ralph is confused: ${errorMessage}`);
      logger.error('Ralph command failed', { userId, error: errorMessage });
    }
  }

  private async showRalphHelp(chatId: number): Promise<void> {
    const message =
      `🧒 *Ralph Wiggum Plugin*\n\n` +
      `_"I'm helping!"_\n\n` +
      `*Commands:*\n` +
      `/ralph - Random Ralph quote\n` +
      `/ralph wisdom - Coding wisdom\n` +
      `/ralph error - When things break\n` +
      `/ralph success - Celebration time!\n\n` +
      `Ralph is here to brighten your coding day!`;

    await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

  private async sendCodingWisdom(chatId: number, type?: string): Promise<void> {
    const wisdomType = type || this.getRandomKey(RALPH_CODING_WISDOM);
    const wisdomArray = RALPH_CODING_WISDOM[wisdomType] || RALPH_CODING_WISDOM.confused;
    const wisdom = wisdomArray[Math.floor(Math.random() * wisdomArray.length)];

    const emoji = type === 'success' ? '🌟' : type === 'error' ? '😵' : '🤔';

    await this.bot.sendMessage(chatId,
      `${emoji} *Ralph's Coding Wisdom:*\n\n"${wisdom}"`,
      { parse_mode: 'Markdown' }
    );
  }

  private getRandomQuote(): string {
    return RALPH_QUOTES[Math.floor(Math.random() * RALPH_QUOTES.length)];
  }

  private getRandomKey(obj: Record<string, string[]>): string {
    const keys = Object.keys(obj);
    return keys[Math.floor(Math.random() * keys.length)];
  }

  /**
   * Get a Ralph quote for use in other handlers (e.g., task completion)
   */
  static getSuccessQuote(): string {
    const quotes = RALPH_CODING_WISDOM.success;
    return quotes[Math.floor(Math.random() * quotes.length)];
  }

  /**
   * Get a Ralph quote for errors
   */
  static getErrorQuote(): string {
    const quotes = RALPH_CODING_WISDOM.error;
    return quotes[Math.floor(Math.random() * quotes.length)];
  }
}
