import type { FastifyRequest, FastifyReply } from "fastify"

export async function healthHandler(_req: FastifyRequest, reply: FastifyReply) {
  return reply.send({ ok: true, version: "0.1.0" })
}
