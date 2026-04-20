# Lycus OpenClaw Plugin

This package is a native OpenClaw channel plugin for [Lycus](https://www.lycus.ai).

Bold idea: Lycus is the business layer for OpenClaw.

Clear articulation: Lycus lets organizations manage multiple OpenClaw installations from one centralized dashboard. Teams can pair OpenClaw devices, share access across authorized team members, inspect structured activity, coordinate scheduled work, and track outcomes across the agents running on company machines.

Real-world example: a team member sends a request from the Lycus dashboard. Lycus stores the durable event, delivers it to the paired OpenClaw device over an outbound WebSocket, the plugin dispatches the work into the local OpenClaw Gateway, and Lycus receives replies, progress, and final outcomes back into the dashboard.

Confident close: Lycus gives organizations one operational layer for agents running across many OpenClaw devices.

## Prerequisites

- OpenClaw Gateway is already installed and working.
- Node 22.14+ is available on the machine running OpenClaw.
- The Rails backend is reachable over HTTPS/WSS.
- Rails has created a pairing ticket and returned:
  - `token`, used as `machineToken`
  - `suggested_machine_id`, used as `machineId`

Check Node:

```bash
node --version
```

## First-Time Install

The current development install uses a local path plugin. In these examples, the plugin lives at:

```text
/Users/eng1/Documents/openclaw-lycus
```

Install dependencies:

```bash
cd /Users/eng1/Documents/openclaw-lycus
npm install --legacy-peer-deps
npm run typecheck
npm test
```

Install the plugin into OpenClaw from the local path:

```bash
openclaw plugins install -l /Users/eng1/Documents/openclaw-lycus
openclaw plugins enable lycus
```

Confirm OpenClaw sees it:

```bash
openclaw plugins list
openclaw plugins inspect lycus
```

Restart the Gateway so the plugin is loaded:

```bash
openclaw gateway restart
```

Pair the machine:

```bash
openclaw lycus pair
```

Watch logs:

```bash
openclaw logs --follow --local-time
```

Expected startup flow:

```text
Lycus: paired machine account=default machine=...
Lycus: connecting WebSocket https://.../cable
Lycus: WebSocket opened machine=...
Lycus: Action Cable subscription confirmed channel=OpenclawMachineChannel
Lycus: pulling replay events afterCursor=null
```

## Published Install

After publishing to npm:

```bash
openclaw plugins install @onewolfxyz/openclaw-lycus
openclaw plugins enable lycus
openclaw gateway restart
openclaw lycus pair
```

If installing from ClawHub:

```bash
openclaw plugins install clawhub:@onewolfxyz/openclaw-lycus
openclaw plugins enable lycus
openclaw gateway restart
openclaw lycus pair
```

## Automated Publishing

The GitHub Actions workflow at `.github/workflows/publish.yml` publishes from `main`.

Required repository secrets:

- `NPM_TOKEN`: npm granular access token with publish access to `@onewolfxyz/openclaw-lycus` and 2FA bypass enabled.
- `CLAWHUB_TOKEN`: ClawHub API token created with `clawhub login` / ClawHub account settings.

Release rule:

- Update `package.json` version before merging to `main`.
- When `main` updates, the workflow runs tests, checks whether that version already exists on npm, publishes it if needed, checks ClawHub, and publishes the matching ClawHub package if needed.
- If the package version already exists on npm, npm publish is skipped because npm versions are immutable.

## Configuration

Use Raw config mode if OpenClaw's form renderer reports an unsupported type.

```jsonc
{
  "channels": {
    "lycus": {
      "enabled": true,
      "mode": "websocket",
      "baseUrl": "https://app.lycus.ai",
      "socketUrl": "wss://app.lycus.ai/cable",
      "machineToken": "machine-token-from-rails-pairing-ticket",
      "machineId": "suggested-machine-id-from-rails",
      "machineName": "Engineering 2",
      "assistantName": "Lycus Assistant",
      "pairOnStart": true,
      "dmPolicy": "open",
      "allowFrom": ["*"]
    }
  }
}
```

Example full `channels` block for the current staging backend:

```jsonc
{
  "channels": {
    "lycus": {
      "enabled": true,
      "mode": "websocket",
      "baseUrl": "https://app.lycus.ai",
      "socketUrl": "wss://app.lycus.ai/cable",
      "machineToken": "token-from-rails",
      "machineId": "lycus-mac-558e",
      "machineName": "Test Macbook Engineering",
      "assistantName": "Lycus Assistant",
      "assistantEmoji": "L",
      "assistantAvatarUrl": "https://www.lycus.ai/avatar.png",
      "pairOnStart": true,
      "dmPolicy": "open",
      "allowFrom": ["*"]
    }
  }
}
```

Minimum required fields:

```jsonc
{
  "channels": {
    "lycus": {
      "baseUrl": "https://app.lycus.ai",
      "machineToken": "machine-token-from-rails-pairing-ticket",
      "machineId": "suggested-machine-id-from-rails"
    }
  }
}
```

If `socketUrl` is omitted, the plugin derives it from `baseUrl` as `/cable`.

Environment fallbacks are supported:

```bash
LYCUS_BASE_URL=https://app.lycus.ai
LYCUS_SOCKET_URL=wss://app.lycus.ai/cable
LYCUS_MACHINE_TOKEN=machine-token-from-rails-pairing-ticket
LYCUS_MACHINE_ID=suggested-machine-id-from-rails
```

Named accounts are also supported:

```jsonc
{
  "channels": {
    "lycus": {
      "baseUrl": "https://app.lycus.ai",
      "accounts": {
        "default": {
          "machineToken": "machine-token-a",
          "machineId": "machine-a"
        },
        "office": {
          "machineToken": "machine-token-b",
          "machineId": "machine-b"
        }
      }
    }
  }
}
```

## Pairing

The Rails app creates a pairing ticket:

```http
POST /api/pairing_tickets
```

The user copies the returned `token` into OpenClaw as `machineToken` and the returned `suggested_machine_id` into OpenClaw as `machineId`.

Pair explicitly:

```bash
openclaw lycus pair
```

Or let the plugin pair on Gateway startup with `pairOnStart: true`.

Re-pair after changing `machineToken`, `machineId`, `baseUrl`, or `socketUrl`:

```bash
openclaw gateway restart
openclaw lycus pair
```

The plugin calls:

```http
POST /api/openclaw/channel/pair
Authorization: Bearer <machineToken>
X-OpenClaw-Channel: lycus
X-OpenClaw-Account-Id: default
X-OpenClaw-Machine-Id: <machineId>
```

Request:

```json
{
  "channelId": "lycus",
  "accountId": "default",
  "machineId": "lycus-mac-447f",
  "machineName": "Engineering 2",
  "assistant": {
    "name": "Lycus Assistant"
  },
  "capabilities": {
    "chatTypes": ["direct", "group"],
    "markdown": true,
    "blockStreaming": true
  }
}
```

Expected response:

```json
{
  "ok": true,
  "paired": true,
  "accountId": "default",
  "machineId": "lycus-mac-447f",
  "socketUrl": "wss://app.lycus.ai/cable"
}
```

## WebSocket Contract

After pairing, the plugin opens:

```text
wss://app.lycus.ai/cable?machine_id=<machineId>
```

Headers:

```http
Authorization: Bearer <machineToken>
Origin: https://app.lycus.ai
X-OpenClaw-Channel: lycus
X-OpenClaw-Account-Id: default
X-OpenClaw-Machine-Id: <machineId>
```

The WebSocket client uses the Action Cable subprotocol:

```text
actioncable-v1-json
```

After Action Cable sends `welcome`, the plugin subscribes:

```json
{
  "command": "subscribe",
  "identifier": "{\"channel\":\"OpenclawMachineChannel\"}"
}
```

Rails broadcasts machine events as Action Cable messages:

```json
{
  "identifier": "{\"channel\":\"OpenclawMachineChannel\"}",
  "message": {
    "type": "message",
    "eventId": "evt_8f2c1d0b",
    "messageId": "msg_456",
    "conversationId": "user_123",
    "accountId": "default",
    "text": "Can you help me?",
    "chatType": "direct",
    "from": "user_123",
    "senderId": "user_123",
    "senderName": "Jane",
    "threadId": null,
    "timestamp": "2026-04-20T12:00:00.000Z"
  }
}
```

The plugin queues events in memory, avoids duplicate in-flight `eventId`s, dispatches each event into OpenClaw, then ACKs it after processing.

## Plugin HTTP Endpoints

### Assistant Replies

```http
POST /api/openclaw/channel/messages
Authorization: Bearer <machineToken>
```

Body:

```json
{
  "accountId": "default",
  "machineId": "lycus-mac-447f",
  "assistant": {
    "name": "Lycus Assistant"
  },
  "conversationId": "user_123",
  "text": "Assistant reply",
  "replyToId": "msg_456",
  "replyId": "rep_789",
  "kind": "final"
}
```

### Indicators

```http
POST /api/openclaw/channel/indicators
Authorization: Bearer <machineToken>
```

Types sent by the plugin:

```text
typing
typing_stopped
working
tool_start
tool_finish
partial_reply
final_reply
error
```

Example indicator body:

```json
{
  "accountId": "default",
  "machineId": "lycus-mac-447f",
  "assistant": {
    "name": "Lycus Assistant"
  },
  "conversationId": "user_123",
  "type": "working",
  "messageId": "msg_456",
  "text": "Lycus is working..."
}
```

### ACK Processed Event

```http
POST /api/openclaw/channel/events/ack
Authorization: Bearer <machineToken>
```

Body:

```json
{
  "eventId": "evt_8f2c1d0b",
  "status": "processed"
}
```

### Pull Replay Events

The plugin calls this after Action Cable subscription confirms and may call it after reconnect.

```http
POST /api/openclaw/channel/events/pull
Authorization: Bearer <machineToken>
```

Body:

```json
{
  "afterCursor": null,
  "limit": 50
}
```

Response:

```json
{
  "ok": true,
  "cursor": "evt_8f2c1d0b",
  "events": [
    {
      "type": "message",
      "eventId": "evt_8f2c1d0b",
      "messageId": "msg_456",
      "conversationId": "user_123",
      "accountId": "default",
      "text": "Can you help me?",
      "chatType": "direct",
      "from": "user_123",
      "senderId": "user_123",
      "senderName": "Jane",
      "threadId": null,
      "timestamp": "2026-04-20T12:00:00.000Z"
    }
  ]
}
```

## Runtime Behavior

- WebSocket mode is the default.
- `gatewayPublicUrl` is no longer required.
- `/lycus/webhook` is only registered if `mode` is explicitly set to `webhook`.
- The plugin reconnects with exponential backoff up to 30 seconds.
- On subscription confirm, the plugin pulls replay events from Rails.
- ACKs are sent over HTTP after OpenClaw processing.
- Assistant replies include a deterministic `replyId`.
- Assistant replies and indicators include assistant identity metadata.
- The default assistant identity is `Lycus Assistant`.

## Refreshing Or Updating The Local Plugin

When plugin code changes, OpenClaw must reload the plugin. For a local path install, use this flow:

```bash
cd /Users/eng1/Documents/openclaw-lycus
git pull
npm install --legacy-peer-deps
npm run typecheck
npm test
openclaw gateway restart
```

If OpenClaw does not pick up the change after restart, reinstall the local path plugin:

```bash
openclaw plugins disable lycus
openclaw plugins install -l /Users/eng1/Documents/openclaw-lycus
openclaw plugins enable lycus
openclaw gateway restart
```

Then verify:

```bash
openclaw plugins inspect lycus
openclaw lycus pair
openclaw logs --follow --local-time
```

For a hard refresh during development:

```bash
cd /Users/eng1/Documents/openclaw-lycus
rm -rf node_modules
npm install --legacy-peer-deps
npm run typecheck
npm test
openclaw plugins install -l /Users/eng1/Documents/openclaw-lycus
openclaw gateway restart
openclaw lycus pair
```

Do not change the Rails pairing token unless you intend to create a new machine pairing.

## Updating OpenClaw Config

After editing `openclaw.json`, validate and restart:

```bash
openclaw config validate
openclaw gateway restart
```

If the change touches channel identity or backend URLs, pair again:

```bash
openclaw lycus pair
```

Use Raw config mode if the OpenClaw Control UI says:

```text
Unsupported type. Use Raw mode.
```

## Operational Checks

Check plugin installation:

```bash
openclaw plugins list
openclaw plugins inspect lycus
```

Check Gateway status:

```bash
openclaw gateway status
```

Check logs:

```bash
openclaw logs --follow --local-time
```

Check only this plugin:

```bash
openclaw logs --follow --plain --local-time | grep -i "lycus"
```

Expected message flow when Rails sends a user message:

```text
Lycus: received event eventId=...
Lycus: queued event eventId=...
Lycus: dispatching event to OpenClaw eventId=...
lycus: inbound message normalized eventId=...
lycus: handing message to OpenClaw runtime messageId=...
lycus: dispatching assistant reply replyId=...
lycus: assistant reply sent replyId=...
Lycus: acked event eventId=... status=processed
```

## Logs

Tail Gateway logs while sending a test message:

```bash
openclaw logs --follow --local-time
```

For plain output:

```bash
openclaw logs --follow --plain --local-time
```

Default file logs are written under `/tmp/openclaw/openclaw-YYYY-MM-DD.log`.

The plugin logs these milestones:

```text
Lycus: paired machine account=default machine=lycus-mac-558e
Lycus: connecting WebSocket https://.../cable
Lycus: WebSocket opened machine=lycus-mac-558e
Lycus: Action Cable welcome received
Lycus: subscribing to Action Cable channel=OpenclawMachineChannel
Lycus: Action Cable subscription confirmed channel=OpenclawMachineChannel
Lycus: pulling replay events afterCursor=null
Lycus: replay pull returned count=0 cursor=null
Lycus: received event eventId=evt_... messageId=msg_... conversation=... text="..."
Lycus: queued event eventId=evt_... messageId=msg_...
Lycus: dispatching event to OpenClaw eventId=evt_... messageId=msg_...
lycus: inbound message normalized eventId=evt_... messageId=msg_... conversation=... sender=... text="..."
lycus: handing message to OpenClaw runtime messageId=msg_... conversation=...
lycus: dispatching assistant reply replyId=rep_... conversation=... replyTo=msg_... kind=final text="..."
lycus: assistant reply sent replyId=rep_...
lycus: OpenClaw runtime completed messageId=msg_... conversation=...
Lycus: OpenClaw dispatch finished eventId=evt_...
Lycus: acked event eventId=evt_... status=processed
```

If you do not see the message lifecycle logs, check Rails for:

```text
/api/openclaw/channel/pair
/cable WebSocket connection
/api/openclaw/channel/events/pull
/api/openclaw/channel/events/ack
/api/openclaw/channel/messages
```

## Development

```bash
npm install --legacy-peer-deps
npm run typecheck
npm test
```

The plugin follows the current OpenClaw SDK channel pattern:

- `package.json` declares `openclaw.channel`
- `openclaw.plugin.json` declares a native channel plugin
- `index.ts` exports `defineChannelPluginEntry(...)`
- `setup-entry.ts` exports `defineSetupPluginEntry(...)`
- `src/channel.ts` owns channel config, pairing, outbound, auth, status, and gateway startup
- `src/websocket.ts` owns Action Cable connection, replay pull, event queueing, ACK, and reconnect
- `src/inbound.ts` owns OpenClaw event dispatch and legacy webhook mode
