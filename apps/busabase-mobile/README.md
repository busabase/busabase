# Busabase Mobile

Busabase Mobile is the React Native companion app for Busabase (Expo + Expo Router). It connects to a
self-hosted Busabase server (no auth, matching the open-source server) and covers the full review
loop: Inbox with status tabs, change request review with field-level diffs
(Approve / Approve & Merge / Request changes / Merge), record detail with comments and review
history, Base tables with saved views, and local notifications when new change requests arrive.

See `content/spec/product-design.md` for the product plan and architecture decisions.

## Development

```bash
# Start the Busabase server (seeds example data on first request)
make dev-busabase            # runs on http://localhost:3061

# Start the app
pnpm --filter busabase-mobile start
```

Server URL to use inside the app:

- iOS simulator: `http://localhost:3061`
- Android emulator: `http://10.0.2.2:3061`
- Real device: `http://<your-lan-ip>:3061`

## Notifications

The server has no push infrastructure, so the app uses client polling + local notifications:

- **Foreground**: polls `GET /api/v1/change-requests` every 30–120s (configurable in Settings),
  diffs the `in_review` set against seen ids persisted in AsyncStorage, fires one local
  notification per new change request, and keeps the app badge equal to the pending count.
- **Background**: an `expo-background-task` task runs the same check; the OS schedules it at its
  own pace (roughly every 15 minutes at best, often less frequently).
- Tapping a notification deep-links to `/change-requests/[id]`, including from a cold start.

### Platform limitations

- **Expo Go**: `expo-notifications` remote features and `expo-background-task` are limited or
  unavailable in Expo Go (SDK 53+). Local foreground notifications generally work, but for the
  full experience (background polling, reliable Android channels, badges) use a development
  build: `pnpm --filter busabase-mobile android` / `ios`.
- **iOS simulator**: background tasks do not run on a schedule; test background notifications on
  a real device. You can trigger a background-task dry run from a dev build via
  `BackgroundTask.triggerTaskWorkerForTestingAsync()`.
- Notification permission is requested when the toggle is first enabled; if denied, Settings
  offers a shortcut to the system settings page.

## Verifying the notification flow

1. Connect the app to a running server and enable notifications in Settings.
2. Create a change request from another terminal:

```bash
curl -s -X POST 'http://localhost:3061/api/v1/bases/qbs_local_blog/change-requests' \
  -H 'Content-Type: application/json' \
  -d '{"fields":{"title":"Hello from curl","body":"Notification test"},"submittedBy":"agent:curl"}'
```

3. Within one poll interval the device shows a local notification; tapping it opens the change
   request detail screen.
