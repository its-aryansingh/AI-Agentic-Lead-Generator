from django.urls import path

from leadgen_backend.api import views
from leadgen_backend.agent.chat_view import chat_endpoint
from leadgen_backend.api import auth_views


urlpatterns = [
    # ---- Core agent ----
    path("chat", chat_endpoint, name="chat"),

    # ---- Auth ----
    path("auth/callback", auth_views.auth_callback, name="auth-callback"),

    # ---- Mailbox (Gmail OAuth) ----
    path("mailbox/connect", auth_views.mailbox_connect, name="mailbox-connect"),
    path("mailbox/callback", auth_views.mailbox_callback, name="mailbox-callback"),

    # ---- Health & migration inventory ----
    path("health", views.health, name="api-health"),
    path("migration/routes", views.route_inventory, name="migration-routes"),

    # ---- Extension ----
    path("extension/me", views.extension_me, name="extension-me"),
    path("extension/alerts", views.extension_alerts, name="extension-alerts"),
    path("extension/push-register", views.push_register, name="extension-push-register"),
    path("extension/web-push-key", views.web_push_key, name="extension-web-push-key"),
    path("extension/web-push-subscribe", views.web_push_subscribe, name="extension-web-push-subscribe"),
    path(
        "extension/replies/<str:reply_id>/handle",
        views.reply_handle,
        name="extension-reply-handle",
    ),
    path(
        "extension/replies/<str:reply_id>/draft-response",
        auth_views.extension_reply_draft_response,
        name="extension-reply-draft-response",
    ),

    # ---- Prospects ----
    path("prospects/<str:prospect_id>", views.prospect_update, name="prospect-update"),

    # ---- Domain check ----
    path("domain-check", views.domain_check, name="domain-check"),

    # ---- Exports ----
    path("export/csv", views.export_csv, name="export-csv"),
    path("export/sheets", views.export_sheets, name="export-sheets"),

    # ---- Cron ----
    path("cron/send-due", views.cron_send_due, name="cron-send-due"),
    path("cron/detect-replies", views.cron_detect_replies, name="cron-detect-replies"),
    path("cron/poll-intent", views.cron_poll_intent, name="cron-poll-intent"),
    path("cron/advance-sequences", views.cron_advance_sequences, name="cron-advance-sequences"),
    path("cron/run-automations", views.cron_run_automations, name="cron-run-automations"),

    # ---- Webhooks ----
    path("webhooks/stripe", views.webhook_stripe, name="webhook-stripe"),
    path("webhooks/razorpay", views.webhook_razorpay, name="webhook-razorpay"),
    path("webhooks/whatsapp", views.webhook_whatsapp, name="webhook-whatsapp"),

    # ---- Inngest (stub — async queue) ----
    path("inngest", views.pending_route("inngest"), name="inngest"),
]
