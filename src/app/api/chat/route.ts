import { createChatStream } from "@/lib/hermes-chat";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { prompt?: string; sessionId?: string };
    const prompt = body.prompt?.trim();

    if (!prompt) {
      return new Response(JSON.stringify({ error: "Prompt is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const sessionId = body.sessionId?.trim() || undefined;
    const handle = createChatStream(prompt, sessionId);

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        function send(event: string, data: string) {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
        }

        try {
          for await (const event of handle.generator) {
            switch (event.type) {
              case "token":
                send("token", event.data);
                break;
              case "session_id":
                send("session_id", event.data);
                break;
              case "done":
                send("done", JSON.stringify({ sessionId: event.sessionId }));
                break;
              case "error":
                send("error", event.message);
                break;
            }
          }
        } catch (err) {
          send("error", err instanceof Error ? err.message : "Stream failed");
        } finally {
          controller.close();
        }
      },
      cancel() {
        // Client disconnected — kill the hermes child process to avoid leak
        handle.kill();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Failed to run Hermes chat" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
