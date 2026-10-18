<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { currentUserEmail, logOut } from './auth';
import LoginForm from './components/LoginForm.vue';
import ChatView from './components/ChatView.vue';

const email = ref<string | null>(null);
const loading = ref(true);

onMounted(async () => {
  email.value = await currentUserEmail();
  loading.value = false;
});

async function handleLogOut() {
  await logOut();
  email.value = null;
}
</script>

<template>
  <main class="shell">
    <header class="bar">
      <strong>Cloud AI</strong>
      <span v-if="email" class="who">
        {{ email }}
        <button class="link" @click="handleLogOut">Log out</button>
      </span>
    </header>

    <p v-if="loading" class="muted">Loading…</p>
    <LoginForm v-else-if="!email" @logged-in="email = $event" />
    <ChatView v-else />
  </main>
</template>
