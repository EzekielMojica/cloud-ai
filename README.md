# Cloud AI

A chat app for the COP Cloud AI S2 lab. It runs without Streamlit, CloudShell or ngrok.

```
Browser
  │  https://xxxx.cloudfront.net
  ▼
CloudFront ──► S3 bucket (private)        Vue app: frontend/
  │
  │  POST + Cognito access token
  ▼
Lambda function URL (streaming)           backend/src/handler.ts
  │  checks the token, then calls ▼ using its IAM role
  ▼
Bedrock (Nova 2 Lite)  or  your AgentCore agent
```

All of it is defined in `template.yaml`. One command creates it and one deletes it.

| Path | What it is |
|---|---|
| `template.yaml` | The app stack: Cognito, Lambda, S3, CloudFront |
| `infra/lab-roles.yaml` | The lab's step 7 IAM roles, with the PDF's bugs fixed |
| `backend/` | The Lambda, in TypeScript |
| `frontend/` | The Vue app |
| `scripts/` | Deploy, add users, tear down |

---

## What you must know

These ideas come up every time you build on AWS. Learn them properly. AI can write the YAML and the SDK calls for you, but it can't tell when an architecture is wrong unless you can.

### 1. IAM: who can do what to which resource

Every AWS call answers three questions: who is asking (the **principal**), what they want to do (the **action**, like `bedrock:InvokeModelWithResponseStream`), and what they want to do it to (the **resource**, an ARN).

A **role** has two policies, and mixing them up causes most beginner errors:

- The **trust policy** says who may *become* the role. In `infra/lab-roles.yaml`, `DemoRuntimeRole` trusts `bedrock-agentcore.amazonaws.com`, so only AgentCore can use it.
- The **permission policy** says what the role may do once someone has it.

When you hit `AccessDenied`, read the message. It names the principal, the action and the resource, and one of the three is wrong. Don't fix it by granting `*`.

In this repo: `ChatFunction` → `Policies` in `template.yaml` grants exactly one Bedrock action on one model.

### 2. CloudFormation: describe what you want, AWS works out how

A **template** lists resources. A **stack** is one deployed copy of a template. Deploying again compares the template with the stack and changes only what differs.

- **Change things through the template only.** If you edit a resource in the console, the stack no longer matches reality (this is called drift), and the next deploy can undo your change or fail.
- **Delete the stack to clean up.** It removes everything it created, in the right order. This is why the lab's step 7 is better as a template.
- **`!Ref`, `!GetAtt` and `!Sub`** connect resources. For example, `!Sub "${AWS::AccountId}"` puts in your real account ID, which the PDF's commands failed to do.
- **SAM** is CloudFormation plus shorthand. `AWS::Serverless::Function` expands into a Lambda, an IAM role and a function URL. `sam build` bundles your code and `sam deploy` uploads it.

### 3. Regions, ARNs and inference profiles

Almost everything lives in one region. This project uses `us-east-1`. A `ResourceNotFound` error usually means your code is looking in the wrong region, as the lab PDF's tips warn.

The `us.` in `us.amazon.nova-2-lite-v1:0` makes it an **inference profile**: Bedrock may run your request in any US region that has capacity. So IAM needs permission on the profile *and* on the model in every region it can route to. That's why `template.yaml` lists both, with `*` in the model ARN's region field.

### 4. Never put AWS credentials in the browser

Anything in your frontend bundle is public. The Cognito IDs in `.env.local` are safe to expose, since they're addresses, not keys. The Lambda holds the real power through its IAM role, and it only acts for requests that carry a valid token.

The login flow:

1. The browser sends the email and password to Cognito (Amplify handles this in `frontend/src/auth.ts`).
2. Cognito returns a signed **access token** (a JWT) that expires after an hour. Amplify renews it.
3. The frontend sends the token as `Authorization: Bearer …` (`frontend/src/api.ts`).
4. The Lambda checks the signature against Cognito's public keys before doing anything (`backend/src/handler.ts`, top of the handler).

The function URL is set to `AuthType: NONE`, which means AWS lets every request reach your code. Step 4 is the real lock. Remove it and anyone with the URL can spend your money.

### 5. Lambda remembers nothing between calls

Each request might hit a fresh copy of the function. Anything a later request needs has to travel with the request or live somewhere else, such as DynamoDB or AgentCore Memory. That's why the frontend sends the whole chat history every time.

The timeout here is 5 minutes. Response streaming (writing the answer as it arrives) only works natively in the Node.js runtime, which is why this Lambda is TypeScript even though the lab is Python. The lab's Python agent still runs in AgentCore, and this Lambda just calls it.

### 6. Know what costs money

| Thing | Cost at lab scale |
|---|---|
| Bedrock tokens | The only real cost. Nova 2 Lite is cheap, but a looping agent adds up |
| AgentCore Runtime | Billed while your agent runs |
| Lambda, Cognito, S3, CloudFront | Free tier covers it |

