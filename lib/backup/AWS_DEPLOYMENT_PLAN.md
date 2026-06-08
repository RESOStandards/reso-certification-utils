# Backup: AWS Deployment

Status: **Deployed + tested in dev account 222014597091 (QA), 2026-06-08.** The shared-engine
design is live: a Lambda **layer** carrying the backup engine, thin Lambda wrappers, and an
**AWS Batch** path for runs that would exceed Lambda's 15-min cap — all dispatched by a
**Step Function** that size-checks first. Both paths were validated end-to-end against certqa:
the Lambda (normal) and Batch (forced-overload) runs each produced an identical 2,503-object /
~134 MB gzipped backup. Daily schedule enabled (`cron(0 3 * * ? *)` = 03:00 UTC). The old
container-image Lambda has been replaced.

## Why the rework

The backup engine should run in two places from one source: **Lambda** for normal runs
(QA = ~6.5 min) and **AWS Batch (Fargate)** for runs too big for Lambda's 15-min wall (prod /
future growth). The engine is shared as a Lambda **layer** (for the Lambda path) and a
**container image** built from the same commit (for the Batch path — Batch can't mount
layers). A Step Function picks the path per-run based on a cheap report count.

## Architecture

```
EventBridge rule (cron: daily)
    |
    v
Step Function  reso-cert-backup-<env>  (STANDARD)
    |
    |-- SizeCheck      Lambda reso-cert-backup-sizecheck-<env>
    |                    counts reports (IDs + lists only, no full downloads)
    |                    -> { reportCount, routeToBatch }   (threshold: REPORT_COUNT_THRESHOLD)
    |
    |-- Choice (routeToBatch?)
    |       |
    |       |-- false -> RunOnLambda   Lambda reso-cert-backup-<env>   (fast path, <15 min)
    |       |
    |       \-- true  -> RunOnBatch    Batch job (Fargate, ARM64, no 15-min cap)
    |                                   submitJob.sync — Step Function waits for completion
    |
    \-- any failure -> NotifyFailure (SNS) -> Fail
```

Both runners call the **same** `runBackup({ url, apiKey, bucket, ... })` from
`lib/backup/runner.js`, which runs `backup()`, gzips, uploads to `s3://<bucket>/<YYYY-MM-DD>/<startMs>/`,
and cleans up. Lambda resolves it from the layer (`@reso/reso-certification-utils/...` on
NODE_PATH); Batch resolves it by relative path inside the image.

## Layout

- `lib/backup/runner.js` — **shared engine**: `runBackup()` (backup + gzip + S3 upload + cleanup) and `uploadDir()`. The only place the S3 logic lives now (it used to be inline in the handler).
- `lib/backup/count.js` — `countReports()` for the size-check; cheap, IDs/lists only.
- `lib/backup/secret.js` — `loadApiKey()` from Secrets Manager, cached per warm container; shared by both Lambdas.
- `lambda/handler.js` — thin backup wrapper; resolves the engine from the layer.
- `lambda/sizecheck.js` — thin size-check wrapper; returns the routing decision.
- `layer/build.sh` — builds the layer content (`layer/build/nodejs/node_modules/...` = prod deps + the engine as `@reso/reso-certification-utils`). Needs git (github dep).
- `batch/entry.js` — Batch container entry; same engine, env-driven, exits non-zero on failure.
- `batch/Dockerfile` — Batch image (`node:22-slim`, arm64), `ENTRYPOINT node batch/entry.js`.
- `statemachine/backup.asl.json` — Step Function definition (size-check → Choice → Lambda | Batch, with SNS failure notify).
- `template.yaml` — SAM template for the whole stack (layer, 2 Lambdas, Batch CE/queue/job-def, state machine, bucket, secret, SNS, alarms).
- `lambda/Dockerfile` — **legacy** container-image Lambda build (the currently-live deploy). Superseded by the layer; kept for reference until the new stack is proven.
- Root `Dockerfile` is a **different** image (bundles CLI + web-api-commander); unrelated.

## Validated numbers (against certqa.reso.org, 2026-04-21 → 2026-04-22)

These are from the container-image Lambda but the engine is unchanged, so they still hold for
the Lambda fast path. They're also what calibrates `REPORT_COUNT_THRESHOLD`.

| Metric | Value |
|---|---|
| Wall-clock (successful run) | **6m 36s** (396s) |
| Cold-start init | ~3s |
| Reports backed up | 1,755 (629 DD + 588 DA + 515 Web API + 23 misc) |
| Total size | ~1.7 GB |
| Peak memory | **2028 MB** on first run, **2048 MB (100%)** on the scheduled cron run — now increased to 3008 MB for headroom |
| Ephemeral /tmp usage | under 2 GB (template allocates 4 GB) |
| Cost per run | ~$0.01 (compute + S3 PUTs + transfer) |

For context, the same backup from a laptop on a typical home connection took 48m41s — the
Lambda is ~7× faster thanks to proximity to QA's hosting region. 1,755 reports ≈ 6.5 min, so
the default `REPORT_COUNT_THRESHOLD=3000` leaves comfortable headroom under 15 min before
routing to Batch.

