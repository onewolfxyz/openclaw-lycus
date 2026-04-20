# Claw Channel OpenClaw Plugin

This package is a native OpenClaw channel plugin. It lets a user install one OpenClaw channel, authenticate with your backend using a machine token, and pair that local OpenClaw gateway to a backend-managed machine/channel.

## What It Does

Bold idea: OpenClaw stays channel-native, while your backend stays the system of record.

Clear articulation: the plugin registers a `claw-channel` channel with OpenClaw, exposes an inbound webhook on the OpenClaw Gateway, sends assistant replies back to your backend, and pairs the machine token during channel login or gateway startup.

Real-world example: your app sends a user message to `POST /claw-channel/webhook` on the user's OpenClaw Gateway. OpenClaw runs the agent. The plugin posts the assistant reply back to your backend at `/api/openclaw/channel/messages`.

Confident close: backend-owned auth and OpenClaw-owned agent routing stay cleanly separated.

## Install

For local development:

```bash
openclaw plugins install -l /path/to/openclaw-claw-channel
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

Add this to `openclaw.json`:

```jsonc
{
  "channels": {
    "claw-channel": {
      "enabled": true,
      "baseUrl": "https://your-backend.example.com",
      "machineToken": "machine-token-from-your-service",
      "machineId": "optional-stable-machine-id",
      "gatewayPublicUrl": "https://public-url-for-this-openclaw-gateway.example.com",
      "webhookSecret": "shared-hmac-secret",
      "dmPolicy": "pairing",
      "allowFrom": [],
      "pairOnStart": true
    }
  }
}
```

Environment fallbacks are supported:

```bash
CLAW_CHANNEL_BASE_URL=https://your-backend.example.com
CLAW_CHANNEL_MACHINE_TOKEN=machine-token-from-your-service
CLAW_CHANNEL_MACHINE_ID=optional-stable-machine-id
CLAW_CHANNEL_WEBHOOK_SECRET=shared-hmac-secret
```

Named accounts are also supported:

```jsonc
{
  "channels": {
    "claw-channel": {
      "baseUrl": "https://your-backend.example.com",
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

Pair explicitly:

```bash
openclaw channels login --channel claw-channel
```

Or use the plugin CLI:

```bash
openclaw claw-channel pair
openclaw claw-channel pair --account office
```

The plugin also pairs on gateway startup by default when `pairOnStart` is not `false`.

## Backend Contract

The backend URL defaults below can be overridden with `channels.claw-channel.api.*`.

### Pair Machine

`POST /api/openclaw/channel/pair`

Headers:

```http
Authorization: Bearer <machineToken>
X-OpenClaw-Channel: claw-channel
X-OpenClaw-Account-Id: default
X-OpenClaw-Machine-Id: machine-a
```

Body:

```json
{
  "channelId": "claw-channel",
  "accountId": "default",
  "machineId": "machine-a",
  "machineName": "optional display name",
  "gatewayPublicUrl": "https://gateway.example.com",
  "inboundPath": "/claw-channel/webhook",
  "inboundUrl": "https://gateway.example.com/claw-channel/webhook",
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
  "machineId": "machine-a"
}
```

### Send OpenClaw Replies To Backend

`POST /api/openclaw/channel/messages`

Body:

```json
{
  "accountId": "default",
  "machineId": "machine-a",
  "conversationId": "user-or-conversation-id",
  "text": "Assistant reply",
  "threadId": null,
  "replyToId": "backend-message-id",
  "kind": "final"
}
```

Expected response:

```json
{
  "messageId": "backend-reply-id"
}
```

### Send Indicators To Backend

`POST /api/openclaw/channel/indicators`

Body:

```json
{
  "accountId": "default",
  "machineId": "machine-a",
  "conversationId": "user-or-conversation-id",
  "type": "typing",
  "threadId": null
}
```

Indicator types currently sent by the plugin are `typing`, `typing_stopped`, and `error`.

### Receive Messages From Backend

The plugin registers:

`POST /claw-channel/webhook`

Authenticate inbound calls with either:

```http
Authorization: Bearer <machineToken>
```

or:

```http
X-Claw-Signature: sha256=<hmac_sha256_raw_body_with_webhookSecret>
```

Message body:

```json
{
  "type": "message",
  "accountId": "default",
  "messageId": "backend-message-id",
  "conversationId": "user-or-conversation-id",
  "from": "user-id",
  "senderId": "user-id",
  "senderName": "User Name",
  "text": "Hello OpenClaw",
  "chatType": "direct",
  "threadId": null,
  "timestamp": "2026-04-19T12:00:00.000Z"
}
```

Batch body:

```json
{
  "type": "batch",
  "accountId": "default",
  "events": [
    {
      "type": "message",
      "messageId": "msg-1",
      "conversationId": "user-1",
      "senderId": "user-1",
      "text": "Hello"
    }
  ]
}
```

The route responds `202` after authentication and dispatches the OpenClaw turn asynchronously so your backend does not wait for the model response.

## Development

```bash
npm install
npm run typecheck
npm test
```

The plugin follows the current OpenClaw SDK channel pattern:

- `package.json` declares `openclaw.channel`
- `openclaw.plugin.json` declares a native channel plugin
- `index.ts` exports `defineChannelPluginEntry(...)`
- `setup-entry.ts` exports `defineSetupPluginEntry(...)`
- `src/channel.ts` owns channel config, pairing, outbound, auth, status, and gateway startup
- `src/inbound.ts` owns the plugin-managed webhook and OpenClaw reply dispatch
