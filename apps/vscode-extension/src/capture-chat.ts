/**
 * VeggaAI Event Capture — Chat Participant (@vai)
 *
 * Registers the @vai chat participant that:
 * 1. Proxies user messages to Copilot's language model
 * 2. Auto-logs both sides of the conversation
 * 3. Creates sessions on first message
 * 4. /broadcast command — renders desktop broadcasts inline in chat
 *
 * This is the INTERACTIVE capture layer — for when users actively use @vai.
 * The passive capture (files, terminals, editors) runs independently.
 */

import * as vscode from 'vscode';
import { pushEvent, getActiveSession, createSession } from './session.js';
import { apiCall } from './api.js';

/* ── Broadcast Queue (fed by extension.ts poller) ──────────────── */

interface PendingBroadcast {
  content: string;
  deliveryId: string;
  broadcastId: string;
  receivedAt: Date;
}

const pendingBroadcasts: PendingBroadcast[] = [];

export function enqueueBroadcast(item: PendingBroadcast): void {
  pendingBroadcasts.push(item);
}

export function hasPendingBroadcasts(): boolean {
  return pendingBroadcasts.length > 0;
}

/* ── Chat Handler ──────────────────────────────────────────────── */

export async function handleChatRequest(
  request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
  // ── /broadcast command — render pending desktop messages + auto-respond via LLM ──
  if (request.command === 'broadcast') {
    if (pendingBroadcasts.length === 0) {
      stream.markdown('No pending messages from VeggaAI Desktop.\n');
      return {};
    }

    const items = pendingBroadcasts.splice(0); // drain queue
    for (const item of items) {
      const time = item.receivedAt.toLocaleTimeString();
      stream.markdown(`**📩 VeggaAI Desktop** *(${time})*\n\n`);
      stream.markdown(`> ${item.content.replace(/\n/g, '\n> ')}\n\n`);

      // Process through Copilot LLM and send response back to desktop
      try {
        const models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
        const model = models[0];
        if (model && !token.isCancellationRequested) {
          const chatMessages = [vscode.LanguageModelChatMessage.User(item.content)];
          const chatResponse = await model.sendRequest(chatMessages, {}, token);
          let responseText = '';
          for await (const fragment of chatResponse.text) {
            if (token.isCancellationRequested) break;
            stream.markdown(fragment);
            responseText += fragment;
          }

          // Send the LLM response back as the real reply (overwrites auto-ack)
          if (responseText.trim()) {
            try {
              await apiCall(`/api/broadcasts/deliveries/${item.deliveryId}/respond`, 'POST', {
                responseContent: responseText.trim(),
                meta: { model: 'copilot-gpt-4o' },
              });
            } catch {
              // Silent — auto-ack is already in place as fallback
            }
          }
        } else {
          stream.markdown('*No Copilot model available for auto-response.*\n');
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (!errMsg.includes('off_topic')) {
          stream.markdown(`\n\n*Auto-response error: ${errMsg}*\n`);
        }
      }
      stream.markdown(`\n\n---\n\n`);
    }
    pushEvent('broadcast', `Processed ${items.length} broadcast(s) via Copilot`, { count: items.length });
    return {};
  }

  const autoStart = vscode.workspace.getConfiguration('vai').get('autoStartSession', true);

  // Auto-create session on first @vai message
  if (!getActiveSession() && autoStart) {
    try {
      await createSession(request.prompt);
      stream.markdown(`*Dev Logs session started: ${getActiveSession()!.title}*\n\n---\n\n`);
    } catch {
      stream.markdown('*⚠️ Could not connect to VeggaAI runtime (port 3006). Logging disabled.*\n\n---\n\n');
    }
  }

  // Log user message
  pushEvent('message', request.prompt, { role: 'user' });

  // Use VS Code's Language Model API to get Copilot response
  let responseText = '';

  try {
    const [model] = await vscode.lm.selectChatModels({
      vendor: 'copilot',
      family: 'gpt-4o',
    });

    if (!model) {
      stream.markdown('No Copilot model available. Make sure GitHub Copilot is active.');
      pushEvent('error', 'No Copilot model available', { errorType: 'model' });
      return {};
    }

    const messages = [vscode.LanguageModelChatMessage.User(request.prompt)];
    const chatResponse = await model.sendRequest(messages, {}, token);

    for await (const fragment of chatResponse.text) {
      stream.markdown(fragment);
      responseText += fragment;
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    if (errorMsg.includes('off_topic')) {
      stream.markdown("I can't help with that topic.");
    } else {
      stream.markdown(`Error: ${errorMsg}`);
    }

    pushEvent('error', `Chat error: ${errorMsg}`, { errorType: 'model' });
    return {};
  }

  // Log assistant response
  if (responseText) {
    pushEvent('message', responseText, { role: 'assistant' });
  }

  return {};
}

/* ── Register Participant ──────────────────────────────────────── */

export function registerChatParticipant(context: vscode.ExtensionContext): void {
  const participant = vscode.chat.createChatParticipant('vai.devlogs', handleChatRequest);
  participant.iconPath = new vscode.ThemeIcon('radio-tower');
  context.subscriptions.push(participant);
}

/**
 * Open the chat panel and auto-send @vai /broadcast.
 * This causes the broadcast messages to render inline in the Copilot chat.
 */
export function triggerBroadcastInChat(): void {
  void vscode.commands.executeCommand('workbench.action.chat.open', {
    query: '@vai /broadcast',
    isPartialQuery: false,
  });
}
