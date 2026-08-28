"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "white", color: "#1d2115" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
          <div><h1 style={{ fontSize: 44, margin: 0 }}>No verdict issued.</h1><p>Something failed before the check could finish.</p><button onClick={reset} style={{ marginTop: 16, border: 0, borderRadius: 999, padding: "12px 20px", background: "#71852f", color: "white", fontWeight: 700 }}>Try again</button></div>
        </main>
      </body>
    </html>
  );
}
