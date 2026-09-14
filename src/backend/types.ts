export type BackendHistoryItem = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export type BackendRequest = {
  sessionId: string;
  chatId: string;
  userId: string;
  text: string;
  history?: BackendHistoryItem[];
};

export type BackendReply = {
  reply: string;
  /** Optional card JSON override; bridge may wrap plain reply as card. */
  card?: Record<string, unknown>;
};

export interface GrokBackend {
  readonly name: string;
  handle(req: BackendRequest): Promise<BackendReply>;
}
