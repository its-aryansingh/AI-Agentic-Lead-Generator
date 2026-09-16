"use client"

/**
 * Root error boundary.
 *
 * Without this, an unhandled server error renders Next.js's bare
 * "Internal Server Error" — no message, no stack, nothing to act on. On a
 * platform where you cannot attach a debugger, that is the difference
 * between a five-minute fix and an afternoon.
 *
 * The digest is the key: Next.js hashes the real error and prints the full
 * stack in the SERVER log against that same digest. Showing it here means
 * you can grep the Railway log for the exact failure.
 *
 * The message itself is only rendered when NEXT_PUBLIC_DEBUG_ERRORS is
 * set, because error text can leak connection strings and internals.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const showDetail = process.env.NEXT_PUBLIC_DEBUG_ERRORS === "1"

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          background: "#0b0b0f",
          color: "#e6e6ea",
          minHeight: "100vh",
          margin: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
        }}
      >
        <div style={{ maxWidth: 680 }}>
          <h1 style={{ fontSize: "1.25rem", margin: "0 0 0.75rem" }}>
            Something broke on the server
          </h1>

          {error.digest ? (
            <p style={{ opacity: 0.75, lineHeight: 1.6, margin: "0 0 1rem" }}>
              Error digest <code style={{ color: "#8ab4ff" }}>{error.digest}</code>
              <br />
              Search your deployment logs for that string — the full stack trace is
              printed there.
            </p>
          ) : null}

          {showDetail ? (
            <pre
              style={{
                whiteSpace: "pre-wrap",
                background: "#16161d",
                padding: "1rem",
                borderRadius: 8,
                fontSize: "0.8rem",
                overflowX: "auto",
              }}
            >
              {error.message}
              {"\n\n"}
              {error.stack}
            </pre>
          ) : null}

          <button
            onClick={reset}
            style={{
              marginTop: "1rem",
              padding: "0.5rem 1rem",
              borderRadius: 6,
              border: "1px solid #3a3a45",
              background: "#1e1e26",
              color: "inherit",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
