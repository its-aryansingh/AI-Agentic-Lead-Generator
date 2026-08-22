"""
Streaming chat endpoint — POST /api/chat

Implements Server-Sent Events (SSE) streaming with Claude tool calls.
Mirrors app/api/chat/route.ts:
  - Auth via Bearer token OR Supabase cookie
  - Session create/resolve with ownership check
  - Message persistence
  - Streaming response with tool-call execution
  - Mock fallback when ANTHROPIC_API_KEY is absent
"""
from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from typing import Any, AsyncIterator

from django.http import HttpRequest, HttpResponse, StreamingHttpResponse
from django.views.decorators.csrf import csrf_exempt

from leadgen_backend.auth import parse_bearer_token
from leadgen_backend.config import get_settings
from leadgen_backend.supabase_rest import SupabaseRest
from leadgen_backend.validators import parse_json_body
from leadgen_backend.agent.system_prompt import SYSTEM_PROMPT
from leadgen_backend.agent.tool_definitions import ALL_TOOLS
from leadgen_backend.agent.tool_handlers import dispatch_tool


CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-session-id",
}


def _cors(response: HttpResponse) -> HttpResponse:
    for k, v in CORS_HEADERS.items():
        response[k] = v
    return response


@csrf_exempt
async def chat_endpoint(request: HttpRequest) -> HttpResponse:
    if request.method == "OPTIONS":
        resp = HttpResponse(status=204)
        return _cors(resp)

    if request.method != "POST":
        return _cors(HttpResponse("method_not_allowed", status=405))

    # Auth
    token = parse_bearer_token(request.headers.get("Authorization"))
    settings = get_settings()
    supabase = SupabaseRest(settings)

    # Also try cookie-based auth for browser sessions
    if not token:
        # Try to get token from session cookie (for Next.js browser)
        cookie_token = request.COOKIES.get("sb-access-token") or request.COOKIES.get("supabase-auth-token")
        if cookie_token:
            try:
                import json as _json
                parsed = _json.loads(cookie_token)
                if isinstance(parsed, list) and parsed:
                    token = parsed[0]
                elif isinstance(parsed, str):
                    token = parsed
            except Exception:
                token = cookie_token

    auth = await supabase.user_from_token(token)
    if not auth.user:
        return _cors(HttpResponse("Unauthorized", status=401))

    user_id = auth.user.id

    # Parse body
    body_bytes = request.body
    parsed_body, err = parse_json_body(body_bytes)
    if err or not parsed_body:
        return _cors(HttpResponse(f"Invalid JSON: {err}", status=400))

    messages: list[dict[str, Any]] = parsed_body.get("messages", [])
    session_id: str | None = parsed_body.get("sessionId")

    if not messages:
        return _cors(HttpResponse("messages required", status=400))

    # Ensure users row exists
    await supabase.upsert_user(user_id, auth.user.email or "")

    # Resolve or create session
    if session_id:
        owned = await supabase.verify_session_ownership(session_id, user_id)
        if not owned:
            return _cors(HttpResponse("Forbidden", status=403))
    else:
        first_text = ""
        for m in messages:
            if m.get("role") == "user":
                content = m.get("content", "")
                if isinstance(content, str):
                    first_text = content[:80]
                elif isinstance(content, list):
                    for part in content:
                        if isinstance(part, dict) and part.get("type") == "text":
                            first_text = part.get("text", "")[:80]
                            break
                break
        session_result = await supabase.create_chat_session(
            user_id=user_id,
            title=first_text or "New chat",
        )
        session_id = session_result.get("id") if session_result else None
        if not session_id:
            return _cors(HttpResponse("Failed to create session", status=500))

    # Persist the last user message
    last_user_msg = None
    for m in reversed(messages):
        if m.get("role") == "user":
            last_user_msg = m
            break

    if last_user_msg:
        await supabase.insert_chat_message(
            session_id=session_id,
            role="user",
            content=last_user_msg.get("content", ""),
        )

    ctx = {"user_id": user_id, "session_id": session_id}

    # Stream response
    response = StreamingHttpResponse(
        _stream_chat(messages, ctx, settings, supabase, session_id),
        content_type="text/event-stream; charset=utf-8",
    )
    response["Cache-Control"] = "no-cache"
    response["X-Accel-Buffering"] = "no"
    for k, v in CORS_HEADERS.items():
        response[k] = v
    return response


