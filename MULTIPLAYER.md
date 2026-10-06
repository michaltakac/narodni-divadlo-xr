# The multi-user kit

Three files make any project multi-user: `components/Multiplayer.jsx`, `components/Avatar.jsx` and
`lib/multiplayer.js` (plus `lib/names.js` for default names and colours). They are the same bytes in
every template that has them. Dependencies: `yjs`, `y-websocket`, `y-protocols` (exact versions in
`package.json`).

## The model

Everyone in a **room** shares one Yjs document and sees each other's **presence**. The relay
(`infra/realtime`, one Cloudflare Durable Object per room) forwards messages and keeps the document.

| Kind | Where | What for | How often |
| --- | --- | --- | --- |
| **Shared state** | the Y.Doc (`useShared`, `useSharedMap`) | things that matter and must survive: where objects rest, a counter, colours, text, scores | when something settles (a press, a drop) |
| **Presence** | awareness (`usePresence`, `mp.hold`) | per-person things that die with the person: head and hand poses, what they carry, a pointer | poses every frame, sent 20 times a second as one small message |
| **Local state** | React state, refs | hover, pressed, animation, the camera | as usual |

Rules:

- Never put per-frame data in the Y.Doc. Every document update is forwarded to everyone and stored
  by the relay for ever; 60 updates a second from one person would fill the room's storage in
  minutes and make a late joiner download all of it. Poses go through presence.
- Keep presence small. One awareness message carries a person's whole state (name, colour, head,
  two hands, what they hold, custom fields), about 130–190 bytes; the kit quantises positions to
  millimetres and rotations to thousandths. A custom field is sent with every message: a few numbers
  or a short string, not an array of points.
- Last writer wins per `useShared` key and per `useSharedMap` entry. Two people pressing the same
  button at once is fine; two people editing the same big object in one entry is not — split it.
- No per-frame React. Poses of others are read in `useFrame` from the connection
  (`mp.peerHead`, `mp.peerHand`, `mp.peerHeld`); React only re-renders when who is here changes or
  shared state changes.

## API

```jsx
import { Multiplayer, useMultiplayer, useShared, useSharedMap, usePresence, useMp } from './components/Multiplayer'

<Multiplayer room="my-room" name="Ada" color="#ff7a59" handle="ada" avatars>
  …the scene…
</Multiplayer>
```

- `<Multiplayer>` — `room` (default `defaultRoom()`: the published app's id, else `?room=` in the
  address, else `dev-<dev server address>`), `name` (default: a remembered random name per tab),
  `color`, `handle` (shown as `@handle` on the plate), `avatars` (default true: everyone else is
  drawn). Put it inside `<XR>`.
- `useMultiplayer()` → `{ connected, synced, peers, me, doc, mp }`. `peers` is
  `[{ id, name, color, handle, kind: 'xr' | 'screen', fields }]`, `me` is `{ id, name, color, handle }`.
- `useShared(key, initial)` → `[value, setValue]`. One entry of the room's `shared` map. `setValue`
  takes a value or an updater function. `initial` is written once the document has synced and the
  entry is still missing.
- `useSharedMap(name)` → `{ items, set(id, value), update(id, patch), remove(id), map, transact(fn) }`.
  `items` is a plain object snapshot; values are plain JSON.
- `usePresence()` → `[fields, setFields(patch)]`: low-rate custom fields others read as
  `peer.fields` (a status, a tool, a target). Sent with the next pose.
- `useMp()` → the connection, for `useFrame` code:
  - `mp.hold(id, position, quaternion)` every frame while you carry object `id`; `mp.release()`.
  - `mp.peerHeld(peerId, position, quaternion)` → the id of what that person carries (its smoothed
    pose written into the vectors) or null.
  - `mp.peerHead(peerId, position, quaternion)`, `mp.peerHand(peerId, 'left' | 'right', position, quaternion)`,
    `mp.peerHandInfo(peerId, side)` → `[grip 0..1, kind 0 hand | 1 controller]`.
  - `mp.peerAge(peerId)`, `mp.peerOpacity(peerId)` (fades after 1.5 s of silence).
  - `mp.stats` → `{ bytesPerUpdate, sentPerSecond }` (in the preview also `window.__graspableMultiplayer`).

## Ownership of grabbed objects

Keep `owner` in the object's shared entry. On grab: refuse if `owner` is someone who is still here
(`peers.some(p => p.id === owner)`), else `update(id, { owner: me.id })`. While holding: move the
mesh yourself and call `mp.hold(id, mesh.position, mesh.quaternion)` in `useFrame`. On release:
`update(id, { p, q, owner: null })` once, then `mp.release()`. Others render the object from the
holder's presence while it is held and from the shared entry when it rests. `SharedObjects.jsx`
is the worked example. An owner who disconnects leaves presence, so their objects become free.

## Frames of reference

Poses are sent in the scene's world space. In XR the kit reads the headset camera's world matrix
(it is parented to `<XROrigin>`, so moving or teleporting the origin is included) and transforms
hand and controller poses from the origin reference space with the origin's world matrix. Objects
you share must also be in world space (not children of the origin or of a hand).

## Adding the kit to another project

Copy `components/Multiplayer.jsx`, `components/Avatar.jsx`, `lib/multiplayer.js`, `lib/names.js`
and this file; add `yjs`, `y-websocket` and `y-protocols` to `package.json` (same versions as here);
wrap the scene in `<Multiplayer>` inside `<XR>`. Nothing else changes. `VITE_GRASPABLE_REALTIME`
points the app at another relay (a local `wrangler dev`), and `VITE_GRASPABLE_REALTIME=off` runs it single-user.
