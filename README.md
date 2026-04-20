# Claw Channel OpenClaw Plugin

This package is a native OpenClaw channel plugin for the Claw Management Rails backend.

Bold idea: customer machines should never need public inbound URLs.

Clear articulation: the plugin runs inside the local OpenClaw Gateway, pairs with Rails using a machine token, opens an outbound Action Cable WebSocket to Rails, receives durable queued events over that socket, dispatches them into OpenClaw, ACKs processed events, and posts assistant replies back to Rails over HTTP.

Real-world example: a browser user sends a message in your Rails chat UI. Rails stores an `openclaw_channel_events` row, broadcasts that event to the paired machine over `/cable`, the plugin runs the OpenClaw agent locally, and Rails receives the assistant reply at `/api/openclaw/channel/messages`.

Confident close: Rails owns durable state; Action Cable is only the delivery pipe.

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
/Users/eng1/Documents/ClawChannelPlugin
```

Install dependencies:

```bash
cd /Users/eng1/Documents/ClawChannelPlugin
npm install --legacy-peer-deps
npm run typecheck
npm test
```

Install the plugin into OpenClaw from the local path:

```bash
openclaw plugins install -l /Users/eng1/Documents/ClawChannelPlugin
openclaw plugins enable claw-channel
```

Confirm OpenClaw sees it:

```bash
openclaw plugins list
openclaw plugins inspect claw-channel
```

Restart the Gateway so the plugin is loaded:

```bash
openclaw gateway restart
```

Pair the machine:

```bash
openclaw claw-channel pair
```

Watch logs:

```bash
openclaw logs --follow --local-time
```

Expected startup flow:

```text
Claw Channel: paired machine account=default machine=...
Claw Channel: connecting WebSocket https://.../cable
Claw Channel: WebSocket opened machine=...
Claw Channel: Action Cable subscription confirmed channel=OpenclawMachineChannel
Claw Channel: pulling replay events afterCursor=null
```

## Published Install

After publishing to npm:

```bash
openclaw plugins install openclaw-claw-channel
openclaw plugins enable claw-channel
openclaw gateway restart
openclaw claw-channel pair
```

If published under an npm scope:

```bash
openclaw plugins install @your-org/openclaw-claw-channel
openclaw plugins enable claw-channel
openclaw gateway restart
openclaw claw-channel pair
```

## Configuration

Use Raw config mode if OpenClaw's form renderer reports an unsupported type.

```jsonc
{
  "channels": {
    "claw-channel": {
      "enabled": true,
      "mode": "websocket",
      "baseUrl": "https://unmercerized-biramous-larry.ngrok-free.dev",
      "socketUrl": "wss://unmercerized-biramous-larry.ngrok-free.dev/cable",
      "machineToken": "machine-token-from-rails-pairing-ticket",
      "machineId": "suggested-machine-id-from-rails",
      "machineName": "Engineering 2",
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
    "claw-channel": {
      "enabled": true,
      "mode": "websocket",
      "baseUrl": "https://unmercerized-biramous-larry.ngrok-free.dev",
      "socketUrl": "wss://unmercerized-biramous-larry.ngrok-free.dev/cable",
      "machineToken": "token-from-rails",
      "machineId": "claw-mac-558e",
      "machineName": "Test Macbook Engineering",
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
    "claw-channel": {
      "baseUrl": "https://unmercerized-biramous-larry.ngrok-free.dev",
      "machineToken": "machine-token-from-rails-pairing-ticket",
      "machineId": "suggested-machine-id-from-rails"
    }
  }
}
```

If `socketUrl` is omitted, the plugin derives it from `baseUrl` as `/cable`.

Environment fallbacks are supported:

```bash
CLAW_CHANNEL_BASE_URL=https://unmercerized-biramous-larry.ngrok-free.dev
CLAW_CHANNEL_SOCKET_URL=wss://unmercerized-biramous-larry.ngrok-free.dev/cable
CLAW_CHANNEL_MACHINE_TOKEN=machine-token-from-rails-pairing-ticket
CLAW_CHANNEL_MACHINE_ID=suggested-machine-id-from-rails
```

Named accounts are also supported:

```jsonc
{
  "channels": {
    "claw-channel": {
      "baseUrl": "https://unmercerized-biramous-larry.ngrok-free.dev",
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
openclaw claw-channel pair
```

Or let the plugin pair on Gateway startup with `pairOnStart: true`.

Re-pair after changing `machineToken`, `machineId`, `baseUrl`, or `socketUrl`:

```bash
openclaw gateway restart
openclaw claw-channel pair
```

The plugin calls:

```http
POST /api/openclaw/channel/pair
Authorization: Bearer <machineToken>
X-OpenClaw-Channel: claw-channel
X-OpenClaw-Account-Id: default
X-OpenClaw-Machine-Id: <machineId>
```

Request:

```json
{
  "channelId": "claw-channel",
  "accountId": "default",
  "machineId": "claw-mac-447f",
  "machineName": "Engineering 2",
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
  "machineId": "claw-mac-447f",
  "socketUrl": "wss://unmercerized-biramous-larry.ngrok-free.dev/cable"
}
```

## WebSocket Contract

After pairing, the plugin opens:

```text
wss://unmercerized-biramous-larry.ngrok-free.dev/cable?machine_id=<machineId>
```

Headers:

```http
Authorization: Bearer <machineToken>
Origin: https://unmercerized-biramous-larry.ngrok-free.dev
X-OpenClaw-Channel: claw-channel
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
  "machineId": "claw-mac-447f",
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
error
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
- `/claw-channel/webhook` is only registered if `mode` is explicitly set to `webhook`.
- The plugin reconnects with exponential backoff up to 30 seconds.
- On subscription confirm, the plugin pulls replay events from Rails.
- ACKs are sent over HTTP after OpenClaw processing.
- Assistant replies include a deterministic `replyId`.

## Refreshing Or Updating The Local Plugin

When plugin code changes, OpenClaw must reload the plugin. For a local path install, use this flow:

```bash
cd /Users/eng1/Documents/ClawChannelPlugin
git pull
npm install --legacy-peer-deps
npm run typecheck
npm test
openclaw gateway restart
```

If OpenClaw does not pick up the change after restart, reinstall the local path plugin:

```bash
openclaw plugins disable claw-channel
openclaw plugins install -l /Users/eng1/Documents/ClawChannelPlugin
openclaw plugins enable claw-channel
openclaw gateway restart
```

Then verify:

```bash
openclaw plugins inspect claw-channel
openclaw claw-channel pair
openclaw logs --follow --local-time
```

For a hard refresh during development:

```bash
cd /Users/eng1/Documents/ClawChannelPlugin
rm -rf node_modules
npm install --legacy-peer-deps
npm run typecheck
npm test
openclaw plugins install -l /Users/eng1/Documents/ClawChannelPlugin
openclaw gateway restart
openclaw claw-channel pair
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
openclaw claw-channel pair
```

Use Raw config mode if the OpenClaw Control UI says:

```text
Unsupported type. Use Raw mode.
```

## Operational Checks

Check plugin installation:

```bash
openclaw plugins list
openclaw plugins inspect claw-channel
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
openclaw logs --follow --plain --local-time | grep -i "claw"
```

Expected message flow when Rails sends a user message:

```text
Claw Channel: received event eventId=...
Claw Channel: queued event eventId=...
Claw Channel: dispatching event to OpenClaw eventId=...
claw-channel: inbound message normalized eventId=...
claw-channel: handing message to OpenClaw runtime messageId=...
claw-channel: dispatching assistant reply replyId=...
claw-channel: assistant reply sent replyId=...
Claw Channel: acked event eventId=... status=processed
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
Claw Channel: paired machine account=default machine=claw-mac-558e
Claw Channel: connecting WebSocket https://.../cable
Claw Channel: WebSocket opened machine=claw-mac-558e
Claw Channel: Action Cable welcome received
Claw Channel: subscribing to Action Cable channel=OpenclawMachineChannel
Claw Channel: Action Cable subscription confirmed channel=OpenclawMachineChannel
Claw Channel: pulling replay events afterCursor=null
Claw Channel: replay pull returned count=0 cursor=null
Claw Channel: received event eventId=evt_... messageId=msg_... conversation=... text="..."
Claw Channel: queued event eventId=evt_... messageId=msg_...
Claw Channel: dispatching event to OpenClaw eventId=evt_... messageId=msg_...
claw-channel: inbound message normalized eventId=evt_... messageId=msg_... conversation=... sender=... text="..."
claw-channel: handing message to OpenClaw runtime messageId=msg_... conversation=...
claw-channel: dispatching assistant reply replyId=rep_... conversation=... replyTo=msg_... kind=final text="..."
claw-channel: assistant reply sent replyId=rep_...
claw-channel: OpenClaw runtime completed messageId=msg_... conversation=...
Claw Channel: OpenClaw dispatch finished eventId=evt_...
Claw Channel: acked event eventId=evt_... status=processed
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
