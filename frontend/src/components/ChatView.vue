<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { streamChat, type ChatMessage } from '../api';

// One session per page load. AgentCore uses it to keep the agent's memory
// for this conversation. It must be at least 33 characters; a UUID is 36.
const sessionId = crypto.randomUUID();

const messages = ref<ChatMessage[]>([]);
const draft = ref('');
const sending = ref(false);
const failed = ref(false);
const log = ref<HTMLElement | null>(null);

async function send() {
  const text = draft.value.trim();
  if (!text || sending.value) return;

  draft.value = '';
  failed.value = false;
  sending.value = true;
  messages.value.push({ role: 'user', text });
  const history = messages.value.slice();
  const reply = { role: 'assistant' as const, text: '' };
  messages.value.push(reply);
  const index = messages.value.length - 1;

  try {
    await streamChat(history, sessionId, (chunk) => {
      messages.value[index].text += chunk;
      scrollToBottom();
    });
  } catch (err) {
    failed.value = true;
    // Drop the failed turn so the history keeps alternating user/assistant.
    messages.value.splice(index - 1, 2);
    draft.value = text;
    console.error(err);
  } finally {
    sending.value = false;
  }
}

async function scrollToBottom() {
  await nextTick();
  log.value?.scrollTo({ top: log.value.scrollHeight });
}
</script>

<template>
  <section class="card chat">
    <div ref="log" class="log">
      <p v-if="!messages.length" class="muted">Ask anything to start.</p>
      <div v-for="(m, i) in messages" :key="i" :class="['msg', m.role]">
        {{ m.text || '…' }}
      </div>
    </div>
    <p v-if="failed" class="error">That request failed. Your message is back in the box; check the console and try again.</p>
    <form class="composer" @submit.prevent="send">
      <input v-model="draft" placeholder="Type a message" :disabled="sending" maxlength="4000" />
      <button type="submit" :disabled="sending || !draft.trim()">Send</button>
    </form>
  </section>
</template>
