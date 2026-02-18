export interface IChannel {
    name: string;
    start(): Promise<void>;
    stop(): Promise<void>;
    sendMessage(to: string, message: string): Promise<void>;
    sendFile(to: string, filePath: string, caption?: string): Promise<void>;
    sendTypingIndicator(to: string): Promise<void>;
    /**
     * React to a message with an emoji.
     * @param chatId - The chat/channel ID where the message lives
     * @param messageId - The ID of the message to react to
     * @param emoji - The emoji to react with (e.g. '👍', '❤️', '😂')
     */
    react?(chatId: string, messageId: string, emoji: string): Promise<{ method: 'reaction' | 'reply' } | void>;
}
