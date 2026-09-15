# Report feedback and research continuation

Public investment reports expose a feedback button. `POST /api/investment-analysis/feedback` saves suggestions to private Vercel Blob and returns a stable ID after persistence. Submissions are unverified research leads; anonymous users cannot start paid research.

`GET /api/investment-analysis/feedback?reportSlug=openai-gpt6-sol` requires `Authorization: Bearer <REPORT_FEEDBACK_ADMIN_TOKEN>` and exports paginated `notes` using `cursor`. Inject the admin token and `BLOB_READ_WRITE_TOKEN` through production configuration only. Missing durable storage returns 503; there is no temporary-file fallback or false success.

After exporting notes, continue a native forecast with its original state directory:

```bash
ARTIFACT_STORAGE_ROOT=/private/original-store pnpm forecast:event -- \
  --resume-event EVENT_ID --feedback-file /private/feedback.json --additional-rounds 2
```

Continuation freezes the question and answer type and extends the cumulative round budget. Binary, numeric, categorical and independent-ranking forecasts accept feedback. Only successfully persisted research acknowledges included notes; failures and concurrent additions remain pending. Duplicate runs and feedback IDs are guarded.

Native Raven task pages support save-and-continue. Running tasks consume suggestions during subsequent research; completed tasks restart under existing access and quota controls. After abnormal termination, verify the host and owner process recorded in a leftover lock have exited before removing it.

Synthesized reports are not native checkpoints: the Sol report filename is not an event ID. Follow-up research should read the current report and feedback, verify claims, produce the current assessment and publish to the stable URL. Public reports show current state only; native `audit.md/state.json` retain internal history.

Production: [Sol report](https://forecasting-agent.com/investment-analysis/openai-gpt6-sol). Acceptance covered exact report bytes, real submission/deduplication/private export and test-record cleanup. The user expressly skipped UI checks.
