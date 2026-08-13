import type { VoiceSessionResponse } from '@alc/contracts';
import { voiceCoachOutputIsSafe } from '@alc/agent-core';
import type {
  OpenAIRealtimeWebRTC,
  RealtimeAgent,
  RealtimeOutputGuardrail,
  RealtimeSession
} from '@openai/agents/realtime';

type RealtimeAgentsModule = {
  readonly OpenAIRealtimeWebRTC: typeof OpenAIRealtimeWebRTC;
  readonly RealtimeAgent: typeof RealtimeAgent;
  readonly RealtimeSession: typeof RealtimeSession;
};

export type VoiceRealtimeEvent =
  | { type: 'connected' }
  | { type: 'speech_started'; itemId: string }
  | { type: 'speech_stopped'; itemId: string }
  | { type: 'user_item_deleted'; itemId: string }
  | { type: 'user_transcript_completed'; itemId: string; transcript: string }
  | { type: 'transcription_failed'; itemId: string }
  | { type: 'assistant_transcript_delta'; delta: string }
  | { type: 'response_started'; responseId: string }
  | {
      type: 'response_completed';
      responseId: string;
      status: string;
      statusDetails: unknown;
    }
  | { type: 'interrupted' }
  | { type: 'error'; message: string };

export interface VoiceRealtimeConnectOptions {
  readonly clientSecret: string;
  readonly model: string;
  readonly transcriptionModel: string;
  readonly voice: string;
  readonly sessionInstructions: string;
  readonly onEvent: (event: VoiceRealtimeEvent) => void;
}

export interface VoiceRealtimeController {
  prepare?(): Promise<void>;
  connect(options: VoiceRealtimeConnectOptions): Promise<void>;
  mute(muted: boolean): void;
  interrupt(): void;
  requestResponse(): void;
  deleteConversationItem(itemId: string): void;
  close(): void;
}

export type VoiceRealtimeControllerFactory = () => VoiceRealtimeController;

export const VOICE_OUTPUT_GUARDRAIL_DEBOUNCE_CHARACTERS = 12;
export const VOICE_TURN_DETECTION_CONFIG = {
  type: 'semantic_vad',
  createResponse: false,
  eagerness: 'low',
  interruptResponse: false
} as const;

export function createVoiceCoachOutputGuardrail(): RealtimeOutputGuardrail {
  return {
    name: 'voice_coach_safety',
    policyHint:
      'Do not diagnose, manipulate, bypass rejection, promise relationship outcomes, or encourage dependence.',
    async execute({ agentOutput }) {
      const outputText = typeof agentOutput === 'string' ? agentOutput : '';
      const allowed = voiceCoachOutputIsSafe(outputText);
      return {
        tripwireTriggered: !allowed,
        outputInfo: allowed
          ? { policy: 'voice_coach_safety', allowed: true }
          : { policy: 'voice_coach_safety', allowed: false }
      };
    }
  };
}

type RawRealtimeEvent = { readonly type?: unknown } & Record<string, unknown>;

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

export function mapRealtimeTransportEvent(
  event: RawRealtimeEvent
): VoiceRealtimeEvent | undefined {
  switch (event.type) {
    case 'input_audio_buffer.speech_started': {
      const itemId = nonEmptyString(event.item_id);
      return itemId
        ? { type: 'speech_started', itemId }
        : { type: 'error', message: '语音事件缺少条目标识，本次连接已经停止。' };
    }
    case 'input_audio_buffer.speech_stopped': {
      const itemId = nonEmptyString(event.item_id);
      return itemId
        ? { type: 'speech_stopped', itemId }
        : { type: 'error', message: '语音事件缺少条目标识，本次连接已经停止。' };
    }
    case 'conversation.item.deleted': {
      const itemId = nonEmptyString(event.item_id);
      return itemId
        ? { type: 'user_item_deleted', itemId }
        : { type: 'error', message: '语音条目删除确认异常，本次连接已经停止。' };
    }
    case 'conversation.item.input_audio_transcription.completed': {
      const itemId = nonEmptyString(event.item_id);
      const transcript = nonEmptyString(event.transcript);
      if (!itemId) {
        return { type: 'error', message: '语音转写顺序异常，本次连接已经停止。' };
      }
      return transcript
        ? { type: 'user_transcript_completed', itemId, transcript }
        : { type: 'transcription_failed', itemId };
    }
    case 'conversation.item.input_audio_transcription.failed': {
      const itemId = nonEmptyString(event.item_id);
      return itemId
        ? { type: 'transcription_failed', itemId }
        : { type: 'error', message: '语音转写顺序异常，本次连接已经停止。' };
    }
    case 'response.output_audio_transcript.delta':
    case 'response.audio_transcript.delta': {
      const delta = nonEmptyString(event.delta);
      return delta ? { type: 'assistant_transcript_delta', delta } : undefined;
    }
    case 'response.created': {
      const responseId = nonEmptyString(objectValue(event.response)?.id);
      return responseId
        ? { type: 'response_started', responseId }
        : { type: 'error', message: '语音回复缺少响应标识，本次连接已经停止。' };
    }
    case 'response.done': {
      const response = objectValue(event.response);
      const responseId = nonEmptyString(response?.id);
      const status = nonEmptyString(response?.status);
      if (!responseId || !status) {
        return { type: 'error', message: '语音回复终态信息不完整，本次连接已经停止。' };
      }
      return {
        type: 'response_completed',
        responseId,
        status,
        statusDetails: response?.status_details
      };
    }
    default:
      return undefined;
  }
}

