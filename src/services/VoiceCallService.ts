import { logger } from '../utils/logger';
import { EventEmitter } from 'events';

export interface VoiceCallConfig {
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioPhoneNumber: string;
  geminiApiKey: string;
  callbackBaseUrl: string;
}

export interface CallSession {
  callSid: string;
  userId: number;
  chatId: number;
  phoneNumber: string;
  status: CallStatus;
  problem: string;
  userResponse?: string;
  startTime: Date;
  endTime?: Date;
}

export enum CallStatus {
  INITIATING = 'initiating',
  RINGING = 'ringing',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  NO_ANSWER = 'no_answer',
  BUSY = 'busy'
}

export class VoiceCallService extends EventEmitter {
  private config: VoiceCallConfig | null = null;
  private activeCalls: Map<string, CallSession> = new Map();
  private twilioClient: any = null;

  constructor() {
    super();
    this.loadConfig();
  }

  private loadConfig(): void {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const phoneNumber = process.env.TWILIO_PHONE_NUMBER;
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const callbackBaseUrl = process.env.VOICE_CALLBACK_URL || 'http://localhost:3000';

    if (accountSid && authToken && phoneNumber && geminiApiKey) {
      this.config = {
        twilioAccountSid: accountSid,
        twilioAuthToken: authToken,
        twilioPhoneNumber: phoneNumber,
        geminiApiKey,
        callbackBaseUrl
      };

      // Initialize Twilio client
      try {
        const twilio = require('twilio');
        this.twilioClient = twilio(accountSid, authToken);
        logger.info('VoiceCallService initialized with Twilio');
      } catch (error) {
        logger.warn('Twilio SDK not installed. Run: npm install twilio');
      }
    } else {
      logger.warn('VoiceCallService: Missing configuration. Voice calls disabled.', {
        hasTwilioSid: !!accountSid,
        hasTwilioToken: !!authToken,
        hasTwilioPhone: !!phoneNumber,
        hasGeminiKey: !!geminiApiKey
      });
    }
  }

  isConfigured(): boolean {
    return this.config !== null && this.twilioClient !== null;
  }

  /**
   * Initiate a voice call to notify user about a problem
   */
  async initiateCall(
    userId: number,
    chatId: number,
    phoneNumber: string,
    problem: string
  ): Promise<CallSession | null> {
    if (!this.isConfigured() || !this.twilioClient) {
      logger.error('VoiceCallService not configured');
      return null;
    }

    try {
      // Create TwiML for the call - uses Gemini Live for voice interaction
      const twimlUrl = `${this.config!.callbackBaseUrl}/voice/twiml?problem=${encodeURIComponent(problem)}&userId=${userId}`;

      const call = await this.twilioClient.calls.create({
        to: phoneNumber,
        from: this.config!.twilioPhoneNumber,
        url: twimlUrl,
        statusCallback: `${this.config!.callbackBaseUrl}/voice/status`,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallbackMethod: 'POST',
        record: false,
        machineDetection: 'Enable',
        timeout: 30
      });

      const session: CallSession = {
        callSid: call.sid,
        userId,
        chatId,
        phoneNumber,
        status: CallStatus.INITIATING,
        problem,
        startTime: new Date()
      };

      this.activeCalls.set(call.sid, session);

      logger.info('Voice call initiated', {
        callSid: call.sid,
        userId,
        phoneNumber: phoneNumber.substring(0, 6) + '****'
      });

      return session;
    } catch (error) {
      logger.error('Failed to initiate voice call', {
        error: error instanceof Error ? error.message : String(error),
        userId
      });
      return null;
    }
  }

