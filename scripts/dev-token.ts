import { AccessToken } from "livekit-server-sdk";

const [room, identity] = process.argv.slice(2);
if (!room || !identity) {
  throw new Error("Usage: pnpm dev:token -- <room> <identity>");
}

const apiKey = process.env.LIVEKIT_API_KEY;
const apiSecret = process.env.LIVEKIT_API_SECRET;
const livekitUrl = process.env.LIVEKIT_URL ?? "ws://localhost:7880";
if (!apiKey || !apiSecret) {
  throw new Error("LIVEKIT_API_KEY and LIVEKIT_API_SECRET are required");
}

const accessToken = new AccessToken(apiKey, apiSecret, {
  identity,
  ttl: "1h",
});
accessToken.addGrant({
  room,
  roomJoin: true,
  canPublish: true,
  canSubscribe: true,
});

const token = await accessToken.toJwt();
console.log(`LiveKit URL: ${livekitUrl}`);
console.log(`Room: ${room}`);
console.log(`Identity: ${identity}`);
console.log(`Token: ${token}`);
