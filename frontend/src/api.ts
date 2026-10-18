import { accessToken } from './auth';

export type ChatMessage = { role: 'user' | 'assistant'; text: string };

// Sends the conversation to the Lambda and calls onText for each piece of the
// answer as it arrives. Lambda remembers nothing between calls, so every
// request carries the full history.
export async function streamChat(
  messages: ChatMessage[],
  sessionId: string,
  onText: (text: string) => void,
): Promise<void> {
  const response = await fetch(import.meta.env.VITE_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages, sessionId }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`${response.status}: ${await response.text()}`);
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    onText(value);
  }
}
