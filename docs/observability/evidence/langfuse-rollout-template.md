# Langfuse rollout evidence template

> 复制到私有运维记录后填写。仓库版本不得写入 secret、生产用户/Trace ID 或 prompt/output 正文。

- Operator:
- Date/time (UTC):
- Environment:
- Release/image tag:
- Langfuse region (no keys):
- Telemetry switches:
- Content policy result:
- `observability:check-release` result:

## Scenario evidence

| Scenario              | Pass/fail | Sanitized evidence reference | Notes |
| --------------------- | --------- | ---------------------------- | ----- |
| Plain answer          |           |                              |       |
| Research route/plan   |           |                              |       |
| Search/Fetch attempts |           |                              |       |
| Tool/Artifact         |           |                              |       |
| Stop                  |           |                              |       |
| Retry/replay          |           |                              |       |
| Failure               |           |                              |       |
| Feedback Score        |           |                              |       |

## Failure drills

| Drill                | Product response unaffected | DB terminal state correct | Safe logs only | Pass/fail |
| -------------------- | --------------------------- | ------------------------- | -------------- | --------- |
| Unreachable endpoint |                             |                           |                |           |
| 401                  |                             |                           |                |           |
| 429                  |                             |                           |                |           |
| Timeout              |                             |                           |                |           |
| Final flush failure  |                             |                           |                |           |

## Capacity sample

- Sample runs:
- Average units/run:
- p95 units/run:
- Daily ingestion:
- Projected monthly units:
- Required history window:
- Active project members:
- Decision/threshold owner:

## Rollout and rollback

- Cohort percentage:
- Start/end time:
- Observed application p95 delta:
- Export errors:
- Rollback switch tested:
- Final decision:
