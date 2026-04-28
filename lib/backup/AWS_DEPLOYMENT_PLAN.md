# Backup: AWS Deployment

Status: **deployed to dev account 222014597091 (QA env), schedule firing daily.**

Runs `reso-certification-utils backup` against `certqa.reso.org` on a daily EventBridge cron, uploads the result to S3. Container-image Lambda — no code changes to the backup lib itself, just a wrapper.

## Validated numbers (against certqa.reso.org, 2026-04-21 → 2026-04-22)

| Metric | Value |
|---|---|
| Wall-clock (successful run) | **6m 36s** (396s) |
| Cold-start init | ~3s |
| Reports backed up | 1,755 (629 DD + 588 DA + 515 Web API + 23 misc) |
| Total size | ~1.7 GB |
| Peak memory | **2028 MB** on first run, **2048 MB (100%)** on the scheduled cron run — now increased to 3008 MB for headroom |
| Ephemeral /tmp usage | under 2 GB (template allocates 4 GB) |
| Cost per run | ~$0.01 (compute + S3 PUTs + transfer) |

For context, the same backup from a laptop on a typical home connection took 48m41s — the Lambda is ~7× faster thanks to proximity to QA's hosting region.

## Deployed resources (CloudFormation stack `reso-cert-backup-qa`)

| Logical | Physical | Notes |
|---|---|---|
| S3 bucket | `reso-cert-backups-qa-222014597091` | SSE-S3, versioning on, Retain, Glacier @ 30d, expire @ 365d |
| Secret | `reso-cert/qa/api-key` | admin-tier key populated via `aws secretsmanager put-secret-value` after first deploy |
| ECR repo | `reso-cert-backup` | created out-of-band by `aws ecr create-repository` |
| Lambda | `reso-cert-backup-qa` | container image (arm64), 3 GB memory, 4 GB /tmp, 15-min timeout |
| EventBridge rule | `reso-cert-backup-qa-BackupFunctionDaily-*` | `cron(0 3 * * ? *)` = 03:00 UTC daily |
| Alarms | `reso-cert-backup-errors-qa`, `reso-cert-backup-duration-qa` | publish to SNS `reso-cert-backup-alerts-qa` |

## Architecture

```
EventBridge rule (cron: daily 03:00 UTC)
    |
    v
Lambda reso-cert-backup-qa (container image, Node 22 arm64, 15-min timeout)
    |-- loads CERTIFICATION_API_KEY from Secrets Manager (cached across warm invokes)
    |-- requires ../lib/backup AFTER env is set (see below)
    |-- runs backup({ url, pathToBackup: '/tmp' })
    |-- uploads /tmp/reso-server-backup/** to s3://<bucket>/<YYYY-MM-DD>/<startMs>/
    v
CloudWatch Logs + Errors/Duration alarms -> SNS
```

## Layout

- `lambda/handler.js` — Lambda entry. Fetches secret, sets `process.env`, then dynamic-requires the backup lib. Uploads the output tree to S3 with bounded concurrency.
- `lambda/Dockerfile` — multi-stage: `node:22-slim` builds deps (needs git for the github dep), `public.ecr.aws/lambda/nodejs:22` is the runtime.
- `template.yaml` — SAM template for the full stack.
- Root `Dockerfile` is a **different** image (bundles CLI + web-api-commander); unrelated.

## Gotchas hit and what they tell you

1. **Module-load-time env capture.** `lib/misc/data-access/cert-api-client.js:5` destructures `process.env` at import. If you `require('../lib/backup')` at top of the handler, it captures `CERTIFICATION_API_KEY` as `undefined` before Secrets Manager ever runs. **Fix: dynamic require inside the handler, after env is populated.** Symptom when broken: run "succeeds" in ~3 min, paginates all report IDs, saves only the 21 "other" reports attached to the filter response, and logs 0 for DD/DA/WebAPI.

2. **OCI manifest + attestations break Lambda.** Modern `docker buildx` defaults produce OCI index manifests with provenance/SBOM attestations. Lambda rejects those with "image manifest ... media type ... is not supported". **Fix: build with `--provenance=false --sbom=false --platform linux/arm64 --load`.**

3. **`npm ci --omit=dev` runs `prepare` script.** Repo's `prepare` runs `lefthook install` for git hooks, which fails in a container because `lefthook` is a devDep. **Fix: `npm ci --omit=dev --ignore-scripts`.**

4. **SAM 1.105 can't find Docker Desktop's socket on newer macOS.** `sam build` fails with "requires Docker. is Docker running?" even when it is. **Workaround: bypass `sam build` entirely — `docker build` + manual `docker push` to ECR + `sam deploy --image-repository ... --parameter-overrides ImageUri=...`.** The template uses an `ImageUri` parameter and no `Metadata` build block, so SAM just references the ECR image.

5. **`aws lambda invoke` auto-retries on CLI read-timeout.** Default CLI HTTP read timeout is 60s; Lambda runs for 6+ min → CLI times out, boto3 retries, you get a duplicate invocation writing a duplicate backup to S3. **For manual long-running invocations use `--invocation-type Event` (fire-and-forget) or raise `--cli-read-timeout` AND the underlying HTTP client timeout.**

6. **Admin-tier API key is required.** Non-admin keys pass `/api/v1/certification_reports/filter` (public middleware) but fail on `/full/:type/:id` (admin middleware). Symptom is identical to #1 — good to diagnose via the CloudWatch log stats object which shows `ddReportsCount > 0` but `data_dictionary: 0`.

## Operational runbook

**Redeploy after code change:**
```bash
export AWS_PROFILE=reso
docker buildx build --provenance=false --sbom=false --platform linux/arm64 --load -f lambda/Dockerfile -t reso-cert-backup:local .
IMAGE=222014597091.dkr.ecr.us-east-1.amazonaws.com/reso-cert-backup:latest
docker tag reso-cert-backup:local "$IMAGE"
aws ecr get-login-password | docker login --username AWS --password-stdin ${IMAGE%%/*}
docker push "$IMAGE"
aws lambda update-function-code --function-name reso-cert-backup-qa --image-uri "$IMAGE"
```

**Manual test invoke (async, safe for long runs):**
```bash
aws lambda invoke --function-name reso-cert-backup-qa --invocation-type Event /dev/null
aws logs tail /aws/lambda/reso-cert-backup-qa --follow
```

**Disable the schedule temporarily:**
```bash
aws events disable-rule --name "$(aws events list-rule-names-by-target --target-arn arn:aws:lambda:us-east-1:222014597091:function:reso-cert-backup-qa --query 'RuleNames[0]' --output text)"
```

**Rotate the API key:**
```bash
aws secretsmanager put-secret-value --secret-id reso-cert/qa/api-key --secret-string 'NEW_KEY'
```
The Lambda caches the key in-memory per container. Force a cold start by updating the function (e.g. change an env var) to pick up the new value immediately.

## Known gaps / not in scope

- **Archived reports** (`/api/v1/certification_reports/archived`) are not fetched by the backup — confirm with Josh whether this is required and add if so.
- **Restore from S3** — `restore --restoreFromBackup` still reads from local disk; an S3-aware variant would need a separate change.
- **Prod env** — copy the stack with `Environment=prod` after QA is confirmed.
- **RESO AWS account migration** — per Josh, to be scoped after the dev-account setup is proven out.
- **Hardening** — IDE flagged (Information severity): secret rotation, KMS CMK on secret + SNS, S3 access logging. Not required, low priority.
