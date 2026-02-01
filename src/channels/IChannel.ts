export interface IChannel {
    name: string;
    start(): Promise<void>;
    stop(): Promise<void>;
    sendMessage(to: string, message: string): Promise<void>;
    sendTypingIndicator(to: string): Promise<void>;
}
