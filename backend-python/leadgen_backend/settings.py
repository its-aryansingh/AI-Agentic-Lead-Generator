from pathlib import Path

from leadgen_backend.config import env_value


BASE_DIR = Path(__file__).resolve().parents[1]

SECRET_KEY = env_value("DJANGO_SECRET_KEY") or "leadgenai-dev-only-change-me"
DEBUG = (env_value("DJANGO_DEBUG") or "true").lower() == "true"
ALLOWED_HOSTS = [
    host.strip()
    for host in (env_value("DJANGO_ALLOWED_HOSTS") or "localhost,127.0.0.1,*").split(",")
    if host.strip()
]

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "corsheaders",
    "leadgen_backend.api",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "leadgen_backend.urls"
ASGI_APPLICATION = "leadgen_backend.asgi.application"
WSGI_APPLICATION = "leadgen_backend.wsgi.application"

CORS_ALLOW_ALL_ORIGINS = True
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_HEADERS = [
    "accept",
    "accept-encoding",
    "authorization",
    "content-type",
    "dnt",
    "origin",
    "user-agent",
    "x-csrftoken",
    "x-requested-with",
    "x-session-id",
]
CORS_ALLOW_METHODS = ["DELETE", "GET", "OPTIONS", "PATCH", "POST", "PUT"]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "django-local.sqlite3",
    }
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
USE_TZ = True
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

