/**
 * VeggaAI Event Capture — Chat Participant (@vai)
 *
 * Registers the @vai chat participant that:
 * 1. Proxies user messages to Copilot's language model
 * 2. Auto-logs both sides of the conversation
 * 3. Creates sessions on first message
 *
 * This is the INTERACTIVE capture layer — for when users actively use @vai.
 * The passive capture (files, terminals, editors) runs independently.
 */

import * as vscode from 'vscode';
import { pushEvent, getActiveSession, createSession } from './session.js';

/* ── Chat Handler ──────────────────────────────────────────────── */

export async function handleChatRequest(
  request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
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