**2026-06-08 (post-gzip + archived, both runners):** size-check counted 2,546 weighted reports
(630 DD ×2 + 515 WebAPI + 24 other + 747 archived). Each run wrote **2,503 objects / ~134 MB
gzipped** (the ~1.7 GB above was pre-gzip) — Lambda 389 s, Batch (4 vCPU Fargate) 353 s.
Note QA is now ~85% of the 3000 threshold; bump it or deploy/keep Batch as the cushion.

## Deploying the new stack

Region `us-east-1`, `export AWS_PROFILE=reso`.

**1. Build the layer (needs git for the github dep):**
```bash
./layer/build.sh        # -> layer/build/nodejs/node_modules/...
```

**2. (Batch path only) create the ECR repo + service-linked role, then build + push the image:**
```bash
IMAGE=222014597091.dkr.ecr.us-east-1.amazonaws.com/reso-cert-backup-batch:latest
# One-time per account (no-ops if they already exist):
aws ecr create-repository --repository-name reso-cert-backup-batch --region us-east-1 || true
aws iam create-service-linked-role --aws-service-name batch.amazonaws.com || true   # gotcha #7
# Build arm64 with no attestations (gotcha #2), then push:
docker buildx build --provenance=false --sbom=false --platform linux/arm64 --load -f batch/Dockerfile -t "$IMAGE" .
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin ${IMAGE%%/*}
docker push "$IMAGE"
```

