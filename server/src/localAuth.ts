import type { RequestHandler } from "express";
import { timingSafeEqual } from "node:crypto";

export function localOrigin(developmentOrigin?: string): RequestHandler {
  return (request,response,next) => {
    const host = request.get("host") ?? "";
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) { response.status(403).json({error:"Local host required"}); return; }
    const origin = request.get("origin");
    if ((origin && origin !== `http://${host}` && origin !== developmentOrigin) || request.get("sec-fetch-site") === "cross-site") {
      response.status(403).json({error:"Origin is not allowed"}); return;
    }
    next();
  };
}
export function requireToken(token: string): RequestHandler {
  return (request,response,next) => {
    const incoming = Buffer.from(request.get("x-board-token") ?? "");
    const expected = Buffer.from(token);
    if (incoming.length !== expected.length || !timingSafeEqual(incoming,expected)) { response.status(403).json({error:"Local request token required"}); return; }
    next();
  };
}