  /**
   * Generate TwiML response for the call using Gemini for voice
   */
  generateTwiML(problem: string, userId: number): string {
    // Using Twilio's TwiML with Gather for speech input
    // The speech will be processed by our webhook which uses Gemini
    const escapedProblem = problem
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Hello! Claude Code encountered a problem and needs your input.</Say>
  <Pause length="1"/>
  <Say voice="alice">The issue is: ${escapedProblem}</Say>
  <Pause length="1"/>
  <Say voice="alice">Please tell me how you'd like to proceed. Speak your response after the beep.</Say>
  <Gather input="speech" timeout="30" speechTimeout="auto" action="/voice/response?userId=${userId}" method="POST">
    <Play>https://api.twilio.com/cowbell.mp3</Play>
  </Gather>
  <Say voice="alice">I didn't hear a response. The agent will continue with default behavior.</Say>
</Response>`;
  }

  /**
   * Process user's speech response using Gemini
   */
  async processVoiceResponse(
    callSid: string,
    speechResult: string
  ): Promise<string> {
    const session = this.activeCalls.get(callSid);
    if (!session) {
      logger.warn('No active call session found', { callSid });
      return 'continue with default behavior';
    }

    session.userResponse = speechResult;

    // Use Gemini to interpret and refine the user's response
    const refinedResponse = await this.interpretWithGemini(
      session.problem,
      speechResult
    );

    logger.info('Voice response processed', {
      callSid,
      originalSpeech: speechResult,
      refinedResponse
    });

    // Emit event so VibeCodingHandler can continue
    this.emit('userResponse', {
      userId: session.userId,
      chatId: session.chatId,
      problem: session.problem,
      response: refinedResponse,
      originalSpeech: speechResult
    });

    return refinedResponse;
  }

  /**
   * Use Gemini to interpret user's voice response
   */
  private async interpretWithGemini(problem: string, speechResult: string): Promise<string> {
    if (!this.config?.geminiApiKey) {
      return speechResult;
    }

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${this.config.geminiApiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `You are helping interpret a user's voice response to a coding problem.

Problem encountered: ${problem}

User's spoken response: "${speechResult}"

Extract the key instruction or decision from the user's response. Convert it into a clear, actionable instruction for a coding agent. Be concise.

If the response is unclear, ask for clarification by returning: "UNCLEAR: [what you need clarified]"

Return ONLY the interpreted instruction, nothing else.`
              }]
            }],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 200
            }
          })
        }
      );

      if (response.ok) {
        const data = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        const interpretation = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (interpretation) {
          return interpretation.trim();
        }
      }
    } catch (error) {
      logger.error('Failed to interpret with Gemini', {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    return speechResult;
  }

  /**
   * Update call status from Twilio webhook
   */
  updateCallStatus(callSid: string, status: string): void {
    const session = this.activeCalls.get(callSid);
    if (!session) return;

    const statusMap: Record<string, CallStatus> = {
      'initiated': CallStatus.INITIATING,
      'ringing': CallStatus.RINGING,
      'in-progress': CallStatus.IN_PROGRESS,
      'answered': CallStatus.IN_PROGRESS,
      'completed': CallStatus.COMPLETED,
      'failed': CallStatus.FAILED,
      'no-answer': CallStatus.NO_ANSWER,
      'busy': CallStatus.BUSY
    };

    session.status = statusMap[status] || session.status;

    if (['completed', 'failed', 'no-answer', 'busy'].includes(status)) {
      session.endTime = new Date();

      // Emit event if call ended without response
      if (!session.userResponse) {
        this.emit('callEnded', {
          userId: session.userId,
          chatId: session.chatId,
          status: session.status,
          problem: session.problem
        });
      }
    }

    logger.info('Call status updated', {
      callSid,
      status: session.status
    });
  }

  /**
   * Get active call for a user
   */
  getActiveCallForUser(userId: number): CallSession | undefined {
    for (const session of this.activeCalls.values()) {
      if (session.userId === userId &&
          ![CallStatus.COMPLETED, CallStatus.FAILED, CallStatus.NO_ANSWER, CallStatus.BUSY].includes(session.status)) {
        return session;
      }
    }
    return undefined;
  }

  /**
   * End an active call
   */
  async endCall(callSid: string): Promise<boolean> {
    if (!this.twilioClient) return false;

    try {
      await this.twilioClient.calls(callSid).update({ status: 'completed' });
      const session = this.activeCalls.get(callSid);
      if (session) {
        session.status = CallStatus.COMPLETED;
        session.endTime = new Date();
      }
      return true;
    } catch (error) {
      logger.error('Failed to end call', {
        callSid,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Clean up old call sessions
   */
  cleanupOldSessions(maxAgeMs: number = 3600000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [callSid, session] of this.activeCalls.entries()) {
      if (session.endTime && now - session.endTime.getTime() > maxAgeMs) {
        this.activeCalls.delete(callSid);
        cleaned++;
      }
    }

    return cleaned;
  }
}

export const voiceCallService = new VoiceCallService();