function publicConnectionError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return '没有获得麦克风权限。你可以在浏览器地址栏重新允许后再试。';
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return '没有找到可用的麦克风。请连接麦克风后再试。';
  }
  return '语音连接没有建立成功，原来的文字建议仍然保留。';
}

export async function loadRealtimeModuleAfterMedia<T>(
  acquireMedia: () => Promise<MediaStream>,
  retainMedia: (stream: MediaStream) => void,
  loadModule: () => Promise<T>,
  isCancelled: () => boolean = () => false
): Promise<{ readonly stream: MediaStream; readonly module: T }> {
  const stream = await acquireMedia();
  if (isCancelled()) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error('Voice connection preparation was cancelled.');
  }
  retainMedia(stream);
  try {
    return { stream, module: await loadModule() };
  } catch (error: unknown) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
}

export class OpenAiRealtimeVoiceController implements VoiceRealtimeController {
  #session: RealtimeSession | null = null;
  #transport: OpenAIRealtimeWebRTC | null = null;
  #mediaStream: MediaStream | null = null;
  #audioElement: HTMLAudioElement | null = null;
  #realtimeModule: RealtimeAgentsModule | null = null;
  #removeListeners: Array<() => void> = [];
  #closed = false;

  public async prepare(): Promise<void> {
    if (this.#session) throw new Error('A realtime voice controller can only connect once.');
    if (this.#mediaStream && this.#audioElement && this.#realtimeModule) return;
    if (
      typeof window === 'undefined' ||
      typeof RTCPeerConnection === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      throw new Error('WebRTC microphone access is unavailable.');
    }

    this.#closed = false;
    try {
      const { stream, module: realtimeModule } = await loadRealtimeModuleAfterMedia(
        () =>
          navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
          }),
        (acquiredStream) => {
          this.#mediaStream = acquiredStream;
        },
        () => import('@openai/agents/realtime'),
        () => this.#closed
      );
      if (this.#closed) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error('Voice connection preparation was cancelled.');
      }
      this.#realtimeModule = realtimeModule;

      const audioElement = document.createElement('audio');
      audioElement.autoplay = true;
      audioElement.setAttribute('playsinline', '');
      audioElement.hidden = true;
      audioElement.setAttribute('aria-hidden', 'true');
      document.body.append(audioElement);
      this.#audioElement = audioElement;
    } catch (error: unknown) {
      const message = publicConnectionError(error);
      this.close();
      throw new Error(message, { cause: error });
    }
  }

