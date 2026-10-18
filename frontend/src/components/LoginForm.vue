<script setup lang="ts">
import { computed, ref } from 'vue';
import { logIn, setNewPassword } from '../auth';

const emit = defineEmits<{ 'logged-in': [email: string] }>();

// Matches PasswordPolicy.MinimumLength in template.yaml.
const MIN_PASSWORD_LENGTH = 12;

const step = ref<'log-in' | 'new-password'>('log-in');
const email = ref('');
const password = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const error = ref('');
const busy = ref(false);

const mismatch = computed(() => confirmPassword.value !== '' && newPassword.value !== confirmPassword.value);

async function submitLogIn() {
  await run(async () => {
    if ((await logIn(email.value, password.value)) === 'done') emit('logged-in', email.value);
    else step.value = 'new-password';
  });
}

async function submitNewPassword() {
  if (newPassword.value !== confirmPassword.value) return;
  await run(async () => {
    await setNewPassword(newPassword.value);
    emit('logged-in', email.value);
  });
}

async function run(action: () => Promise<void>) {
  error.value = '';
  busy.value = true;
  try {
    await action();
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form v-if="step === 'log-in'" class="card login" @submit.prevent="submitLogIn">
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

  <form v-else class="card login" @submit.prevent="submitNewPassword">
    <h1>Choose a new password</h1>
    <p class="muted">You logged in with a temporary password. Pick your own to finish.</p>
    <!-- Lets password managers save the new password against this email. -->
    <input type="email" :value="email" autocomplete="username" hidden readonly />
    <label>
      New password
      <input
        v-model="newPassword"
        type="password"
        autocomplete="new-password"
        :minlength="MIN_PASSWORD_LENGTH"
        required
      />
    </label>
    <label>
      Confirm new password
      <input v-model="confirmPassword" type="password" autocomplete="new-password" required />
    </label>
    <p class="muted">At least {{ MIN_PASSWORD_LENGTH }} characters.</p>
    <p v-if="mismatch" class="error">The passwords don't match.</p>
    <p v-if="error" class="error">{{ error }}</p>
    <button type="submit" :disabled="busy || mismatch">{{ busy ? 'Saving…' : 'Save and log in' }}</button>
  </form>
</template>
