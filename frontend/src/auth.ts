import { Amplify } from 'aws-amplify';
import { confirmSignIn, fetchAuthSession, getCurrentUser, signIn, signOut } from 'aws-amplify/auth';

// These values come from the stack outputs. scripts/write-env.sh writes them
// to .env.local. None of them are secrets: anyone can read them in the bundle.
const { VITE_USER_POOL_ID, VITE_USER_POOL_CLIENT_ID } = import.meta.env;
if (!VITE_USER_POOL_ID || !VITE_USER_POOL_CLIENT_ID) {
  throw new Error('Missing Cognito config. Run scripts/write-env.sh after deploying the stack.');
}

Amplify.configure({
  Auth: { Cognito: { userPoolId: VITE_USER_POOL_ID, userPoolClientId: VITE_USER_POOL_CLIENT_ID } },
});

export async function currentUserEmail(): Promise<string | null> {
  try {
    const user = await getCurrentUser();
    return user.signInDetails?.loginId ?? user.username;
  } catch {
    return null;
  }
}

// 'done' means signed in. 'new-password' means the account still has the
// temporary password it was created with (the Cognito console only sets
// temporary ones), so the user must choose a new password first.
export type LogInResult = 'done' | 'new-password';

export async function logIn(email: string, password: string): Promise<LogInResult> {
  const { isSignedIn, nextStep } = await signIn({ username: email, password });
  if (isSignedIn) return 'done';
  if (nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') return 'new-password';
  throw new Error(`Login needs a step this app doesn't support: ${nextStep.signInStep}`);
}

// Finishes the login that logIn() started, using the password the user chose.
export async function setNewPassword(newPassword: string): Promise<void> {
  const { isSignedIn, nextStep } = await confirmSignIn({ challengeResponse: newPassword });
  if (!isSignedIn) throw new Error(`Login needs a step this app doesn't support: ${nextStep.signInStep}`);
}

export const logOut = () => signOut();

// Amplify refreshes the access token on its own when it expires.
export async function accessToken(): Promise<string> {
  const token = (await fetchAuthSession()).tokens?.accessToken?.toString();
  if (!token) throw new Error('Not signed in');
  return token;
}