async def _stream_chat(
    messages: list[dict[str, Any]],
    ctx: dict[str, str],
    settings,
    supabase: SupabaseRest,
    session_id: str,
) -> AsyncIterator[str]:
    """Stream chat response as SSE data events."""

    api_key = os.getenv("ANTHROPIC_API_KEY")

    if not api_key:
        # Mock fallback
        mock_response = (
            "I'm running in demo mode (no ANTHROPIC_API_KEY set). "
            "I can still show you the product flow — set your API key for real AI responses. "
            "\n\nTo get started: describe your ideal customer profile (e.g. 'find me 20 heads of marketing at fintech startups in India') "
            "and I'll search for matching prospects and draft personalized emails."
        )
        yield _sse_text(mock_response)
        await supabase.insert_chat_message(session_id=session_id, role="assistant", content=mock_response)
        yield "data: [DONE]\n\n"
        return

    try:
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=api_key)

        # Convert messages to Anthropic format
        anthropic_messages = _convert_messages(messages)

        # Agentic loop — keep iterating until no more tool calls
        full_response_text = ""
        tool_results_accumulated: list[dict[str, Any]] = []
        step = 0
        max_steps = 10

        current_messages = anthropic_messages[:]

        while step < max_steps:
            step += 1

            stream_kwargs: dict[str, Any] = {
                "model": "claude-sonnet-4-5",
                "max_tokens": 4096,
                "system": SYSTEM_PROMPT,
                "messages": current_messages,
                "tools": ALL_TOOLS,
            }

            tool_calls_this_step: list[dict[str, Any]] = []
            current_text = ""

            async with client.messages.stream(**stream_kwargs) as stream:
                async for event in stream:
                    if event.type == "content_block_delta":
                        if hasattr(event.delta, "text"):
                            chunk = event.delta.text
                            current_text += chunk
                            full_response_text += chunk
                            yield _sse_text(chunk)

                    elif event.type == "content_block_start":
                        if hasattr(event.content_block, "type") and event.content_block.type == "tool_use":
                            tool_calls_this_step.append({
                                "id": event.content_block.id,
                                "name": event.content_block.name,
                                "input": {},
                                "_input_json": "",
                            })

                    elif event.type == "content_block_delta":
                        if hasattr(event.delta, "partial_json") and tool_calls_this_step:
                            tool_calls_this_step[-1]["_input_json"] += event.delta.partial_json

                message = await stream.get_final_message()

            # Parse tool inputs from accumulated JSON
            for tc in tool_calls_this_step:
                try:
                    tc["input"] = json.loads(tc.get("_input_json") or "{}")
                except Exception:
                    tc["input"] = {}

            # Parse tool calls from final message content blocks
            final_tool_calls: list[dict[str, Any]] = []
            for block in message.content:
                if block.type == "tool_use":
                    try:
                        inp = block.input if isinstance(block.input, dict) else {}
                    except Exception:
                        inp = {}
                    final_tool_calls.append({"id": block.id, "name": block.name, "input": inp})

            if not final_tool_calls or message.stop_reason == "end_turn":
                # No more tool calls — done
                break

            # Execute tools
            tool_result_content: list[dict[str, Any]] = []
            for tc in final_tool_calls:
                # Emit tool-call event to UI
                yield _sse_event("tool_call", {
                    "id": tc["id"],
                    "name": tc["name"],
                    "input": tc["input"],
                })

                result = await dispatch_tool(
                    tc["name"],
                    tc["input"],
                    ctx,
                    settings,
                    supabase,
                )

                # Emit tool-result event to UI
                yield _sse_event("tool_result", {
                    "id": tc["id"],
                    "name": tc["name"],
                    "result": result,
                })

                tool_result_content.append({
                    "type": "tool_result",
                    "tool_use_id": tc["id"],
                    "content": json.dumps(result),
                })

            # Append assistant turn + tool results to message history
            current_messages.append({"role": "assistant", "content": message.content})
            current_messages.append({"role": "user", "content": tool_result_content})

        # Persist final assistant message
        if full_response_text:
            await supabase.insert_chat_message(
                session_id=session_id,
                role="assistant",
                content=full_response_text,
            )

        yield "data: [DONE]\n\n"

    except Exception as exc:
        error_msg = f"Agent error: {exc}"
        yield _sse_text(f"\n\n[Error: {error_msg}]")
        yield "data: [DONE]\n\n"


def _convert_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert UI messages to Anthropic API format."""
    result = []
    for m in messages:
        role = m.get("role", "user")
        if role not in ("user", "assistant"):
            continue

        content = m.get("content", "")
        if isinstance(content, str):
            result.append({"role": role, "content": content})
        elif isinstance(content, list):
            # Handle multi-part content (text + tool calls)
            text_parts = []
            for part in content:
                if isinstance(part, dict):
                    if part.get("type") == "text":
                        text_parts.append(part.get("text", ""))
            combined = " ".join(text_parts)
            if combined:
                result.append({"role": role, "content": combined})
        else:
            result.append({"role": role, "content": str(content)})

    return result


def _sse_text(text: str) -> str:
    """Format a text chunk as SSE data event (Vercel AI SDK compatible)."""
    payload = json.dumps({"type": "text", "text": text})
    return f"data: {payload}\n\n"


def _sse_event(event_type: str, data: dict[str, Any]) -> str:
    """Format a custom SSE event."""
    payload = json.dumps({"type": event_type, **data})
    return f"data: {payload}\n\n"