**3. Deploy with SAM — `sam deploy`, NOT `sam build`** (the layer/code are pre-built; `sam build`
is also flaky on this macOS, see gotcha #4):
```bash
sam deploy --resolve-s3 --region us-east-1 \
  --stack-name reso-cert-backup-qa \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    Environment=qa \
    BatchImageUri="$IMAGE" \
    VpcSubnetIds="subnet-0056d423ff50d1cb5,subnet-01cc38b885babd719,subnet-0315190f5e72c0a1f,subnet-0c3bc35673f17b958,subnet-008358d78aa355f50,subnet-05e977628e1519172" \
    BatchSecurityGroupIds="sg-098f72131ccea377d"
```
The subnet/SG values above are QA's: the default VPC's 6 public (auto-assign-IP) subnets and
its default SG (`sg-098f72131ccea377d`, all outbound). For another env/account, find equivalents:
```bash
VPC=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
aws ec2 describe-subnets --filters Name=vpc-id,Values=$VPC --query 'Subnets[?MapPublicIpOnLaunch].SubnetId' --output text
aws ec2 describe-security-groups --filters Name=vpc-id,Values=$VPC Name=group-name,Values=default --query 'SecurityGroups[0].GroupId' --output text
```

Omit `BatchImageUri`/`VpcSubnetIds`/`BatchSecurityGroupIds` to deploy **Lambda-only** (the
Batch resources are gated on `BatchImageUri` via the `HasBatchImage` condition; the Step
Function still deploys and always takes the Lambda branch as long as the count stays under
threshold).

**4. Populate the secret (first deploy only):**
```bash
aws secretsmanager put-secret-value --secret-id reso-cert/qa/api-key --secret-string 'ADMIN_API_KEY'
```

### Migrating the live stack (done 2026-06-08)
The live `reso-cert-backup-qa` was a container-image Lambda with the EventBridge schedule on the
function. Migrating to zip+layer changes the function's `PackageType`, which **requires
replacement** — and CloudFormation refuses to replace a resource with an explicit custom name
in place (see gotcha #8). So it took a **two-step deploy**:
1. Deploy a template with `BackupFunction` (+ its alarms and state-machine reference) removed →
   deletes the old function, freeing the name `reso-cert-backup-qa`.
2. Deploy the full `template.yaml` → recreates it as zip+layer with the same name, adds the
   state machine + schedule.

The S3 bucket and secret are `Retain`, so data and the key survived untouched. The schedule
moved off the function onto the Step Function; CloudFormation kept the previously-set
`ScheduleExpression` (`cron(0 3 * * ? *)`), **not** the template default of `cron(0 10 …)` —
pass `ScheduleExpression=` explicitly if you want a different time.

## Gotchas hit and what they tell you

1. **Module-load-time env capture.** `lib/misc/data-access/cert-api-client.js:5` destructures `process.env` at import. If the backup lib is required before `CERTIFICATION_API_KEY` is set, it captures `undefined`. **Fix (now baked into `runner.js` and `count.js`): set env, THEN dynamic-require the lib.** Symptom when broken: run "succeeds" in ~3 min, saves only the ~21 "other" reports, logs 0 for DD/DA/WebAPI.

2. **OCI manifest + attestations break Lambda/Batch images.** Modern `docker buildx` defaults produce OCI index manifests with provenance/SBOM attestations, rejected with "image manifest ... media type ... is not supported". **Fix: build with `--provenance=false --sbom=false --platform linux/arm64 --load`** (applies to the Batch image).

3. **`npm ci --omit=dev` runs the `prepare` script.** The repo's `prepare` runs `lefthook install` (a devDep), which fails outside a git working tree / in CI. **Fix: `npm ci --omit=dev --ignore-scripts`** — used by both `layer/build.sh` and `batch/Dockerfile`.

4. **SAM 1.105 can't find Docker Desktop's socket on newer macOS.** `sam build` fails with "requires Docker. is Docker running?" even when it is. **Workaround: don't use `sam build`.** The layer and function code are pre-built (`layer/build.sh`), so `sam deploy --resolve-s3` just zips and uploads `CodeUri`/`ContentUri`/`DefinitionUri` directly. (SAM CLI 1.161+ also fixes the stale cfn-lint that false-flags `nodejs22.x`.)

5. **`aws lambda invoke` auto-retries on CLI read-timeout.** Default CLI HTTP read timeout is 60s; a 6+ min run times out, boto3 retries, and you get a duplicate backup in S3. **For manual long runs use `--invocation-type Event`** (or raise `--cli-read-timeout`). Prefer driving runs through the Step Function instead.

6. **Admin-tier API key is required.** Non-admin keys pass `/api/v1/certification_reports/filter` (public) but fail on `/full/:type/:id` (admin). Symptom is identical to #1 — diagnose via the CloudWatch stats object showing `ddReportsCount > 0` but `data_dictionary: 0`.

7. **Batch (Fargate) networking.** The job pulls from ECR and reaches the Cert API + S3 over the internet. Use **public** subnets with `AssignPublicIp: ENABLED` (set in the job def), or private subnets behind a NAT. The security group needs outbound 443. First Batch use in an account may require the `AWSServiceRoleForBatch` service-linked role (created automatically, or `aws iam create-service-linked-role --aws-service-name batch.amazonaws.com`).

8. **Image→zip Lambda migration needs a 2-step deploy.** Changing a function's `PackageType` (container image → zip) requires replacement, and CloudFormation won't replace a **custom-named** resource in place ("cannot update a stack when a custom-named resource requires replacing. Rename ... and update the stack again"). **Fix: delete the function in one deploy, recreate it in the next** — see "Migrating the live stack". Only matters for that one-time migration; ongoing code changes don't alter `PackageType`.

9. **Fargate doesn't set `AWS_REGION` in the container** (Lambda does). `secret.js`/`runner.js` build the Secrets Manager and S3 clients with `region: process.env.AWS_REGION`, so without it the calls fail with "Region is missing". **Fix: the Batch job def sets `AWS_REGION` explicitly (`Value: !Ref AWS::Region`).** Symptom when broken: the Batch job starts, then dies before any report is fetched.

## Operational runbook

**Run on demand (preferred — exercises the real dispatch):**
```bash
aws stepfunctions start-execution --state-machine-arn <StateMachineArn-from-stack-output>
```

**Redeploy after a code change** — rebuild the layer (and Batch image if changed), then `sam deploy` (steps 1–3 above). A pure-code change to the engine needs a fresh layer build; a change to only `lambda/*.js` does not.

**Tune the Lambda↔Batch cutover:** change `REPORT_COUNT_THRESHOLD` (no code change). If the duration alarm fires persistently, lower it so heavier runs go to Batch.

**Disable the schedule temporarily:**
```bash
aws events disable-rule --name "$(aws events list-rule-names-by-target \
  --target-arn <StateMachineArn> --query 'RuleNames[0]' --output text)"
```

**Rotate the API key:**
```bash
aws secretsmanager put-secret-value --secret-id reso-cert/qa/api-key --secret-string 'NEW_KEY'
```
The key is cached in-memory per warm container; force a cold start (update an env var) to pick up the new value immediately.

## Known gaps / not in scope

- **No failure alerting wired up.** The Step Function publishes to the SNS topic on failure and `BackupErrorsAlarm` watches the Lambda — but the topic has **no subscribers**, and the alarm doesn't cover the Batch/Step-Function path. A failed *scheduled* run currently notifies no one. Subscribe before relying on it: redeploy with `AlertEmail=you@…`, or `aws sns subscribe --topic-arn <AlertTopicArn> --protocol email --notification-endpoint you@…`.
- **Scheduled trigger not yet observed.** Both validation runs were started manually; the `cron(0 3 UTC)` rule is enabled but its first automatic firing hasn't been watched yet.
- **Restore from S3** — `restore --restoreFromBackup` still reads from local disk; an S3-aware variant would need a separate change.
- **Prod env** — deploy the stack with `Environment=prod` after QA is confirmed.
- **Size-check accuracy** — the count weights DD reports ×2 (each drives a DD + DA fetch); it's a heuristic for routing, not an exact runtime predictor. Revisit the threshold against real prod counts.
- **RESO AWS account migration** — per Josh, to be scoped after the dev-account setup is proven out.
- **Hardening** — secret rotation, KMS CMK on secret + SNS, S3 access logging (all low priority / Information severity).
