<script setup lang="ts">
import { ref } from 'vue';
import { logIn } from '../auth';

const emit = defineEmits<{ 'logged-in': [email: string] }>();

const email = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);

async function submit() {
  error.value = '';
  busy.value = true;
  try {
    await logIn(email.value, password.value);
    emit('logged-in', email.value);
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form class="card login" @submit.prevent="submit">
    <h1>Log in</h1>
    <label>
      Email
      <input v-model="email" type="email" autocomplete="username" required />
    </label>
    <label>
      Password
      <input v-model="password" type="password" autocomplete="current-password" required />
    </label>
    <p v-if="error" class="error">{{ error }}</p>
    <button type="submit" :disabled="busy">{{ busy ? 'Logging in…' : 'Log in' }}</button>
  </form>
</template>
