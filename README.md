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

All of it is defined in `template.yaml`. GitHub Actions deploys it on every push to `main`.

| Path | What it is |
|---|---|
| `template.yaml` | The app stack: Cognito, Lambda, S3, CloudFront |
| `infra/github-deploy-role.yaml` | One-time bootstrap that lets GitHub Actions deploy to your account |
| `infra/lab-roles.yaml` | The lab's step 7 IAM roles, with the PDF's bugs fixed |
| `.github/workflows/` | `pipeline.yml` checks and deploys; `teardown.yml` deletes |
| `backend/` | The Lambda, in TypeScript |
| `frontend/` | The Vue app |
| `scripts/` | Publish the frontend, add users, tear down from your laptop |

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
- **Lambda logs**: in the Lambda console, open the `cloud-ai-ChatFunction-…` function → **Monitor** → **View CloudWatch logs**. Every `console.error` and stack trace lands there.
- **The pipeline run**: the repo's **Actions** tab shows each step's output. A failed `Deploy the stack` step prints the CloudFormation error.
- **CloudFormation events**: if a deploy fails, the console's stack **Events** tab shows the first resource that failed. Read the first red line, since the later ones are fallout.

### 8. CI/CD without stored keys

The pipeline holds no AWS keys. Each run asks GitHub for a signed token that says "this is `EzekielMojica/cloud-ai`, branch `main`". The token names the repo by its numeric ID as well as its name (`repo:EzekielMojica@26315001/cloud-ai@1424121947:ref:refs/heads/main`), because GitHub switched new repos to that format in July 2026. If the trust policy expects the old name-only format, you get "Not authorized to perform sts:AssumeRoleWithWebIdentity". AWS checks the token against the OIDC provider you already have from `terraform-lab`, then hands out credentials for one hour. A leaked log or a fork has nothing to steal.

The pipeline uses two roles (see the diagram at the top of `infra/github-deploy-role.yaml`):

- **`cloud-ai-github-deploy`** is what GitHub gets. It can run CloudFormation on the `cloud-ai` stack, upload code and publish the frontend, and nothing else.
- **`cloud-ai-cfn-exec`** is what CloudFormation uses to build the resources. It's an admin role, but only CloudFormation can assume it.

That split is the same one `cdk bootstrap` creates. It has one hole you should know about: whoever can push to `main` can edit the template, and CloudFormation will build whatever it says. Pushing to `main` means deploying, so turn on branch protection once anyone else gets write access.

Pull requests run the checks without AWS credentials, so a pull request can't deploy anything or read your account.

### What you can let AI handle

YAML syntax, SDK call shapes, the esbuild config, CSS, and bash glue. Check the result against the concepts above instead of memorising it.

---

## One-time setup

The pipeline builds and deploys for you, so the laptop setup is only for running the frontend locally and adding logins.

**1. Fix your AWS credentials.** `~/.aws/credentials` on this Mac has an access key without a secret, so every AWS command fails right now. Pick one of these:

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

**2. Check you can call Nova 2 Lite** (step 3 of the lab PDF covers this):

```bash
aws bedrock-runtime converse --region us-east-1 \
  --model-id us.amazon.nova-2-lite-v1:0 \
  --messages '[{"role":"user","content":[{"text":"Say hi"}]}]'
```

**3. Install the frontend packages.**

```bash
(cd frontend && npm install)
```

---


## First deploy

You do steps 1 to 3 once, in the AWS console and on GitHub. After that, every push to `main` deploys.

Before you start, sign in to your **personal** AWS account. Check the account ID in the top-right menu, and set the region selector next to it to **US East (N. Virginia) us-east-1**.

**1. Create the lab roles** (replaces step 7 of the PDF)

1. Open **CloudFormation** → **Create stack** → **With new resources (standard)**.
2. Choose **Upload a template file**, pick `infra/lab-roles.yaml`, then **Next**.
3. Stack name: `cloud-ai-lab-roles`. **Next**, then **Next** again.
4. Tick **I acknowledge that AWS CloudFormation might create IAM resources with custom names**, then **Submit**.
5. Wait for `CREATE_COMPLETE`.

If you already ran step 7 in CloudShell, this fails with "already exists". Delete the three `Demo…Role` roles in the IAM console, then delete the failed stack and try again.

**2. Create the pipeline's roles** (the bootstrap)

1. Same as above, but upload `infra/github-deploy-role.yaml` and name the stack `cloud-ai-bootstrap`.
2. On the parameters page, leave **CreateOidcProvider** set to `false`. Your account already has the GitHub provider from `terraform-lab`, and an account can hold only one.
3. Tick the IAM acknowledgement and **Submit**.
4. When it shows `CREATE_COMPLETE`, open the **Outputs** tab and copy **DeployRoleArn**.

**3. Give the ARN to GitHub**

1. Open https://github.com/EzekielMojica/cloud-ai → **Settings** → **Secrets and variables** → **Actions**.
2. **New repository secret**. Name: `AWS_DEPLOY_ROLE_ARN`. Value: the ARN you copied. **Add secret**.

It's a secret rather than a variable because it contains your account ID, and the logs of a public repo are public.

**4. Run the pipeline**

Go to the **Actions** tab → **Pipeline** → **Run workflow** → **Run workflow**. (Any push to `main` does the same.) The first run takes about 6 minutes, mostly waiting for CloudFront. The last step prints the site URL.

Before step 3 is done, the pipeline still runs its checks and skips the deploy with a notice instead of failing.

**5. Create logins** for yourself and your teacher

1. Open **Cognito** → **User pools** → `cloud-ai-users` → **Users** → **Create user**.
2. **Invitation message:** **Don't send an invitation**. You'll pass the password on yourself.
3. **Email address:** the person's email. Tick **Mark email address as verified**.
4. **Temporary password:** **Set a password**, and use at least 12 characters.
5. **Create user**.

The first time someone logs in, the site asks them to choose their own password, and the temporary one stops working. Send your teacher the site URL and the temporary password separately.

With a working AWS CLI, `scripts/create-user.sh teacher@school.edu` sets a permanent password instead, so that person skips the new-password step.

The pipeline doesn't create users, because it would need the passwords.

---

## Local development

```bash
scripts/write-env.sh     # once, after the first deploy
cd frontend && npm run dev
```

Open http://localhost:5173. Your local frontend talks to the real Lambda in AWS, which already allows that origin.

To ship a change, commit and push to `main`. Open a pull request first if you want the checks to run before it deploys.

---

## Plug in your AgentCore agent

By default the Lambda calls Nova 2 Lite directly. Once you've done the AgentCore exercise and run `agentcore deploy`, copy the agent ARN it prints. Add it as a second repository secret named `AGENT_RUNTIME_ARN`, then run the pipeline again.

The Lambda then sends `{"prompt": "..."}` to your agent, the same payload as the lab's `math_client.py`. It also passes the browser's session ID, so the agent keeps context across messages. To switch back to the plain model, delete the secret and run the pipeline again.

---

## Tear down

Do this when the lab is graded.

1. **App stack:** **Actions** tab → **Teardown** → **Run workflow** → type `DELETE`.
2. **Bootstrap:** in CloudFormation, the `cloud-ai-artifacts-…` bucket has to be empty first. Open it in S3 and choose **Empty**, then delete the `cloud-ai-bootstrap` stack.
3. **Lab roles:** delete the `cloud-ai-lab-roles` stack.
4. **Agents:** run `agentcore destroy --agent <agent name>` for each agent you deployed.

Delete them in that order. The pipeline needs the bootstrap roles to delete the app stack.

Open the Billing console the next day and check nothing is still running.
