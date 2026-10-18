import { BedrockRuntimeClient, ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from '@aws-sdk/client-bedrock-agentcore';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { LambdaFunctionURLEvent } from 'aws-lambda';
import type { Writable } from 'node:stream';

const { USER_POOL_ID, USER_POOL_CLIENT_ID, MODEL_ID, AGENT_RUNTIME_ARN } = process.env;

// Created outside the handler so warm invocations reuse them. The verifier
// also caches Cognito's public signing keys after the first request.
const verifier = CognitoJwtVerifier.create({
  userPoolId: USER_POOL_ID!,
  clientId: USER_POOL_CLIENT_ID!,
  tokenUse: 'access',
});
const bedrock = new BedrockRuntimeClient({});
const agentcore = new BedrockAgentCoreClient({});

// Caps on what one request can make us pay for.
const MAX_MESSAGES = 20;
const MAX_CHARS = 4000;
const MAX_OUTPUT_TOKENS = 1000;

type ChatMessage = { role: 'user' | 'assistant'; text: string };
type ChatRequest = { messages: ChatMessage[]; sessionId: string };

export const handler = awslambda.streamifyResponse(async (event: LambdaFunctionURLEvent, responseStream) => {
  const open = (statusCode: number) =>
    awslambda.HttpResponseStream.from(responseStream, {
      statusCode,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });

  try {
    await verifier.verify(bearerToken(event));
  } catch {
    open(401).end('Unauthorized');
    return;
  }

  let request: ChatRequest;
  try {
    request = parseRequest(event);
  } catch (err) {
    open(400).end((err as Error).message);
    return;
  }

  // From here the status code is already sent as 200. An error halfway
  // through can only be reported inside the body.
  const out = open(200);
  try {
    if (AGENT_RUNTIME_ARN) await streamFromAgent(request, out);
    else await streamFromModel(request, out);
  } catch (err) {
    console.error(err);
    out.write('\n\n[The model call failed. Check the Lambda logs.]');
  }
  out.end();
});

function bearerToken(event: LambdaFunctionURLEvent): string {
  const header = event.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) throw new Error('Missing bearer token');
  return header.slice('Bearer '.length);
}

function parseRequest(event: LambdaFunctionURLEvent): ChatRequest {
  const raw = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : (event.body ?? '');
  const body = JSON.parse(raw || '{}') as Partial<ChatRequest>;
  const { messages, sessionId } = body;

  if (!Array.isArray(messages) || messages.length === 0) throw new Error('messages must be a non-empty array');
  if (messages.length > MAX_MESSAGES) throw new Error(`Send at most ${MAX_MESSAGES} messages`);
  messages.forEach((m, i) => {
    // Bedrock requires user, assistant, user, ... starting and ending with user.
    const expected = i % 2 === 0 ? 'user' : 'assistant';
    if (m?.role !== expected) throw new Error(`messages[${i}].role must be "${expected}"`);
    if (typeof m.text !== 'string' || !m.text.trim()) throw new Error(`messages[${i}].text must be a non-empty string`);
    if (m.text.length > MAX_CHARS) throw new Error(`messages[${i}].text is over ${MAX_CHARS} characters`);
  });
  if (messages.length % 2 === 0) throw new Error('The last message must come from the user');

  // AgentCore requires session IDs between 33 and 256 characters.
  if (typeof sessionId !== 'string' || sessionId.length < 33 || sessionId.length > 256) {
    throw new Error('sessionId must be 33-256 characters');
  }
  return { messages, sessionId };
}

async function streamFromModel({ messages }: ChatRequest, out: Writable) {
  const response = await bedrock.send(
    new ConverseStreamCommand({
      modelId: MODEL_ID,
      system: [{ text: 'You are a helpful assistant. Keep answers short and clear.' }],
      messages: messages.map((m) => ({ role: m.role, content: [{ text: m.text }] })),
      inferenceConfig: { maxTokens: MAX_OUTPUT_TOKENS },
    }),
  );
  for await (const chunk of response.stream ?? []) {
    const text = chunk.contentBlockDelta?.delta?.text;
    if (text) out.write(text);
  }
}

// The lab's agents take {"prompt": "..."} (see math_client.py). The agent keeps
// its own memory per session, so only the latest message is sent.
async function streamFromAgent({ messages, sessionId }: ChatRequest, out: Writable) {
  const response = await agentcore.send(
    new InvokeAgentRuntimeCommand({
      agentRuntimeArn: AGENT_RUNTIME_ARN,
      runtimeSessionId: sessionId,
      contentType: 'application/json',
      accept: 'text/event-stream, application/json',
      payload: new TextEncoder().encode(JSON.stringify({ prompt: messages[messages.length - 1].text })),
    }),
  );
  if (!response.response) return;

  // An agent whose entrypoint yields chunks answers with Server-Sent Events.
  // One that returns a single value answers with JSON.
  if (!response.contentType?.includes('text/event-stream')) {
    out.write(asText(await response.response.transformToString()));
    return;
  }
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const bytes of response.response as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(bytes, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('data: ')) out.write(asText(line.slice('data: '.length)));
    }
  }
}

function asText(raw: string): string {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return raw;
  }
}