This stack doesn't create a budget alert, because your account already has a $1 one. Each AWS budget is separate and watches the whole account, so a second one would only send duplicate emails. Billing data lags by hours, so a budget warns you after the fact and won't stop anything. When you finish the lab, run the teardown steps at the bottom.

### 7. Where to look when it breaks

- **The browser's Network tab**: did the request leave, and what status came back? `401` is auth, `400` is a bad request body, and a CORS error means the origin isn't in `Cors.AllowOrigins`.
- **Lambda logs**: `sam logs --stack-name cloud-ai --tail` shows `console.error` output and stack traces live.
- **CloudFormation events**: if a deploy fails, the console's stack **Events** tab shows the first resource that failed. Read the first red line, since the later ones are fallout.

### What you can let AI handle

YAML syntax, SDK call shapes, the esbuild config, CSS, and bash glue. Check the result against the concepts above instead of memorising it.

---

## One-time setup

**1. Install the SAM CLI.**

```bash
brew install aws-sam-cli
sam --version
```

**2. Fix your AWS credentials.** `~/.aws/credentials` on this Mac has an access key without a secret, so every AWS command fails right now. Pick one of these:

- **IAM Identity Center (recommended).** It's free. Enable it in the console, create a user with the `AdministratorAccess` permission set for your account, then run:
  ```bash
  aws configure sso          # name the profile "cloud-ai"
  export AWS_PROFILE=cloud-ai
  aws sso login              # run again whenever the session expires
  ```
  Remove or fix the broken `[default]` block in `~/.aws/credentials` so it doesn't get in the way.
- **IAM user access keys.** Run `aws configure` and paste both the key ID and the secret. Delete the keys when the course ends.

Check it works:

```bash
aws sts get-caller-identity
```

**3. Check you can call Nova 2 Lite** (step 3 of the lab PDF covers this):

```bash
aws bedrock-runtime converse --region us-east-1 \
  --model-id us.amazon.nova-2-lite-v1:0 \
  --messages '[{"role":"user","content":[{"text":"Say hi"}]}]'
```

**4. Install packages.**

```bash
(cd backend && npm install)
(cd frontend && npm install)
```

---

## Deploy

All commands run from this folder.

**1. Lab roles** (replaces step 7 of the PDF):

```bash
aws cloudformation deploy --region us-east-1 \
  --template-file infra/lab-roles.yaml \
  --stack-name cloud-ai-lab-roles \
  --capabilities CAPABILITY_NAMED_IAM
```

If you already ran step 7 in CloudShell, the roles exist and this fails with "already exists". Delete those three roles in the IAM console first.

**2. App stack:**

```bash
sam build
sam deploy --guided
```

The guided deploy asks a few questions and saves your answers to `samconfig.toml`. From then on, `sam build && sam deploy` is enough.

- Stack name: `cloud-ai`
- Region: `us-east-1`
- Leave the parameters at their defaults
- "ChatFunction Function Url has no authentication. Is this okay?" → `y`. The handler checks the token itself (see "What you must know", #4).
- Accept the defaults for the rest

The first deploy takes about 5 minutes, mostly waiting for CloudFront.

**3. Create logins** for yourself and your teacher:

```bash
scripts/create-user.sh you@example.com
scripts/create-user.sh teacher@school.edu
```

**4. Publish the frontend:**

```bash
scripts/deploy-frontend.sh
```

It prints the site URL. Open it and log in.

---

## Local development

```bash
scripts/write-env.sh     # once, after the stack exists
cd frontend && npm run dev
```

Open http://localhost:5173. Your local frontend talks to the real Lambda in AWS, which already allows that origin.

After changing the backend, run `sam build && sam deploy`. After changing the frontend, run `scripts/deploy-frontend.sh`.

---

## Plug in your AgentCore agent

By default the Lambda calls Nova 2 Lite directly. Once you've done the AgentCore exercise and run `agentcore deploy`, copy the agent ARN it prints. Open `samconfig.toml` and set `AgentRuntimeArn` in the `parameter_overrides` line:

```toml
parameter_overrides = "ModelId=\"us.amazon.nova-2-lite-v1:0\" FoundationModelId=\"amazon.nova-2-lite-v1:0\" AgentRuntimeArn=\"arn:aws:bedrock-agentcore:us-east-1:...:runtime/...\""
```

Then run `sam build && sam deploy`. Editing the file keeps your other parameters. Passing `--parameter-overrides` on the command line would replace them all.

The Lambda then sends `{"prompt": "..."}` to your agent, the same payload as the lab's `math_client.py`. It also passes the browser's session ID, so the agent keeps context across messages. To switch back, set `AgentRuntimeArn=\"\"` and deploy again.

---

## Tear down

Do this when the lab is graded.

```bash
scripts/destroy.sh                                              # app stack
aws cloudformation delete-stack --stack-name cloud-ai-lab-roles --region us-east-1
agentcore destroy --agent <agent name>                          # for each agent you deployed
```

Then open the Billing console the next day and check nothing is still running.
