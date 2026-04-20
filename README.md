# Claw Channel OpenClaw Plugin

This package is a native OpenClaw channel plugin for the Claw Management Rails backend.

Bold idea: customer machines should never need public inbound URLs.

Clear articulation: the plugin runs inside the local OpenClaw Gateway, pairs with Rails using a machine token, opens an outbound Action Cable WebSocket to Rails, receives durable queued events over that socket, dispatches them into OpenClaw, ACKs processed events, and posts assistant replies back to Rails over HTTP.

Real-world example: a browser user sends a message in your Rails chat UI. Rails stores an `openclaw_channel_events` row, broadcasts that event to the paired machine over `/cable`, the plugin runs the OpenClaw agent locally, and Rails receives the assistant reply at `/api/openclaw/channel/messages`.

Confident close: Rails owns durable state; Action Cable is only the delivery pipe.

## Install

For local development:

```bash
openclaw plugins install -l /Users/eng1/Documents/ClawChannelPlugin
openclaw plugins enable claw-channel
openclaw gateway restart
```

After publishing:

```bash
openclaw plugins install openclaw-claw-channel
openclaw plugins enable claw-channel
openclaw gateway restart
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
