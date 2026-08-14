import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { supabase } from "./client";

function decodeFirebaseToken(token: string) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
    return {
      uid: payload.sub,
      email: payload.email,
      claims: payload,
    };
  } catch (e) {
    console.error("Error decoding token:", e);
    return null;
  }
}

export const requireSupabaseAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const request = getRequest();

    if (!request?.headers) {
      throw new Error("Unauthorized: No request headers available");
    }

    const authHeader = request.headers.get("authorization");

    if (!authHeader) {
      throw new Error("Unauthorized: No authorization header provided");
    }

    if (!authHeader.startsWith("Bearer ")) {
      throw new Error("Unauthorized: Only Bearer tokens are supported");
    }

    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      throw new Error("Unauthorized: No token provided");
    }

    const decoded = decodeFirebaseToken(token);
    if (!decoded || !decoded.uid) {
      throw new Error("Unauthorized: Invalid Firebase token");
    }

    return next({
      context: {
        supabase,
        userId: decoded.uid,
        claims: decoded.claims,
      },
    });
  },
);
