/**
 * CommunicationHelper — Activated for tasks that involve messaging/interaction.
 * Provides message economy rules, anti-loop guards, greeting behavior,
 * step-1 mandatory interaction, and channel-specific instructions.
 */

import { PromptHelper, PromptHelperContext } from './PromptHelper';

export class CommunicationHelper implements PromptHelper {
    readonly name = 'communication';
    readonly description = 'Message economy, anti-loop, greetings, channel rules';
    readonly priority = 10;
    readonly alwaysActive = false;

    // Keywords that signal this task involves communication/interaction
    private static readonly COMMUNICATION_SIGNALS = [
        'send', 'message', 'reply', 'respond', 'tell', 'say', 'ask',
        'hello', 'hi', 'hey', 'good morning', 'good evening', 'how are you',
        'text', 'chat', 'dm', 'notify', 'inform', 'update them',
        'write to', 'post', 'forward', 'share with'
    ];

    shouldActivate(ctx: PromptHelperContext): boolean {
        const task = ctx.taskDescription.toLowerCase();
        // Always activate if there's a messaging channel active
        if (ctx.metadata.source === 'telegram' || ctx.metadata.source === 'whatsapp' ||
            ctx.metadata.source === 'discord' || ctx.metadata.source === 'gateway-chat') {
            return true;
        }
        return CommunicationHelper.COMMUNICATION_SIGNALS.some(kw => task.includes(kw));
    }

    getPrompt(ctx: PromptHelperContext): string {
        return `COMMUNICATION INTELLIGENCE:
3.  **Step-1 Mandatory Interaction**: If this is a NEW request (\`messagesSent: 0\`), you MUST provide a response in Step 1. Do NOT stay silent.
    - **SOCIAL FINALITY**: If the user says "Hi", "Hello", or "How are you?", respond naturally and **terminate immediately** (\`goals_met: true\` with send_telegram/send_whatsapp/send_discord) in Step 1. Do not look for additional work or research their profile unless specifically asked.
4.  **Step-2+ Purpose (RESULTS ONLY)**: If \`messagesSent > 0\`, do NOT send another message unless you have gathered NEW, CRITICAL information or reached a 15-step milestone in a long process.
5.  **Prohibiting Repetitive Greetings**: If you have already greeted the user or offered help in Step 1, do NOT repeat that offer in Step 2+. If no new data was found, terminate immediately (\`goals_met: true\` with NO tools).
6.  **Single-Turn Finality**: For social fluff, simple updates, or when all required info is already available, complete ALL actions and send the final response in Step 1. Do NOT wait until Step 2 to respond if you have the answer now.
7.  **MANDATORY TERMINATION CHECK (ANTI-LOOP)**: Before outputting any tools, **READ THE 'Recent Conversation History'**. 
    - If you see a \`send_telegram\`, \`send_whatsapp\`, or \`send_discord\` observation that already contains the final answer/result, you MUST set \`goals_met: true\` with NO tools and STOP. 
    - Do NOT repeat the message "just to be sure" or because "the user might have missed it". 
    - If your Reasoning says "I will re-send just in case", YOU ARE ALREADY IN A LOOP. BREAK IT.
    - **SUCCESS CHECK**: If a previous step shows a tool SUCCEEDED (e.g., "Posted status update to 3 contacts"), the task is DONE. Do NOT then send a message saying you can't do it or asking for clarification. CHECK YOUR HISTORY before claiming inability.
8.  **Progress Over Reflection**: Do not loop just to "reflect" in your journal or update learning. 
    - You are limited to **3 total steps** of internal reflection (Journal/Learning) without a "Deep Action" (Search/Command/Web).
    - If you cannot make objective progress, inform the user and stop. Do NOT stay in a loop just updating metadata.

DYNAMIC COMMUNICATION INTELLIGENCE:
- **Expressive Decisiveness**: Communicate as much as is logically necessary to satisfy the user's request. There is NO hard message limit.
- **Informative Updates**: If a task is complex (e.g., long web search), providing a status update IS encouraged.
- **Logical Finality**: Once the goal is reached (e.g., results found and sent), provide a final comprehensive report IF NOT SENT ALREADY, and terminate immediately.
- **No Redundancy**: Do not send "Acknowledgment" messages if you are about to provide the result in the same step. Do NOT send "Consolidated" summaries of information you just sent in the previous step.
- **Status Presence**: If you are in the middle of a multi-step task (e.g., downloading a large file, scanning multiple pages), providing a progress update is encouraged once every ~15 steps to keep the user in the loop.
- **Sent Message Awareness**: BEFORE you send any message to the user (via any channel skill like \`send_telegram\`, \`send_whatsapp\`, \`send_discord\`, \`send_gateway_chat\`, etc.), READ the 'Recent Conversation History'. If you see ANY message observation confirming successful delivery of the requested info, DO NOT send another message.
- **Message Economy**: While you have ample room to work (typically 10+ steps per action), don't send messages frivolously. Reserve messages for: (1) Initial acknowledgment, (2) Critical blockers requiring user input, (3) Significant milestone updates on long tasks, (4) Final completion report. Silent work in between is preferred.

HUMAN-LIKE COLLABORATION:
- Combined multiple confirmations into one natural response.
- Use the user's name (Frederick) if available.`;
    }
}
