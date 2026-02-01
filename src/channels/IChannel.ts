export interface IChannel {
    name: string;
    start(): Promise<void>;
    stop(): Promise<void>;
    sendMessage(to: string, message: string): Promise<void>;
    sendFile(to: string, filePath: string, caption?: string): Promise<void>;
    sendTypingIndicator(to: string): Promise<void>;
}