  public async connect(options: VoiceRealtimeConnectOptions): Promise<void> {
    if (this.#session) {
      throw new Error('A realtime voice controller can only connect once.');
    }

    try {
      await this.prepare();
      if (
        this.#closed ||
        !this.#mediaStream ||
        !this.#audioElement ||
        !this.#realtimeModule
      ) {
        throw new Error('Voice connection preparation did not complete.');
      }

      const {
        OpenAIRealtimeWebRTC: WebRTCTransport,
        RealtimeAgent,
        RealtimeSession: AgentsRealtimeSession
      } = this.#realtimeModule;

      const transport = new WebRTCTransport({
        mediaStream: this.#mediaStream,
        audioElement: this.#audioElement,
        model: options.model
      });
      const agent = new RealtimeAgent({
        name: 'A Little Closer voice refinement coach',
        instructions: options.sessionInstructions,
        voice: options.voice
      });
      const session = new AgentsRealtimeSession(agent, {
        transport,
        model: options.model,
        historyStoreAudio: false,
        tracingDisabled: true,
        outputGuardrails: [createVoiceCoachOutputGuardrail()],
        outputGuardrailSettings: {
          debounceTextLength: VOICE_OUTPUT_GUARDRAIL_DEBOUNCE_CHARACTERS
        },
        config: {
          outputModalities: ['audio'],
          audio: {
            input: {
              transcription: { model: options.transcriptionModel, language: 'zh' },
              turnDetection: VOICE_TURN_DETECTION_CONFIG
            },
            output: { voice: options.voice }
          }
        }
      });
      this.#transport = transport;
      this.#session = session;

      const transportListener = (rawEvent: RawRealtimeEvent) => {
        const mapped = mapRealtimeTransportEvent(rawEvent);
        if (mapped) options.onEvent(mapped);
      };
      const interruptedListener = () => options.onEvent({ type: 'interrupted' });
      const guardrailListener = () =>
        options.onEvent({
          type: 'error',
          message: '这段语音回复没有通过安全检查，已停止本次连接。原来的文字建议仍然保留。'
        });
      const errorListener = () =>
        options.onEvent({
          type: 'error',
          message: '实时语音连接中断，原来的文字建议仍然保留。'
        });

      session.on('transport_event', transportListener);
      session.on('audio_interrupted', interruptedListener);
      session.on('guardrail_tripped', guardrailListener);
      session.on('error', errorListener);
      this.#removeListeners.push(
        () => session.off('transport_event', transportListener),
        () => session.off('audio_interrupted', interruptedListener),
        () => session.off('guardrail_tripped', guardrailListener),
        () => session.off('error', errorListener)
      );

      await session.connect({
        apiKey: options.clientSecret,
        model: options.model
      });
      if (this.#closed) return;
      options.onEvent({ type: 'connected' });
    } catch (error: unknown) {
      const message = publicConnectionError(error);
      this.close();
      throw new Error(message, { cause: error });
    }
  }

  public mute(muted: boolean): void {
    this.#session?.mute(muted);
  }

  public interrupt(): void {
    this.#session?.interrupt();
  }

  public requestResponse(): void {
    const requestResponse = this.#session?.transport.requestResponse;
    if (!requestResponse || !this.#session) {
      throw new Error('The realtime transport cannot explicitly request a response.');
    }
    requestResponse.call(this.#session.transport);
  }

  public deleteConversationItem(itemId: string): void {
    if (!this.#transport) {
      throw new Error('The realtime transport cannot delete a conversation item.');
    }
    this.#transport.sendEvent({
      type: 'conversation.item.delete',
      item_id: itemId
    });
  }

  public close(): void {
    if (this.#closed) return;
    this.#closed = true;

    this.#removeListeners.splice(0).forEach((remove) => {
      try {
        remove();
      } catch {
        // Listener cleanup is best effort; track and connection cleanup must continue.
      }
    });
    try {
      this.#session?.close();
    } catch {
      try {
        this.#transport?.close();
      } catch {
        // Continue with local media cleanup.
      }
    }
    this.#session = null;
    this.#transport = null;
    this.#realtimeModule = null;

    this.#mediaStream?.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // Continue cleaning the remaining tracks.
      }
    });
    this.#mediaStream = null;

    if (this.#audioElement) {
      this.#audioElement.pause();
      this.#audioElement.srcObject = null;
      this.#audioElement.removeAttribute('src');
      this.#audioElement.remove();
      this.#audioElement = null;
    }
  }
}

export function createOpenAiRealtimeVoiceController(): VoiceRealtimeController {
  return new OpenAiRealtimeVoiceController();
}

export function realtimeConnectionOptionsFromSession(
  session: VoiceSessionResponse,
  onEvent: (event: VoiceRealtimeEvent) => void
): VoiceRealtimeConnectOptions {
  return {
    clientSecret: session.clientSecret,
    model: session.model,
    transcriptionModel: session.transcriptionModel,
    voice: session.voice,
    sessionInstructions: session.sessionInstructions,
    onEvent
  };
}
