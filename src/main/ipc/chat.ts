import type { IpcMain, WebContents } from 'electron';
import type { JarvisEvent, StartChatRequest } from '../../shared/protocol';
import type { ModelAdapter } from '../llm/adapter';
import { buildMemoryContext, runChat, sanitizeIncomingMessages } from '../llm/chat';
import { isValidSessionId } from '../memory/conversationStore';
import type { Services } from '../services';
import type { ToolRegistry } from '../tools';

const active = new Map<string, AbortController>();

export function registerChatIpc(
  ipcMain: IpcMain,
  getWebContents: () => WebContents | null,
  adapter: ModelAdapter,
  registry: ToolRegistry,
  services: Services,
): void {
  const emit = (event: JarvisEvent) => {
    if (process.env.AIOS_CHAT_TRACE) {
      console.log(`[trace] ${Date.now()} emit ${event.type} rid=${event.requestId}`);
    }
    const contents = getWebContents();
    if (contents && !contents.isDestroyed()) contents.send('jarvis:event', event);
  };

  ipcMain.handle('chat:start', (_event, request: StartChatRequest) => {
    const requestId =
      typeof request?.requestId === 'string' && /^[\w-]{1,64}$/.test(request.requestId)
        ? request.requestId
        : `req_${Date.now()}`;
    if (process.env.AIOS_CHAT_TRACE) {
      console.log(
        `[trace] ${Date.now()} handle start rid=${requestId} active=[${[...active.keys()].join(',')}]`,
      );
    }

    // Only one in-flight turn at a time; a new turn cancels the previous one.
    for (const [staleId, controller] of active) {
      controller.abort();
      active.delete(staleId);
      emit({ type: 'cancelled', requestId: staleId });
    }

    const messages = Array.isArray(request?.messages) ? request.messages : [];
    const sessionId = isValidSessionId(request?.sessionId) ? request.sessionId : undefined;
    const userText =
      [...sanitizeIncomingMessages(messages)].reverse().find((message) => message.role === 'user')
        ?.content ?? '';

    // Store the finished (or stopped) exchange locally with timestamps and its session id.
    let assistantText = '';
    const turnEmit = (event: JarvisEvent) => {
      if (event.type === 'text') assistantText += event.text;
      if (
        sessionId &&
        userText &&
        (event.type === 'done' || event.type === 'cancelled') &&
        assistantText.trim().length > 0
      ) {
        try {
          services.conversations.recordTurn(sessionId, userText, assistantText);
        } catch (error) {
          console.warn('[ai-os] could not store conversation turn:', error);
        }
      }
      emit(event);
    };

    const systemContext = services.memory.getSettings().injectIntoPrompt
      ? buildMemoryContext(services.memory.promptFacts())
      : '';

    const controller = new AbortController();
    active.set(requestId, controller);
    void runChat({
      requestId,
      sessionId,
      systemContext,
      adapter,
      registry,
      broker: services.approvals,
      messages,
      signal: controller.signal,
      emit: turnEmit,
    }).finally(() => active.delete(requestId));

    return { requestId };
  });

  ipcMain.handle('chat:cancel', (_event, requestId: string) => {
    if (process.env.AIOS_CHAT_TRACE) {
      console.log(`[trace] ${Date.now()} handle cancel rid=${requestId}`);
    }
    const controller = active.get(requestId);
    if (controller) {
      controller.abort();
      return true;
    }
    return false;
  });
}
